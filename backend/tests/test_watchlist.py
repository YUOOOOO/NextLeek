from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_auth import csrf_headers, setup_admin


def test_watchlist_add_list_delete(client: TestClient) -> None:
    setup_admin(client)
    created = client.post(
        "/api/watchlist",
        json={"symbol": "000001.SZ", "name": "平安银行"},
        headers=csrf_headers(client),
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["symbol"] == "000001.SZ"
    listed = client.get("/api/watchlist")
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert any(item["symbol"] == "000001.SZ" for item in items)
    duplicated = client.post(
        "/api/watchlist",
        json={"symbol": "000001.sz"},
        headers=csrf_headers(client),
    )
    assert duplicated.status_code == 409
    deleted = client.delete("/api/watchlist/000001.SZ", headers=csrf_headers(client))
    assert deleted.status_code == 204
    after = client.get("/api/watchlist")
    assert all(item["symbol"] != "000001.SZ" for item in after.json()["items"])
