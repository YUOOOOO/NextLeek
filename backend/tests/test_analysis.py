from __future__ import annotations

import json

from fastapi.testclient import TestClient

from test_auth import csrf_headers, setup_admin


def test_analysis_stream_requires_session_and_csrf(client: TestClient) -> None:
    response = client.post("/api/analysis/ai", json={"symbol": "000001"})
    assert response.status_code in (401, 403)
    setup_admin(client)
    response = client.post("/api/analysis/ai", json={"symbol": "000001"})
    assert response.status_code == 403


def test_analysis_stream_passes_symbol_focus_and_events(client: TestClient, monkeypatch) -> None:
    setup_admin(client)
    seen = []

    async def fake_stream(repo, data_dir, symbol, focus):
        seen.append((repo, data_dir, symbol, focus))
        yield json.dumps({"type": "delta", "content": "技术状态"}, ensure_ascii=False)
        yield json.dumps({"type": "done"})

    monkeypatch.setattr("app.api.analysis.analyze_stock_stream", fake_stream)
    response = client.post(
        "/api/analysis/ai",
        json={"symbol": " sz000001 ", "focus": " 关注量能 "},
        headers=csrf_headers(client),
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert [json.loads(line) for line in response.text.splitlines()] == [
        {"type": "delta", "content": "技术状态"}, {"type": "done"},
    ]
    assert seen == [(client.app.state.repo, client.app.state.repo.store.data_dir, "SZ000001", "关注量能")]
