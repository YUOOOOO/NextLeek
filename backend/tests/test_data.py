from __future__ import annotations

from fastapi.testclient import TestClient

from test_auth import USER, csrf_headers, setup_admin


def test_data_status_requires_auth(client: TestClient) -> None:
    response = client.get("/api/data/status")
    assert response.status_code == 401


def test_data_status_and_sources_after_login(client: TestClient) -> None:
    setup_admin(client)
    status = client.get("/api/data/status")
    assert status.status_code == 200
    payload = status.json()
    assert "daily" in payload
    assert "instruments" in payload
    assert "storage" in payload

    settings = client.get("/api/settings")
    assert settings.status_code == 200
    assert settings.json()["mode"] in {"none", "free", "api_key"}

    sources = client.get("/api/settings/data-sources")
    assert sources.status_code == 200
    body = sources.json()
    assert body["builtin"][0]["name"] == "tickflow"

    jobs = client.get("/api/pipeline/jobs")
    assert jobs.status_code == 200
    assert "jobs" in jobs.json()


def test_data_source_writes_require_admin(client: TestClient) -> None:
    setup_admin(client)
    created = client.post("/api/users", json={**USER, "role": "user"}, headers=csrf_headers(client))
    assert created.status_code == 201, created.text
    client.post("/api/auth/logout", headers=csrf_headers(client))
    login = client.post("/api/auth/login", json={"email": USER["email"], "password": USER["password"]})
    assert login.status_code == 200

    assert client.get("/api/settings").status_code == 200
    assert client.get("/api/settings/data-sources").status_code == 200

    denied_key = client.post("/api/settings/tickflow-key", json={"api_key": "x"})
    assert denied_key.status_code == 403
    denied_clear = client.delete("/api/settings/tickflow-key")
    assert denied_clear.status_code == 403
    denied_providers = client.put(
        "/api/settings/preferences/data-providers",
        json={"daily_data_provider": "tickflow"},
    )
    assert denied_providers.status_code == 403
    denied_save = client.post(
        "/api/settings/data-sources",
        json={"name": "demo", "display_name": "demo", "datasets": {}},
    )
    denied_ai = client.post("/api/settings/ai", json={"provider": "openai_compat", "api_key": "x"})
    assert denied_ai.status_code == 403
    denied_ai_clear = client.delete("/api/settings/ai")
    assert denied_ai_clear.status_code == 403
    assert denied_save.status_code == 403
