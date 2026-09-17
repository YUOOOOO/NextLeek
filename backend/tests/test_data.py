from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient) -> None:
    setup = client.post(
        "/api/auth/setup",
        json={
            "email": "admin@example.com",
            "username": "admin",
            "password": "admin-password-1",
        },
    )
    assert setup.status_code == 201


def test_data_status_requires_auth(client: TestClient) -> None:
    response = client.get("/api/data/status")
    assert response.status_code == 401


def test_data_status_and_sources_after_login(client: TestClient) -> None:
    _login(client)
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
