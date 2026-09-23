from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_auth import csrf_headers, setup_admin


def test_formula_strategy_create_compile_and_catalog(client: TestClient) -> None:
    setup_admin(client)
    compiled = client.post(
        "/api/strategies/compile",
        json={"formula": "close > ts_mean(close, 120)"},
        headers=csrf_headers(client),
    )
    assert compiled.status_code == 200, compiled.text
    assert compiled.json()["ok"] is True
    assert compiled.json()["warmup_bars"] >= 120

    created = client.post(
        "/api/strategies",
        json={
            "name": "站上MA120",
            "description": "公式选股",
            "kind": "formula",
            "formula": "close > ts_mean(close, 120)",
            "basic_filter": {},
            "order_by": "change_pct",
            "descending": True,
            "limit": 50,
        },
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    payload = created.json()
    assert payload["kind"] == "formula"
    assert "ts_mean(close, 120)" in payload["formula"]

    published = client.post(
        f"/api/strategies/{payload['id']}/publish",
        headers=csrf_headers(client),
    )
    assert published.status_code == 200, published.text
    catalog = client.get("/api/strategies")
    assert any(item["id"] == payload["id"] for item in catalog.json()["market"])


def test_invalid_strategy_formula_rejected(client: TestClient) -> None:
    setup_admin(client)
    response = client.post(
        "/api/strategies",
        json={
            "name": "坏公式",
            "kind": "formula",
            "formula": "close > ts_mean(unknown_col, 20)",
            "basic_filter": {},
            "order_by": "change_pct",
            "descending": True,
            "limit": 50,
        },
        headers=csrf_headers(client),
    )
    assert response.status_code == 400


def test_factor_crud_publish_and_code_reserved(client: TestClient) -> None:
    setup_admin(client)
    created = client.post(
        "/api/factors",
        json={
            "name": "120日均线",
            "code": "ma120",
            "formula": "ts_mean(close, 120)",
            "direction": "high",
        },
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    factor = created.json()
    assert factor["code"] == "ma120"
    assert factor["warmup_bars"] >= 120

    reserved = client.post(
        "/api/factors",
        json={"name": "收盘价", "code": "close", "formula": "close"},
        headers=csrf_headers(client),
    )
    assert reserved.status_code == 400

    published = client.post(f"/api/factors/{factor['id']}/publish", headers=csrf_headers(client))
    assert published.status_code == 200
    catalog = client.get("/api/factors")
    assert any(item["code"] == "ma120" for item in catalog.json()["mine"])
    assert any(item["code"] == "ma120" for item in catalog.json()["market"])


def test_strategy_can_reference_user_factor(client: TestClient) -> None:
    setup_admin(client)
    factor = client.post(
        "/api/factors",
        json={"name": "MA120", "code": "ma120", "formula": "ts_mean(close, 120)"},
        headers=csrf_headers(client),
    )
    assert factor.status_code == 201, factor.text
    created = client.post(
        "/api/strategies",
        json={
            "name": "用自定义均线",
            "kind": "formula",
            "formula": "close > ma120",
            "basic_filter": {},
            "order_by": "change_pct",
            "descending": True,
            "limit": 30,
        },
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    assert created.json()["formula"] == "close > ma120"


def test_compile_preview_errors(client: TestClient) -> None:
    setup_admin(client)
    bad = client.post(
        "/api/factors/compile",
        json={"formula": "1 + 2"},
        headers=csrf_headers(client),
    )
    assert bad.status_code == 200
    assert bad.json()["ok"] is False

def test_compile_ignores_hash_and_slash_comments() -> None:
    from app.factors.dsl import compile_formula

    compiled = compile_formula("# NextLeek 公式  版本: DSL v1\nclose > ts_mean(close, 120) // 均线\n")
    assert compiled.ok is True
    assert compiled.errors == []
