from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_auth import ADMIN, USER, csrf_headers, setup_admin

CONDITIONS = [{"left": "change_pct", "op": ">", "right": "0.05"}]


def _create_user(client: TestClient) -> None:
    created = client.post("/api/users", json={**USER, "role": "user"}, headers=csrf_headers(client))
    assert created.status_code == 201, created.text


def _login(client: TestClient, account: str, password: str) -> None:
    client.post("/api/auth/logout", headers=csrf_headers(client))
    login = client.post("/api/auth/login", json={"account": account, "password": password})
    assert login.status_code == 200, login.text


def test_owner_publish_and_other_user_subscribe(client: TestClient) -> None:
    setup_admin(client)
    _create_user(client)

    created = client.post(
        "/api/strategies",
        json={"name": "冲高", "description": "涨幅大于5%", "conditions": CONDITIONS},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    strategy_id = created.json()["id"]
    assert created.json()["status"] == "draft"
    assert created.json()["is_owner"] is True
    assert created.json()["basic_filter"]["exclude_st"] is True
    assert created.json()["order_by"] == "change_pct"
    assert created.json()["limit"] == 100

    catalog = client.get("/api/strategies")
    assert catalog.status_code == 200
    assert any(item["id"] == strategy_id for item in catalog.json()["mine"])
    assert all(item["id"] != strategy_id for item in catalog.json()["market"])

    published = client.post(f"/api/strategies/{strategy_id}/publish", headers=csrf_headers(client))
    assert published.status_code == 200
    assert published.json()["status"] == "published"

    as_admin = client.get("/api/strategies")
    assert any(item["id"] == strategy_id for item in as_admin.json()["market"])

    _login(client, USER["username"], USER["password"])

    hidden = client.get(f"/api/strategies/{strategy_id}")
    assert hidden.status_code == 200
    market = client.get("/api/strategies")
    assert len(market.json()["mine"]) == 0
    assert any(item["id"] == strategy_id for item in market.json()["market"])

    forbidden = client.post(f"/api/strategies/{strategy_id}/run", headers=csrf_headers(client))
    assert forbidden.status_code == 403

    subscribed = client.post(f"/api/strategies/{strategy_id}/subscription", headers=csrf_headers(client))
    assert subscribed.status_code == 200
    assert subscribed.json()["subscribed"] is True

    catalog = client.get("/api/strategies")
    assert len(catalog.json()["subscribed"]) == 1

    ran = client.post(f"/api/strategies/{strategy_id}/run", headers=csrf_headers(client))
    assert ran.status_code == 200, ran.text
    payload = ran.json()
    assert payload["strategy_id"] == strategy_id
    assert payload["total"] == 0
    assert payload["rows"] == []
    assert payload["warnings"]


def test_draft_is_hidden_from_others(client: TestClient) -> None:
    setup_admin(client)
    _create_user(client)
    created = client.post(
        "/api/strategies",
        json={"name": "草稿", "description": "", "conditions": CONDITIONS},
        headers=csrf_headers(client),
    )
    strategy_id = created.json()["id"]

    _login(client, USER["email"], USER["password"])
    missing = client.get(f"/api/strategies/{strategy_id}")
    assert missing.status_code == 404
    catalog = client.get("/api/strategies")
    assert all(item["id"] != strategy_id for item in catalog.json()["market"])
    subscribe = client.post(f"/api/strategies/{strategy_id}/subscription", headers=csrf_headers(client))
    assert subscribe.status_code == 404


def test_user_cannot_edit_others_strategy(client: TestClient) -> None:
    setup_admin(client)
    _create_user(client)
    created = client.post(
        "/api/strategies",
        json={"name": "均线", "description": "", "conditions": CONDITIONS},
        headers=csrf_headers(client),
    )
    strategy_id = created.json()["id"]
    client.post(f"/api/strategies/{strategy_id}/publish", headers=csrf_headers(client))

    _login(client, USER["username"], USER["password"])
    patched = client.patch(
        f"/api/strategies/{strategy_id}",
        json={"name": "劫持"},
        headers=csrf_headers(client),
    )
    assert patched.status_code == 403
    deleted = client.delete(f"/api/strategies/{strategy_id}", headers=csrf_headers(client))
    assert deleted.status_code == 403


def test_invalid_condition_rejected(client: TestClient) -> None:
    setup_admin(client)
    response = client.post(
        "/api/strategies",
        json={"name": "坏条件", "description": "", "conditions": [{"left": "not_a_field", "op": ">", "right": "1"}]},
        headers=csrf_headers(client),
    )
    assert response.status_code == 400


def test_unpublish_hides_from_market(client: TestClient) -> None:
    setup_admin(client)
    _create_user(client)
    created = client.post(
        "/api/strategies",
        json={"name": "可撤回", "description": "", "conditions": CONDITIONS},
        headers=csrf_headers(client),
    )
    strategy_id = created.json()["id"]
    client.post(f"/api/strategies/{strategy_id}/publish", headers=csrf_headers(client))
    client.post(f"/api/strategies/{strategy_id}/unpublish", headers=csrf_headers(client))

    _login(client, USER["username"], USER["password"])
    catalog = client.get("/api/strategies")
    assert all(item["id"] != strategy_id for item in catalog.json()["market"])


def test_admin_setup_publishes_tsp_catalog(client: TestClient) -> None:
    from app.services.market_catalog import MARKET_STRATEGIES

    setup_admin(client)
    mine = client.get("/api/strategies").json()["mine"]
    names = {item["name"] for item in mine}
    expected = {item["name"] for item in MARKET_STRATEGIES}
    assert expected <= names
    assert all(item["status"] == "published" for item in mine if item["name"] in expected)
    assert expected <= {item["name"] for item in client.get("/api/strategies").json()["market"]}

    _create_user(client)
    _login(client, USER["username"], USER["password"])
    market_names = {item["name"] for item in client.get("/api/strategies").json()["market"]}
    assert expected <= market_names
    assert all(item["owner_username"] == "admin" for item in client.get("/api/strategies").json()["market"] if item["name"] in expected)


def test_owner_and_subscriber_can_monitor(client: TestClient) -> None:
    setup_admin(client)
    _create_user(client)
    created = client.post(
        "/api/strategies",
        json={"name": "监控池", "description": "", "conditions": CONDITIONS},
        headers=csrf_headers(client),
    )
    strategy_id = created.json()["id"]
    assert created.json()["monitoring"] is False

    started = client.post(f"/api/strategies/{strategy_id}/monitor", headers=csrf_headers(client))
    assert started.status_code == 200, started.text
    assert started.json()["monitoring"] is True
    mine = client.get("/api/strategies").json()["mine"]
    assert any(item["id"] == strategy_id and item["monitoring"] for item in mine)

    stopped = client.delete(f"/api/strategies/{strategy_id}/monitor", headers=csrf_headers(client))
    assert stopped.status_code == 204

    client.post(f"/api/strategies/{strategy_id}/publish", headers=csrf_headers(client))
    _login(client, USER["username"], USER["password"])
    forbidden = client.post(f"/api/strategies/{strategy_id}/monitor", headers=csrf_headers(client))
    assert forbidden.status_code == 403

    subscribed = client.post(f"/api/strategies/{strategy_id}/subscription", headers=csrf_headers(client))
    assert subscribed.status_code == 200
    watching = client.post(f"/api/strategies/{strategy_id}/monitor", headers=csrf_headers(client))
    assert watching.status_code == 200, watching.text
    assert watching.json()["monitoring"] is True


def test_published_edit_stays_private_until_subscriber_updates(client: TestClient) -> None:
    setup_admin(client)
    _create_user(client)
    created = client.post(
        "/api/strategies",
        json={"name": "版本", "description": "v1", "conditions": CONDITIONS},
        headers=csrf_headers(client),
    )
    strategy_id = created.json()["id"]
    published = client.post(f"/api/strategies/{strategy_id}/publish", headers=csrf_headers(client))
    assert published.status_code == 200
    assert published.json()["version"] == 1
    assert published.json()["has_unpublished_changes"] is False

    _login(client, USER["username"], USER["password"])
    subscribed = client.post(f"/api/strategies/{strategy_id}/subscription", headers=csrf_headers(client))
    assert subscribed.status_code == 200
    assert subscribed.json()["conditions"][0]["left"] == "change_pct"
    assert subscribed.json()["conditions"][0]["right"] == "0.05"
    assert subscribed.json()["update_available"] is False

    _login(client, ADMIN["username"], ADMIN["password"])
    updated = client.patch(
        f"/api/strategies/{strategy_id}",
        json={"description": "v2", "conditions": [{"left": "change_pct", "op": ">", "right": "0.09"}]},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["description"] == "v2"
    assert updated.json()["has_unpublished_changes"] is True
    mine = next(item for item in client.get("/api/strategies").json()["mine"] if item["id"] == strategy_id)
    market = next(item for item in client.get("/api/strategies").json()["market"] if item["id"] == strategy_id)
    assert mine["description"] == "v2"
    assert market["description"] == "v1"

    _login(client, USER["username"], USER["password"])
    catalog = client.get("/api/strategies").json()
    pinned = next(item for item in catalog["subscribed"] if item["id"] == strategy_id)
    public = next(item for item in catalog["market"] if item["id"] == strategy_id)
    assert pinned["description"] == "v1"
    assert public["description"] == "v1"
    assert pinned["update_available"] is False

    _login(client, ADMIN["username"], ADMIN["password"])
    republish = client.post(f"/api/strategies/{strategy_id}/publish", headers=csrf_headers(client))
    assert republish.status_code == 200
    assert republish.json()["version"] == 2
    assert republish.json()["has_unpublished_changes"] is False

    _login(client, USER["username"], USER["password"])
    catalog = client.get("/api/strategies").json()
    pinned = next(item for item in catalog["subscribed"] if item["id"] == strategy_id)
    public = next(item for item in catalog["market"] if item["id"] == strategy_id)
    assert pinned["description"] == "v1"
    assert public["description"] == "v2"
    assert pinned["update_available"] is True

    accepted = client.post(f"/api/strategies/{strategy_id}/subscription/update", headers=csrf_headers(client))
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["description"] == "v2"
    assert accepted.json()["update_available"] is False


def test_composite_overlay_union(client: TestClient) -> None:
    setup_admin(client)
    first = client.post(
        "/api/strategies",
        json={"name": "A", "description": "", "conditions": CONDITIONS},
        headers=csrf_headers(client),
    )
    second = client.post(
        "/api/strategies",
        json={"name": "B", "description": "", "conditions": [{"left": "change_pct", "op": "<", "right": "0"}]},
        headers=csrf_headers(client),
    )
    assert first.status_code == 201
    assert second.status_code == 201
    overlay = client.post(
        "/api/strategies",
        json={
            "name": "AB",
            "description": "",
            "kind": "composite",
            "merge_mode": "union",
            "children": [
                {"strategy_id": first.json()["id"]},
                {"strategy_id": second.json()["id"]},
            ],
        },
        headers=csrf_headers(client),
    )
    assert overlay.status_code == 201, overlay.text
    body = overlay.json()
    assert body["kind"] == "composite"
    assert body["merge_mode"] == "union"
    assert len(body["children"]) == 2

    nested = client.post(
        "/api/strategies",
        json={
            "name": "bad",
            "kind": "composite",
            "children": [
                {"strategy_id": overlay.json()["id"]},
                {"strategy_id": first.json()["id"]},
            ],
        },
        headers=csrf_headers(client),
    )
    assert nested.status_code == 400

    published = client.post(f"/api/strategies/{overlay.json()['id']}/publish", headers=csrf_headers(client))
    assert published.status_code == 200
    assert published.json()["status"] == "published"
    ran = client.post(f"/api/strategies/{overlay.json()['id']}/run", headers=csrf_headers(client))
    assert ran.status_code == 200, ran.text


def test_merge_union_and_intersect() -> None:
    from datetime import date

    from app.services.screener import ScreenerResult
    from app.services.strategy_runtime import _merge_children

    as_of = date(2024, 1, 1)
    left = ScreenerResult(
        as_of=as_of,
        strategy="a",
        rows=[{"symbol": "1", "close": 1}, {"symbol": "2", "close": 2}],
        total=2,
    )
    right = ScreenerResult(
        as_of=as_of,
        strategy="b",
        rows=[{"symbol": "2", "close": 2}, {"symbol": "3", "close": 3}],
        total=2,
    )
    spec = {"order_by": "close", "descending": True, "result_limit": 10}
    union = _merge_children(as_of, {**spec, "merge_mode": "union"}, [left, right])
    assert {row["symbol"] for row in union.rows} == {"1", "2", "3"}
    inter = _merge_children(as_of, {**spec, "merge_mode": "intersect"}, [left, right])
    assert {row["symbol"] for row in inter.rows} == {"2"}


