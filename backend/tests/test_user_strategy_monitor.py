from __future__ import annotations

import polars as pl

from app.api.monitor import _overlay_quotes, _tag_map
from app.services.user_strategy_monitor import UserStrategyMonitor


def test_apply_result_enters_and_exits() -> None:
    monitor = UserStrategyMonitor()
    first = monitor.apply_result(
        "user-1",
        "stg-1",
        "冲高",
        [
            {
                "symbol": "000001.SZ",
                "name": "平安银行",
                "close": 10.2,
                "change_pct": 0.02,
                "ma20": 9.8,
                "vol_ratio_5d": 8.7,
                "signal_volume_surge": True,
            }
        ],
    )
    assert first == []
    pool = monitor.pools_for_user("user-1")["stg-1"]
    assert pool[0]["symbol"] == "000001.SZ"
    assert pool[0]["ma20"] == 9.8
    assert pool[0]["vol_ratio_5d"] == 8.7
    assert pool[0]["signal_volume_surge"] is True
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


def test_overlay_copies_enriched_tags_then_live_quote() -> None:
    frame = pl.DataFrame(
        {
            "symbol": ["000001.SZ"],
            "ma20": [9.8],
            "vol_ratio_5d": [8.7],
            "signal_ma20_breakout": [True],
            "signal_volume_surge": [True],
        }
    )
    rows = _overlay_quotes(
        [{"symbol": "000001.SZ", "name": "平安", "close": 10.0, "change_pct": 0.01}],
        {"000001.SZ": {"close": 10.5, "change_pct": 0.03, "name": "平安银行"}},
        _tag_map(frame),
    )
    assert rows[0]["name"] == "平安银行"
    assert rows[0]["close"] == 10.5
    assert rows[0]["ma20"] == 9.8
    assert rows[0]["vol_ratio_5d"] == 8.7
    assert rows[0]["signal_ma20_breakout"] is True
    assert rows[0]["signal_volume_surge"] is True


def test_monitor_snapshot_ok_without_watches(client) -> None:
    from tests.test_auth import ADMIN, setup_admin

    setup_admin(client)
    login = client.post("/api/auth/login", json={"account": ADMIN["username"], "password": ADMIN["password"]})
    assert login.status_code == 200
    response = client.get("/api/monitor?asset_type=stock")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["asset_type"] == "stock"
    assert body["strategies"] == []
    assert body["watch_count"] == 0
    assert body["hit_count"] == 0
    assert isinstance(body["events"], list)
