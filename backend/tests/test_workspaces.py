from fastapi.testclient import TestClient

from app.api.routes import workspaces
from app.main import app


def test_workspace_lifecycle(tmp_path, monkeypatch) -> None:
    state_file = tmp_path / "workspaces.json"
    monkeypatch.setattr(workspaces, "_state_file", state_file)

    with TestClient(app) as client:
        created = client.post(
            "/api/workspaces/research",
            json={
                "name": "动量因子",
                "description": "验证工作区持久化",
                "detail": "rank(close / sma(close, 20))",
                "tags": ["日频"],
            },
        )
        assert created.status_code == 201
        factor = created.json()
        assert factor["state"] == "draft"

        listing = client.get("/api/workspaces/research")
        assert listing.status_code == 200
        assert listing.json()["items"] == [factor]
        assert state_file.exists()

        run = client.post(
            "/api/workspaces/live",
            json={"name": "盘中选股", "detail": "每 5 分钟", "tags": []},
        )
        assert run.status_code == 201
        assert run.json()["state"] == "paused"

        enabled = client.patch(
            f"/api/workspaces/live/{run.json()['id']}/state",
            json={"state": "enabled"},
        )
        assert enabled.status_code == 200
        assert enabled.json()["state"] == "enabled"

        invalid = client.patch(
            f"/api/workspaces/live/{run.json()['id']}/state",
            json={"state": "running"},
        )
        assert invalid.status_code == 422

        deleted = client.delete(f"/api/workspaces/research/{factor['id']}")
        assert deleted.status_code == 204
        assert client.get("/api/workspaces/research").json()["count"] == 0
