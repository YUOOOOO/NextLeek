from __future__ import annotations

from fastapi.testclient import TestClient

from app.services.stock_chanlun_monitor import evaluate_rows, resample_kline
from tests.test_auth import csrf_headers, setup_admin


def test_resample_five_day_chunks() -> None:
    rows = [
        {"date": i, "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1, "amount": 1}
        for i in range(10)
    ]
    out = resample_kline(rows, 5)
    assert len(out) == 2
    assert out[0]["open"] == 1
    assert out[0]["date"] == 4


def test_evaluate_rows_no_crash_on_short_series() -> None:
    rows = [
        {"date": i, "open": 10 + i, "high": 11 + i, "low": 9 + i, "close": 10 + i, "volume": 1}
        for i in range(8)
    ]
    extra = evaluate_rows(rows, "b2")
    assert extra["hit"] is False
    assert "summary" in extra


def test_create_and_delete_stock_monitor(client: TestClient) -> None:
    setup_admin(client)
    created = client.post(
        "/api/monitor/stocks",
        json={"symbol": "000001.SZ", "name": "平安银行", "period": "day", "signal": "b2"},
        headers=csrf_headers(client),
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["symbol"] == "000001.SZ"
    assert body["signal"] == "b2"
    assert body["period"] == "day"
    snapshot = client.get("/api/monitor?asset_type=stock")
    assert snapshot.status_code == 200, snapshot.text
    watches = snapshot.json()["stock_watches"]
    assert any(item["id"] == body["id"] for item in watches)
    duplicated = client.post(
        "/api/monitor/stocks",
        json={"symbol": "000001.SZ", "period": "day", "signal": "b2"},
        headers=csrf_headers(client),
    )
    assert duplicated.status_code == 409
    deleted = client.delete(f"/api/monitor/stocks/{body['id']}", headers=csrf_headers(client))
    assert deleted.status_code == 204
    after = client.get("/api/monitor?asset_type=stock")
    assert all(item["id"] != body["id"] for item in after.json()["stock_watches"])
