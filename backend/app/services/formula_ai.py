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
- 公式必须短：最多 5 个条件，用 and/or 连接；不要堆砌重复均线或注释。编译器 token 上限 512，超长会失败
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
        text = await generate_ai_text(
            [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"{hint}。需求：{prompt.strip()}"},
                {"role": "assistant", "content": text},
                {
                    "role": "user",
                    "content": (
                        f"公式编译失败：{exc}。请输出更短的合法公式：最多 5 个条件，"
                        "不要注释，不要重复窗口。只输出 JSON。"
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=None,
        )
        data = _extract_json(text)
        intent = str(data.get("intent") or intent).strip() or intent
        if intent not in {"strategy", "factor", "condition"}:
            intent = kind
        formula = str(data.get("formula") or "").strip()
        name = str(data.get("name") or "").strip() or name
        description = str(data.get("description") or "").strip() or description
        try:
            compiled = formula_runtime.compile_user_formula(formula, require_bool=(intent != "factor"))
        except ValueError as retry_exc:
            raise FormulaAIError(str(retry_exc)) from retry_exc
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


_MONITOR_SYSTEM = """你是监控配置助手。只输出一个 JSON 对象，不要 markdown。
用户只能从「可选策略」里挑选自己的或已订阅的策略来监控，不能发明新公式，也不能引用列表外的 id。
intent:
- chat: 问候、解释、列表为空、需求无法对应到列表中的策略
- single: 监控列表中的一条策略
- composite: 用列表中至少 2 条非叠加(kind 不是 composite)策略创建叠加策略
规则:
- strategy_id 必须来自可选策略的 id
- 叠加 children 不能包含 kind=composite 的策略，至少 2 条且不重复
- 叠加默认 merge_mode=union；用户明确说同时满足/交集时用 intersect
JSON 字段: intent, response(chat 必填), name, description, strategy_id(single 必填), children([{strategy_id}])(composite 必填), merge_mode, min_confirm
"""


def catalog_pool(catalog: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source in ("mine", "subscribed"):
        for row in catalog.get(source) or []:
            sid = str(row.get("id") or "")
            if not sid or sid in seen:
                continue
            seen.add(sid)
            items.append(
                {
                    "id": sid,
                    "name": str(row.get("name") or ""),
                    "description": str(row.get("description") or "")[:120],
                    "kind": str(row.get("kind") or "conditions"),
                    "source": source,
                }
            )
    return items


def parse_monitor_plan(data: dict[str, Any], pool: list[dict[str, Any]]) -> dict[str, Any]:
    by_id = {str(item["id"]): item for item in pool}
    intent = str(data.get("intent") or "").strip()
    if intent == "chat":
        return {
            "intent": "chat",
            "response": str(data.get("response") or "可以说一下要用哪条策略监控，或把哪几条叠在一起。")[:12000],
        }
    if intent not in {"single", "composite"}:
        raise FormulaAIError("AI 未返回可用的监控方案")
    name = str(data.get("name") or "").strip()
    description = str(data.get("description") or "").strip()
    if intent == "single":
        sid = str(data.get("strategy_id") or "").strip()
        item = by_id.get(sid)
        if item is None:
            raise FormulaAIError("只能选择自己的或已订阅的策略")
        return {
            "intent": "single",
            "name": (name or item["name"])[:40],
            "description": (description or item.get("description") or "")[:500],
            "strategy_id": sid,
            "children": [],
            "merge_mode": "union",
            "min_confirm": 1,
        }
    raw_children = data.get("children") or []
    if not isinstance(raw_children, list):
        raise FormulaAIError("叠加子策略格式无效")
    children: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_children:
        if not isinstance(raw, dict):
            continue
        sid = str(raw.get("strategy_id") or raw.get("id") or "").strip()
        if not sid or sid in seen:
            continue
        item = by_id.get(sid)
        if item is None:
            raise FormulaAIError("只能叠加自己的或已订阅的策略")
        if (item.get("kind") or "") == "composite":
            raise FormulaAIError("不能叠加另一个叠加策略")
        seen.add(sid)
        children.append({"strategy_id": sid, "weight": 1.0, "name": item.get("name") or ""})
    if len(children) < 2:
        raise FormulaAIError("叠加至少选择 2 个策略")
    merge_mode = str(data.get("merge_mode") or "union").strip()
    if merge_mode not in {"union", "intersect"}:
        merge_mode = "union"
    try:
        min_confirm = int(data.get("min_confirm") or 1)
    except (TypeError, ValueError):
        min_confirm = 1
    min_confirm = max(1, min(min_confirm, len(children)))
    if not name:
        name = " + ".join(child["name"] for child in children)[:40]
    return {
        "intent": "composite",
        "name": name[:40],
        "description": description[:500],
        "strategy_id": None,
        "children": children,
        "merge_mode": merge_mode,
        "min_confirm": min_confirm,
    }


async def generate_monitor_plan(prompt: str, pool: list[dict[str, Any]]) -> dict[str, Any]:
    if not pool:
        return {
            "intent": "chat",
            "response": "还没有自己的或已订阅的策略。请先到策略页创建或订阅，再回来配置监控。",
        }
    if not ai_configured():
        raise FormulaAIError("请先在设置页配置 AI")
    listing = "\n".join(
        f"- id={item['id']} name={item['name']} kind={item['kind']} source={item['source']} desc={item['description']}"
        for item in pool
    )
    text = await generate_ai_text(
        [
            {"role": "system", "content": _MONITOR_SYSTEM},
            {"role": "user", "content": f"可选策略:\n{listing}\n\n需求：{prompt.strip()}"},
        ],
        temperature=0.2,
        max_tokens=None,
    )
    return parse_monitor_plan(_extract_json(text), pool)


_NEWS_SYSTEM = """你是 A 股盘面新闻分析助手。根据用户给出的快讯标题和摘要做解读。
规则:
- 只依据给出的快讯，不要编造未出现的数据、公告或行情
- 先给结论：对市场情绪、主线/板块、相关个股线索的影响
- 区分已落地事实和猜测，猜测必须标明
- 指出风险或需要继续观察的点
- 不要生成选股公式，不要给出具体买卖指令
- 用简洁中文，分点作答
"""


async def analyze_news(prompt: str) -> dict[str, Any]:
    if not ai_configured():
        raise FormulaAIError("请先在设置页配置 AI")
    text = await generate_ai_text(
        [
            {"role": "system", "content": _NEWS_SYSTEM},
            {"role": "user", "content": prompt.strip()},
        ],
        temperature=0.3,
        max_tokens=None,
    )
    reply = (text or "").strip() or "这些快讯信息有限，需要补充后才能判断影响。"
    return {"intent": "chat", "response": reply[:12000]}

