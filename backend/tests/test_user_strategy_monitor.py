from __future__ import annotations

from app.services.user_strategy_monitor import UserStrategyMonitor


def test_apply_result_enters_and_exits() -> None:
    monitor = UserStrategyMonitor()
    first = monitor.apply_result(
        "user-1",
        "stg-1",
        "冲高",
        [{"symbol": "000001.SZ", "name": "平安银行", "close": 10.2, "change_pct": 0.02}],
    )
    assert first == []
    pool = monitor.pools_for_user("user-1")["stg-1"]
    assert pool[0]["symbol"] == "000001.SZ"
    assert monitor.pools_for_user("user-2") == {}

    events = monitor.apply_result(
        "user-1",
        "stg-1",
        "冲高",
        [{"symbol": "000002.SZ", "name": "万科A", "close": 8.1, "change_pct": -0.01}],
    )
    types = {event["type"] for event in events}
    assert types == {"pool_entry", "pool_exit"}
    assert any("进入" in event["message"] and event["symbol"] == "000002.SZ" for event in events)
    assert any("移出" in event["message"] and event["symbol"] == "000001.SZ" for event in events)
    assert [row["symbol"] for row in monitor.pools_for_user("user-1")["stg-1"]] == ["000002.SZ"]


def test_drop_pool_clears_user_strategy() -> None:
    monitor = UserStrategyMonitor()
    monitor.apply_result(
        "user-1",
        "stg-1",
        "冲高",
        [{"symbol": "000001.SZ", "name": "平安银行", "close": 10.2}],
        emit_events=False,
    )
    monitor.apply_result(
        "user-1",
        "stg-2",
        "低吸",
        [{"symbol": "000002.SZ", "name": "万科A", "close": 8.1}],
        emit_events=False,
    )
    monitor.drop_pool("user-1", "stg-1")
    remaining = monitor.pools_for_user("user-1")
    assert "stg-1" not in remaining
    assert [row["symbol"] for row in remaining["stg-2"]] == ["000002.SZ"]
