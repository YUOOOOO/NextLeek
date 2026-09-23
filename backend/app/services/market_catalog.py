"""把 TSP 内置策略的默认真值翻译成条件 DSL，由 admin 发布到市场。

不做 Python 策略执行。金叉/死叉用前1日比较近似；无法用 8 条 AND
表达的形态/计数/背离策略不进市场。
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Strategy, User
from app.services import user_strategies as svc

logger = logging.getLogger(__name__)

_BF = {
    "price_min": 3,
    "price_max": 300,
    "market_cap_min": 10e8,
    "amount_min": 0.2e8,
    "exclude_st": True,
    "boards": ["沪主板", "深主板", "创业板", "科创板", "北交所"],
}


def _c(
    left: str,
    op: str,
    right: str | int | float,
    *,
    left_days: int = 0,
    right_days: int = 0,
) -> dict[str, Any]:
    return {
        "left": left,
        "op": op,
        "right": right,
        "leftDays": left_days,
        "rightDays": right_days,
    }


MARKET_STRATEGIES: tuple[dict[str, Any], ...] = (
    {
        "name": "MA 金叉",
        "description": "MA5 上穿 MA20 当日 + 量比≥1.2 + 收盘在 MA60 上方",
        "conditions": [
            _c("ma5", ">", "field:ma20"),
            _c("ma5", "<=", "field:ma20", left_days=1, right_days=1),
            _c("vol_ratio_5d", ">=", 1.2),
            _c("close", ">", "field:ma60"),
        ],
        "order_by": "momentum_20d",
        "limit": 100,
    },
    {
        "name": "MACD 金叉放量",
        "description": "MACD DIF 上穿 DEA 当日 + 量比≥1.5",
        "conditions": [
            _c("macd_dif", ">", "field:macd_dea"),
            _c("macd_dif", "<=", "field:macd_dea", left_days=1, right_days=1),
            _c("vol_ratio_5d", ">=", 1.5),
        ],
        "order_by": "vol_ratio_5d",
        "limit": 100,
    },
    {
        "name": "均线多头",
        "description": "MA5>MA10>MA20>MA60 多头排列 + 20日动量为正",
        "conditions": [
            _c("ma5", ">", "field:ma10"),
            _c("ma10", ">", "field:ma20"),
            _c("ma20", ">", "field:ma60"),
            _c("momentum_20d", ">", 0),
        ],
        "order_by": "momentum_60d",
        "limit": 100,
    },
    {
        "name": "布林突破",
        "description": "收盘突破布林上轨 + 量比≥1.5",
        "conditions": [
            _c("close", ">", "field:boll_upper"),
            _c("vol_ratio_5d", ">=", 1.5),
        ],
        "order_by": "vol_ratio_5d",
        "limit": 100,
    },
    {
        "name": "放量创60日新高",
        "description": "收盘高于前1日60日高点 + 量比≥1.3 + 涨幅>2%",
        "conditions": [
            _c("close", ">", "field:high_60d", right_days=1),
            _c("vol_ratio_5d", ">=", 1.3),
            _c("change_pct", ">", 0.02),
        ],
        "order_by": "momentum_20d",
        "limit": 100,
    },
    {
        "name": "趋势突破",
        "description": "MA60 上方 + 创60日新高 + 量比≥2",
        "conditions": [
            _c("close", ">", "field:ma60"),
            _c("close", ">", "field:high_60d", right_days=1),
            _c("vol_ratio_5d", ">=", 2),
        ],
        "basic_filter": {
            "price_min": 5,
            "price_max": 200,
            "market_cap_min": 20e8,
            "amount_min": 1e8,
            "exclude_st": True,
            "boards": ["沪主板", "深主板", "创业板", "科创板", "北交所"],
        },
        "order_by": "momentum_60d",
        "limit": 100,
    },
    {
        "name": "量价齐升",
        "description": "收盘上穿 MA20 + 量比≥2 + 收阳",
        "conditions": [
            _c("close", ">", "field:ma20"),
            _c("close", "<=", "field:ma20", left_days=1, right_days=1),
            _c("vol_ratio_5d", ">=", 2),
            _c("close", ">", "field:open"),
        ],
        "order_by": "vol_ratio_5d",
        "limit": 100,
    },
    {
        "name": "超跌反弹",
        "description": "RSI14<30 + 收阳 + 量比≥1.2",
        "conditions": [
            _c("rsi_14", "<", 30),
            _c("close", ">", "field:open"),
            _c("vol_ratio_5d", ">=", 1.2),
        ],
        "order_by": "change_pct",
        "limit": 100,
    },
    {
        "name": "超跌反转",
        "description": "RSI14<30 + 涨幅>1% + 站上 MA5",
        "conditions": [
            _c("rsi_14", "<", 30),
            _c("change_pct", ">", 0.01),
            _c("close", ">", "field:ma5"),
        ],
        "order_by": "change_pct",
        "limit": 50,
    },
    {
        "name": "新低反转",
        "description": "触及前1日60日低点 + 收阳 + 量比≥1.5",
        "conditions": [
            _c("close", "<=", "field:low_60d", right_days=1),
            _c("close", ">", "field:open"),
            _c("vol_ratio_5d", ">=", 1.5),
        ],
        "order_by": "change_pct",
        "limit": 100,
    },
    {
        "name": "RSI 中轴回踩",
        "description": "MA60 上方，RSI14 落在 45–60 中轴区间",
        "conditions": [
            _c("close", ">", "field:ma60"),
            _c("rsi_14", ">=", 45),
            _c("rsi_14", "<=", 60),
        ],
        "order_by": "momentum_20d",
        "limit": 100,
    },
    {
        "name": "均线回踩反弹",
        "description": "收盘相对 MA20 偏离 ±2% 内 + MA5>MA20>MA60 + 当日上涨",
        "conditions": [
            _c("ma20_bias", ">=", -0.02),
            _c("ma20_bias", "<=", 0.02),
            _c("ma5", ">", "field:ma20"),
            _c("ma20", ">", "field:ma60"),
            _c("change_pct", ">", 0),
        ],
        "order_by": "momentum_60d",
        "limit": 50,
    },
    {
        "name": "缩量回踩",
        "description": "收盘相对 MA20 偏离 ±2% 内 + 量比≤0.8 + MA60 上方 + 20日动量为正",
        "conditions": [
            _c("ma20_bias", ">=", -0.02),
            _c("ma20_bias", "<=", 0.02),
            _c("vol_ratio_5d", "<=", 0.8),
            _c("close", ">", "field:ma60"),
            _c("momentum_20d", ">", 0),
        ],
        "order_by": "momentum_60d",
        "limit": 100,
    },
    {
        "name": "低波动龙头",
        "description": "20日动量为正 + 年化波动<30% + 收盘在 MA20 上方",
        "conditions": [
            _c("momentum_20d", ">", 0),
            _c("annual_vol_20d", "<", 0.3),
            _c("close", ">", "field:ma20"),
        ],
        "order_by": "momentum_60d",
        "limit": 100,
    },
    {
        "name": "高换手拉升",
        "description": "换手率>5% 且涨幅>3%",
        "conditions": [
            _c("turnover_rate", ">", 5),
            _c("change_pct", ">", 0.03),
        ],
        "order_by": "turnover_rate",
        "limit": 50,
    },
    {
        "name": "连板股",
        "description": "连续涨停≥2 天",
        "conditions": [_c("consecutive_limit_ups", ">=", 2)],
        "order_by": "consecutive_limit_ups",
        "limit": 100,
    },
    {
        "name": "连板接力",
        "description": "连板≥1 且今日涨幅>5%",
        "conditions": [
            _c("consecutive_limit_ups", ">=", 1),
            _c("change_pct", ">", 0.05),
        ],
        "order_by": "consecutive_limit_ups",
        "limit": 50,
    },
    {
        "name": "逼近涨停",
        "description": "涨幅>7%。条件 DSL 没有涨停价，无法卡「距涨停<3%」",
        "conditions": [_c("change_pct", ">", 0.07)],
        "order_by": "change_pct",
        "limit": 50,
    },
    {
        "name": "强势高开",
        "description": "涨幅>3% 且收阳。条件 DSL 无法写开盘相对昨收的缺口幅度",
        "conditions": [
            _c("change_pct", ">", 0.03),
            _c("close", ">", "field:open"),
        ],
        "order_by": "change_pct",
        "limit": 50,
    },
)


def seed_market_strategies(database: Session) -> int:
    """幂等地创建不属于任何用户的内置策略。"""
    admin = database.scalar(
        select(User)
        .where(User.role == "admin", User.is_active.is_(True))
        .order_by(User.created_at.asc())
    )
    if admin is None:
        return 0

    existing = set(
        database.scalars(
            select(Strategy.name).where(Strategy.name.in_([str(item["name"]) for item in MARKET_STRATEGIES]))
        ).all()
    )
    created = 0
    for spec in MARKET_STRATEGIES:
        name = spec["name"]
        if name in existing:
            continue
        strategy = svc.create_strategy(
            database,
            admin,
            name,
            spec["description"],
            spec["conditions"],
            basic_filter=spec.get("basic_filter", _BF),
            order_by=spec["order_by"],
            descending=True,
            limit=spec["limit"],
        )
        strategy.is_builtin = True
        strategy.owner_id = "builtin"
        database.commit()
        svc.publish_strategy(database, strategy)
        existing.add(name)
        created += 1
    if created:
        logger.info("seeded %s published market strategies for admin %s", created, admin.username)
    return created
