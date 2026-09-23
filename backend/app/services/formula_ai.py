"""用设置页 AI 配置生成因子/策略公式。"""
from __future__ import annotations

import json
import re
from typing import Any, Literal

from app.services import formula_runtime
from app.services.ai_provider import ai_configured, generate_ai_text

Kind = Literal["factor", "strategy"]

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)

_SYSTEM = """你是 A 股量化公式助手。只输出一个 JSON 对象，不要 markdown。
先判断需求意图:
- chat: 问候、感谢、闲聊、无法转成量化表达的内容
- strategy: 需要均线、量能、窗口算子的选股布尔公式
- factor: 数值因子或指标
- condition: 用简单字段比较就能表达的选股条件，例如涨跌幅、价格、成交额阈值，不需要均线窗口算子
如果 intent=chat，只返回 intent=chat 和 response，自然回答用户，不生成公式。
如果 intent=strategy、factor 或 condition，返回对应公式字段。
可用算子: ts_mean ts_std ts_sum ts_max ts_min ts_delay ts_delta ts_rank ts_zscore ts_corr ts_cov decay_linear rank zscore winsorize if_else min max log abs sign sqrt power clamp
基准列: open high low close volume amount turnover_rate
比较: > >= < <= == !=  逻辑: and or
规则:
- 因子 formula 必须是数值表达式，例如 ts_mean(close, 120)
- 策略/条件 formula 必须是布尔表达式，例如 close > ts_mean(close, 120) and volume > ts_mean(volume, 20)
- 窗口 n 必须是数字字面量，范围 2-512
- 不要引用未给出的列名
- 涨跌幅用小数，5% 写成 0.05
JSON 字段: intent(chat|strategy|factor|condition), response(chat 必填), name, formula, description, direction(high|low|none), code(仅因子, 小写字母数字下划线)
"""


class FormulaAIError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _extract_json(text: str) -> dict[str, Any]:
    match = _JSON_RE.search(text or "")
    if not match:
        raise FormulaAIError("AI 未返回 JSON 公式")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise FormulaAIError("AI 返回的 JSON 无法解析") from exc
    if not isinstance(data, dict):
        raise FormulaAIError("AI 返回的 JSON 不是对象")
    return data


async def generate_formula(prompt: str, kind: Kind) -> dict[str, Any]:
    if not ai_configured():
        raise FormulaAIError("请先在设置页配置 AI")
    hint = "当前页面期望生成策略，但请先判断用户意图" if kind == "strategy" else "当前页面期望生成因子，但请先判断用户意图"
    text = await generate_ai_text(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"{hint}。需求：{prompt.strip()}"},
        ],
        temperature=0.2,
        max_tokens=None,
    )
    data = _extract_json(text)
    intent = str(data.get("intent") or kind).strip()
    if intent == "chat":
        return {"intent": "chat", "response": str(data.get("response") or "你好，有什么量化问题可以帮你？")[:12000]}
    if intent not in {"strategy", "factor", "condition"}:
        intent = kind
    formula = str(data.get("formula") or "").strip()
    default_name = "AI因子" if intent == "factor" else "AI条件" if intent == "condition" else "AI策略"
    name = str(data.get("name") or "").strip() or default_name
    description = str(data.get("description") or "").strip()
    direction = str(data.get("direction") or "none").strip()
    if direction not in {"high", "low", "none"}:
        direction = "none"
    try:
        compiled = formula_runtime.compile_user_formula(formula, require_bool=(intent != "factor"))
    except ValueError as exc:
        raise FormulaAIError(str(exc)) from exc
    result: dict[str, Any] = {
        "intent": intent,
        "name": name[:40],
        "formula": formula,
        "description": description[:500],
        "direction": direction,
        "warmup_bars": compiled.warmup_bars,
        "dependencies": sorted(compiled.dependencies),
    }
    if intent == "factor":
        result["code"] = str(data.get("code") or "").strip().lower()
    return result
