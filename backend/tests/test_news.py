from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_auth import ADMIN, csrf_headers, setup_admin


def test_news_requires_login(client: TestClient) -> None:
    assert client.get("/api/news").status_code == 401


def test_news_aggregates_and_filters(client: TestClient, monkeypatch) -> None:
    setup_admin(client)
    login = client.post("/api/auth/login", json={"account": ADMIN["username"], "password": ADMIN["password"]})
    assert login.status_code == 200

    def fake_cls(limit: int = 50):
        return [
            {
                "id": "c1",
                "title": "央行降准",
                "content": "释放长期资金",
                "published_at": "2026-09-24 10:00",
                "source": "cls",
                "source_label": "财联社",
                "url": "https://www.cls.cn/detail/1",
            }
        ]

    def fake_em(limit: int = 50):
        return [
            {
                "id": "e1",
                "title": "两市成交放量",
                "content": "沪深成交破万亿",
                "published_at": "2026-09-24 10:05",
                "source": "eastmoney",
                "source_label": "东财 7x24",
                "url": "https://finance.eastmoney.com/a/x.html",
            }
        ]

    monkeypatch.setattr("app.services.news.fetch_cls", fake_cls)
    monkeypatch.setattr("app.services.news.fetch_eastmoney_wire", fake_em)
    monkeypatch.setattr("app.services.news._CACHE_TTL", 0)

    all_items = client.get("/api/news").json()
    assert all_items["total"] == 2
    assert all_items["items"][0]["title"] == "两市成交放量"

    cls_only = client.get("/api/news", params={"source": "cls"}).json()
    assert [item["source"] for item in cls_only["items"]] == ["cls"]

    filtered = client.get("/api/news", params={"q": "降准"}).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["title"] == "央行降准"


def test_news_analyze_requires_login(client: TestClient) -> None:
    assert client.post("/api/news/analyze", json={"prompt": "央行降准"}).status_code == 401


def test_news_analyze_returns_chat(client: TestClient, monkeypatch) -> None:
    setup_admin(client)
    login = client.post("/api/auth/login", json={"account": ADMIN["username"], "password": ADMIN["password"]})
    assert login.status_code == 200

    async def fake_analyze(prompt: str):
        assert "央行降准" in prompt
        return {"intent": "chat", "response": "利好流动性"}

    monkeypatch.setattr("app.services.formula_ai.analyze_news", fake_analyze)
    response = client.post(
        "/api/news/analyze",
        json={"prompt": "请分析：央行降准"},
        headers=csrf_headers(client),
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"intent": "chat", "response": "利好流动性"}


def test_news_analyze_requires_ai_config(client: TestClient, monkeypatch) -> None:
    setup_admin(client)
    login = client.post("/api/auth/login", json={"account": ADMIN["username"], "password": ADMIN["password"]})
    assert login.status_code == 200
    monkeypatch.setattr("app.services.formula_ai.ai_configured", lambda: False)
    response = client.post(
        "/api/news/analyze",
        json={"prompt": "请分析：央行降准"},
        headers=csrf_headers(client),
    )
    assert response.status_code == 400
    assert "配置 AI" in response.json()["detail"]


def test_news_conversation_workspace_allowed(client: TestClient) -> None:
    setup_admin(client)
    login = client.post("/api/auth/login", json={"account": ADMIN["username"], "password": ADMIN["password"]})
    assert login.status_code == 200
    saved = client.put(
        "/api/ai/conversations/news",
        json={"messages": [{"role": "bot", "text": "从左侧把快讯加入待分析"}]},
        headers=csrf_headers(client),
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["workspace"] == "news"
