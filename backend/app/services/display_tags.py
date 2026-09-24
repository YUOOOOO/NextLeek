"""个股列表/弹窗上的展示信号。

内置标签默认订阅、不可取消；自定义信号走 custom_signals JSON，可增删。
"""
from __future__ import annotations

from typing import Any

from app.strategy.custom_signals import column_name, load_all

BUILTIN_DISPLAY_TAGS: tuple[dict[str, Any], ...] = (
    {
        "id": "above20",
        "name": "站上20线",
        "description": "收盘价 ≥ MA20",
        "tone": "bull",
        "kind": "derived",
    },
    {
        "id": "below20",
        "name": "跌破20线",
        "description": "收盘价 < MA20",
        "tone": "bear",
        "kind": "derived",
    },
    {
        "id": "bull-align",
        "name": "多头排列",
        "description": "MA5 > MA10 > MA20",
        "tone": "bull",
        "kind": "derived",
    },
    {
        "id": "bear-align",
        "name": "空头排列",
        "description": "MA5 < MA10 < MA20",
        "tone": "bear",
        "kind": "derived",
    },
    {
        "id": "vol-up",
        "name": "放量",
        "description": "5日量比 ≥ 2",
        "tone": "bull",
        "kind": "derived",
    },
    {
        "id": "vol-dn",
        "name": "缩量",
        "description": "5日量比 ≤ 0.5",
        "tone": "bear",
        "kind": "derived",
    },
    {
        "id": "break20",
        "name": "突破20线",
        "description": "收盘上穿 MA20",
        "tone": "bull",
        "kind": "signal",
        "field": "signal_ma20_breakout",
    },
    {
        "id": "surge",
        "name": "放量异动",
        "description": "量比 ≥ 2 的放量信号",
        "tone": "bull",
        "kind": "signal",
        "field": "signal_volume_surge",
    },
    {
        "id": "macd-g",
        "name": "MACD金叉",
        "description": "DIF 上穿 DEA",
        "tone": "bull",
        "kind": "signal",
        "field": "signal_macd_golden",
    },
    {
        "id": "macd-d",
        "name": "MACD死叉",
        "description": "DIF 下穿 DEA",
        "tone": "bear",
        "kind": "signal",
        "field": "signal_macd_dead",
    },
    {
        "id": "ma-g",
        "name": "MA5上穿MA20",
        "description": "MA5 金叉 MA20",
        "tone": "bull",
        "kind": "signal",
        "field": "signal_ma_golden_5_20",
    },
    {
        "id": "ma-d",
        "name": "MA5下穿MA20",
        "description": "MA5 死叉 MA20",
        "tone": "bear",
        "kind": "signal",
        "field": "signal_ma_dead_5_20",
    },
    {
        "id": "nh",
        "name": "阶段新高",
        "description": "创 60 日新高",
        "tone": "bull",
        "kind": "signal",
        "field": "signal_n_day_high",
    },
    {
        "id": "nl",
        "name": "阶段新低",
        "description": "创 60 日新低",
        "tone": "bear",
        "kind": "signal",
        "field": "signal_n_day_low",
    },
)

BUILTIN_IDS = frozenset(item["id"] for item in BUILTIN_DISPLAY_TAGS)


def serialize_builtin() -> list[dict[str, Any]]:
    return [
        {
            **item,
            "locked": True,
            "subscribed": True,
            "enabled": True,
        }
        for item in BUILTIN_DISPLAY_TAGS
    ]


def serialize_custom(sig: dict[str, Any]) -> dict[str, Any]:
    enabled = sig.get("enabled") is not False
    tone = sig.get("tone") if sig.get("tone") in {"bull", "bear", "neutral"} else "bull"
    return {
        "id": sig.get("id"),
        "name": sig.get("name"),
        "description": sig.get("description") or "",
        "tone": tone,
        "kind": "custom",
        "field": column_name(str(sig.get("id") or "")),
        "locked": False,
        "subscribed": enabled,
        "enabled": enabled,
        "asset_type": sig.get("asset_type") or "stock",
        "conditions": sig.get("conditions") or [],
        "timeframe": sig.get("timeframe") or "daily",
    }


def catalog(data_dir, asset_type: str | None = None) -> dict[str, list[dict[str, Any]]]:
    custom = [serialize_custom(sig) for sig in load_all(data_dir)]
    if asset_type:
        custom = [item for item in custom if (item.get("asset_type") or "stock") == asset_type]
    return {"builtin": serialize_builtin(), "custom": custom}


def enabled_custom_specs(data_dir, asset_type: str | None = None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in catalog(data_dir, asset_type)["custom"]:
        if not item["enabled"]:
            continue
        out.append(
            {
                "id": str(item["id"]),
                "label": str(item["name"]),
                "field": str(item["field"]),
                "tone": str(item["tone"]),
            }
        )
    return out
