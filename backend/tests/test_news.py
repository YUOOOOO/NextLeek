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


def test_news_weibo_and_xueqiu_tabs(client: TestClient, monkeypatch) -> None:
    setup_admin(client)
    login = client.post("/api/auth/login", json={"account": ADMIN["username"], "password": ADMIN["password"]})
    assert login.status_code == 200

    def fake_weibo(limit: int = 50):
        return [
            {
                "id": "w1",
                "title": "股市",
                "content": "A股用普跌回应",
                "published_at": "",
                "source": "weibo",
                "source_label": "微博",
                "url": "https://s.weibo.com/weibo?q=%23%E8%82%A1%E5%B8%82%23",
            }
        ]

    def fake_xq(limit: int = 50):
        return [
            {
                "id": "x1",
                "title": "热帖",
                "content": "雪球讨论",
                "published_at": "2026-09-24 09:00",
                "source": "xueqiu",
                "source_label": "雪球·测试",
                "url": "https://xueqiu.com/123/456",
            }
        ]

    monkeypatch.setattr("app.services.news.fetch_weibo_public", fake_weibo)
    monkeypatch.setattr("app.services.news.fetch_xueqiu_public", fake_xq)
    monkeypatch.setattr("app.services.news._CACHE_TTL", 0)

    weibo = client.get("/api/news", params={"source": "weibo"}).json()
    assert weibo["total"] == 1
    assert weibo["items"][0]["source"] == "weibo"
    assert "股市" in weibo["items"][0]["title"]

    xq = client.get("/api/news", params={"source": "xueqiu"}).json()
    assert xq["items"][0]["source"] == "xueqiu"

    mixed = client.get("/api/news").json()
    assert all(item["source"] in {"cls", "eastmoney"} for item in mixed["items"])


def test_fetch_weibo_public_parses_topic_band(monkeypatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "ok": 1,
                "data": {
                    "statuses": [
                        {
                            "topic": "股市",
                            "mid": "1",
                            "mblog": {"text": "#股市# <br />A股普跌"},
                        }
                    ]
                },
            }

    class FakeClient:
        def get(self, url, params=None, headers=None):
            assert "topic_band" in url
            assert params["category"] == "7"
            return FakeResponse()

    monkeypatch.setattr("app.services.news._http", lambda: FakeClient())
    from app.services.news import fetch_weibo_public

    items = fetch_weibo_public(10)
    assert items[0]["source"] == "weibo"
    assert items[0]["title"] == "股市"
    assert "A股普跌" in items[0]["content"]
    assert "<br" not in items[0]["content"]


def test_xueqiu_without_cookie_surfaces_error(client: TestClient, monkeypatch) -> None:
    setup_admin(client)
    login = client.post("/api/auth/login", json={"account": ADMIN["username"], "password": ADMIN["password"]})
    assert login.status_code == 200

    monkeypatch.setattr("app.services.news._CACHE_TTL", 0)
    monkeypatch.setattr("app.services.news.fetch_xueqiu_public", lambda limit=50: (_ for _ in ()).throw(
        RuntimeError("雪球公开接口被 WAF 拦截，请在 .env 设置 NEXTLEEK_XUEQIU_COOKIE")
    ))
    feed = client.get("/api/news", params={"source": "xueqiu"}).json()
    assert feed["total"] == 0
    assert any("COOKIE" in err["error"] or "WAF" in err["error"] for err in feed["errors"])

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


def test_tag_news_item_matches_name_and_code(monkeypatch) -> None:
    from app.services import news_tags

    index = {
        "names": {"贵州茅台": "600519.SH", "宁德时代": "300750.SZ"},
        "symbol_names": {"600519.SH": "贵州茅台", "300750.SZ": "宁德时代"},
        "codes": {"600519": "600519.SH", "300750": "300750.SZ", "688981": "688981.SH"},
        "ordered": ("贵州茅台", "宁德时代"),
        "concept_of": {"600519.SH": ["白酒"], "300750.SZ": ["锂电池"]},
        "industry_of": {"600519.SH": ["食品饮料-白酒"], "300750.SZ": ["电力设备-电池"]},
    }
    news_tags.invalidate_tag_index()
    monkeypatch.setattr(news_tags, "_load_index", lambda: index)

    named = news_tags.tag_news_item(
        {"title": "贵州茅台提价", "content": "与宁德时代无关"},
        index,
    )
    assert [s["symbol"] for s in named["stocks"]] == ["600519.SH", "300750.SZ"]
    assert named["boards"] == ["沪主板", "创业板"]
    assert "白酒" in named["concepts"]
    assert "锂电池" in named["concepts"]

    coded = news_tags.tag_news_item(
        {"title": "中芯国际", "content": "688981.SH 放量"},
        index,
    )
    assert coded["stocks"][0]["symbol"] == "688981.SH"
    assert coded["boards"] == ["科创板"]

    generic = news_tags.tag_news_item({"title": "银行板块走强", "content": ""}, index)
    assert generic["stocks"] == []
    assert "银行" in generic["concepts"]



def test_list_members_board_concept_industry(monkeypatch) -> None:
    from app.services import news_tags

    index = {
        "names": {"贵州茅台": "600519.SH", "宁德时代": "300750.SZ", "*ST三六": "300295.SZ"},
        "symbol_names": {"600519.SH": "贵州茅台", "300750.SZ": "宁德时代", "300295.SZ": "*ST三六"},
        "codes": {},
        "ordered": ("贵州茅台", "宁德时代", "*ST三六"),
        "concept_of": {"600519.SH": ["白酒"], "300750.SZ": ["锂电池"]},
        "industry_of": {"600519.SH": ["食品饮料-白酒"], "300750.SZ": ["电力设备-电池"]},
    }
    news_tags.invalidate_tag_index()
    monkeypatch.setattr(news_tags, "_load_index", lambda: index)

    board = news_tags.list_members("board", "创业板")
    assert board["total"] == 2
    assert [row["symbol"] for row in board["rows"]] == ["300750.SZ", "300295.SZ"]

    concept = news_tags.list_members("concept", "白酒")
    assert [row["symbol"] for row in concept["rows"]] == ["600519.SH"]

    industry = news_tags.list_members("industry", "白酒")
    assert [row["symbol"] for row in industry["rows"]] == ["600519.SH"]
    assert news_tags.list_members("industry", "食品饮料-白酒")["total"] == 1

    empty = news_tags.list_members("concept", "银行")
    assert empty["total"] == 0
    assert empty["rows"] == []


def test_list_news_attaches_tags(client: TestClient, monkeypatch) -> None:
    setup_admin(client)
    login = client.post("/api/auth/login", json={"account": ADMIN["username"], "password": ADMIN["password"]})
    assert login.status_code == 200

    monkeypatch.setattr(
        "app.services.news.fetch_cls",
        lambda limit=50: [
            {
                "id": "c1",
                "title": "贵州茅台提价",
                "content": "高端白酒",
                "published_at": "2026-09-24 10:00",
                "source": "cls",
                "source_label": "财联社",
                "url": "https://www.cls.cn/detail/1",
            }
        ],
    )
    monkeypatch.setattr("app.services.news.fetch_eastmoney_wire", lambda limit=50: [])
    monkeypatch.setattr("app.services.news._CACHE_TTL", 0)
    monkeypatch.setattr(
        "app.services.news_tags.tag_news_items",
        lambda items: [
            {
                **item,
                "stocks": [{"symbol": "600519.SH", "name": "贵州茅台", "board": "沪主板"}],
                "boards": ["沪主板"],
                "concepts": ["白酒"],
                "industries": ["白酒"],
            }
            for item in items
        ],
    )
    feed = client.get("/api/news", params={"source": "cls"}).json()
    assert feed["items"][0]["stocks"][0]["symbol"] == "600519.SH"
    assert feed["items"][0]["boards"] == ["沪主板"]
