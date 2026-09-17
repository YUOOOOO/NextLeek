from __future__ import annotations

from fastapi.testclient import TestClient


ADMIN = {
    "email": "admin@example.com",
    "username": "admin",
    "password": "change-me-now-1",
}

USER = {
    "email": "alice@example.com",
    "username": "alice",
    "password": "alice-password-1",
}


def csrf_headers(client: TestClient) -> dict[str, str]:
    token = client.cookies.get("nextleek_csrf")
    assert token
    return {"X-CSRF-Token": token}


def setup_admin(client: TestClient) -> dict:
    response = client.post("/api/auth/setup", json=ADMIN)
    assert response.status_code == 201, response.text
    return response.json()["user"]


def test_setup_creates_first_admin(client: TestClient) -> None:
    assert client.get("/api/auth/status").json() == {"configured": False}
    user = setup_admin(client)
    assert user["role"] == "admin"
    assert client.get("/api/auth/status").json() == {"configured": True}
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == ADMIN["email"]


def test_setup_rejected_after_init(client: TestClient) -> None:
    setup_admin(client)
    response = client.post("/api/auth/setup", json={**ADMIN, "email": "other@example.com"})
    assert response.status_code == 409


def test_login_and_logout(client: TestClient) -> None:
    setup_admin(client)
    client.post("/api/auth/logout", headers=csrf_headers(client))
    denied = client.get("/api/auth/me")
    assert denied.status_code == 401
    login = client.post(
        "/api/auth/login",
        json={"email": ADMIN["email"], "password": ADMIN["password"]},
    )
    assert login.status_code == 200
    assert client.get("/api/auth/me").status_code == 200



def test_login_with_username(client: TestClient) -> None:
    setup_admin(client)
    client.post("/api/auth/logout", headers=csrf_headers(client))
    login = client.post(
        "/api/auth/login",
        json={"account": ADMIN["username"], "password": ADMIN["password"]},
    )
    assert login.status_code == 200
    assert client.get("/api/auth/me").json()["username"] == ADMIN["username"]

def test_admin_creates_user_and_user_cannot_list(client: TestClient) -> None:
    setup_admin(client)
    created = client.post("/api/users", json={**USER, "role": "user"}, headers=csrf_headers(client))
    assert created.status_code == 201, created.text
    users = client.get("/api/users")
    assert users.status_code == 200
    assert len(users.json()) == 2

    client.post("/api/auth/logout", headers=csrf_headers(client))
    login = client.post(
        "/api/auth/login",
        json={"email": USER["email"], "password": USER["password"]},
    )
    assert login.status_code == 200
    forbidden = client.get("/api/users")
    assert forbidden.status_code == 403


def test_user_can_change_own_password(client: TestClient) -> None:
    setup_admin(client)
    created = client.post("/api/users", json={**USER, "role": "user"}, headers=csrf_headers(client))
    assert created.status_code == 201, created.text
    client.post("/api/auth/logout", headers=csrf_headers(client))
    login = client.post("/api/auth/login", json={"email": USER["email"], "password": USER["password"]})
    assert login.status_code == 200

    wrong = client.post(
        "/api/auth/password",
        json={"current_password": "not-the-old-one", "new_password": "alice-password-2"},
        headers=csrf_headers(client),
    )
    assert wrong.status_code == 400

    changed = client.post(
        "/api/auth/password",
        json={"current_password": USER["password"], "new_password": "alice-password-2"},
        headers=csrf_headers(client),
    )
    assert changed.status_code == 200, changed.text
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/api/users").status_code == 403

    client.post("/api/auth/logout", headers=csrf_headers(client))
    old_login = client.post("/api/auth/login", json={"email": USER["email"], "password": USER["password"]})
    assert old_login.status_code == 401
    new_login = client.post("/api/auth/login", json={"email": USER["email"], "password": "alice-password-2"})
    assert new_login.status_code == 200


def test_mutating_requires_csrf(client: TestClient) -> None:
    setup_admin(client)
    response = client.post("/api/users", json={**USER, "role": "user"})
    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF 校验失败"


def test_cannot_delete_last_admin(client: TestClient) -> None:
    admin = setup_admin(client)
    response = client.delete(f"/api/users/{admin['id']}", headers=csrf_headers(client))
    assert response.status_code == 400


def test_inactive_user_cannot_login(client: TestClient) -> None:
    setup_admin(client)
    created = client.post("/api/users", json={**USER, "role": "user"}, headers=csrf_headers(client))
    user_id = created.json()["id"]
    patched = client.patch(
        f"/api/users/{user_id}",
        json={"is_active": False},
        headers=csrf_headers(client),
    )
    assert patched.status_code == 200
    client.post("/api/auth/logout", headers=csrf_headers(client))
    login = client.post(
        "/api/auth/login",
        json={"email": USER["email"], "password": USER["password"]},
    )
    assert login.status_code == 403
