from __future__ import annotations

import pytest

from app.services.formula_ai import FormulaAIError, catalog_pool, parse_monitor_plan


POOL = [
    {"id": "a", "name": "均线", "description": "ma", "kind": "formula", "source": "mine"},
    {"id": "b", "name": "量能", "description": "vol", "kind": "conditions", "source": "subscribed"},
    {"id": "c", "name": "叠加包", "description": "", "kind": "composite", "source": "mine"},
]


def test_catalog_pool_uses_mine_and_subscribed_only() -> None:
    pool = catalog_pool(
        {
            "mine": [{"id": "a", "name": "均线", "kind": "formula"}],
            "subscribed": [{"id": "b", "name": "量能", "kind": "conditions"}],
            "market": [{"id": "z", "name": "市场", "kind": "formula"}],
        }
    )
    assert [item["id"] for item in pool] == ["a", "b"]


def test_parse_single_from_pool() -> None:
    plan = parse_monitor_plan({"intent": "single", "strategy_id": "b"}, POOL)
    assert plan["intent"] == "single"
    assert plan["strategy_id"] == "b"
    assert plan["name"] == "量能"


def test_parse_composite_rejects_nested_and_unknown() -> None:
    plan = parse_monitor_plan(
        {"intent": "composite", "children": [{"strategy_id": "a"}, {"id": "b"}], "merge_mode": "intersect"},
        POOL,
    )
    assert plan["intent"] == "composite"
    assert [child["strategy_id"] for child in plan["children"]] == ["a", "b"]
    assert plan["merge_mode"] == "intersect"
    with pytest.raises(FormulaAIError, match="不能叠加另一个叠加策略"):
        parse_monitor_plan({"intent": "composite", "children": [{"strategy_id": "a"}, {"strategy_id": "c"}]}, POOL)
    with pytest.raises(FormulaAIError, match="只能选择自己的或已订阅的策略"):
        parse_monitor_plan({"intent": "single", "strategy_id": "missing"}, POOL)
