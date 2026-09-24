from __future__ import annotations

import polars as pl

from app.api.monitor import _overlay_quotes, _tag_map
from app.services.display_tags import BUILTIN_IDS, serialize_builtin
from tests.test_auth import csrf_headers, setup_admin


def test_builtin_tags_locked_and_subscribed() -> None:
    items = serialize_builtin()
    assert {item["id"] for item in items} >= {"above20", "break20", "surge", "ma-g", "vol-up"}
    assert all(item["locked"] and item["subscribed"] for item in items)


def test_overlay_copies_custom_signal_columns() -> None:
    frame = pl.DataFrame(
        {
            "symbol": ["000001.SZ"],
            "ma20": [9.8],
            "csg_rsi_oversold": [True],
            "signal_ma20_breakout": [True],
        }
    )
    rows = _overlay_quotes(
        [{"symbol": "000001.SZ", "name": "平安", "close": 10.0, "change_pct": 0.01}],
        {},
        _tag_map(frame),
    )
    assert rows[0]["csg_rsi_oversold"] is True
    assert rows[0]["signal_ma20_breakout"] is True


def test_custom_signal_crud_and_builtin_protected(client) -> None:
    setup_admin(client)
    listed = client.get("/api/custom-signals")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert all(item["locked"] for item in body["builtin"])
    assert body["custom"] == []

    headers = csrf_headers(client)
    blocked = client.post(
        "/api/custom-signals",
        headers=headers,
        json={
            "id": next(iter(BUILTIN_IDS)),
            "name": "不可改",
            "kind": "both",
            "conditions": [{"left": "close", "op": ">", "right": "field:ma20"}],
        },
    )
    assert blocked.status_code == 400

    created = client.post(
        "/api/custom-signals",
        headers=headers,
        json={
            "id": "rsi_oversold",
            "name": "RSI超卖",
            "kind": "both",
            "tone": "bull",
            "conditions": [{"left": "rsi_14", "op": "<", "right": 30}],
        },
    )
    assert created.status_code == 200, created.text
    custom = created.json()["signal"]["custom"]
    assert custom[0]["id"] == "rsi_oversold"
    assert custom[0]["subscribed"] is True
    assert custom[0]["locked"] is False
    assert custom[0]["field"] == "csg_rsi_oversold"

    locked_delete = client.delete("/api/custom-signals/above20", headers=headers)
    assert locked_delete.status_code == 400

    removed = client.delete("/api/custom-signals/rsi_oversold", headers=headers)
    assert removed.status_code == 200
    assert client.get("/api/custom-signals").json()["custom"] == []
