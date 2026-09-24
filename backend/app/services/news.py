"""财经快讯 + 雪球/微博公开动态。

快讯：财联社 telegraph、东财 7x24 / 个股搜索。
动态：微博财经话题榜（公开）；雪球热帖需 NEXTLEEK_XUEQIU_COOKIE（站点 WAF 拦游客）。
"""
from __future__ import annotations

import hashlib
import html
import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)
_CACHE_TTL = 20.0
_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_client: httpx.Client | None = None


def _http() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=12.0, headers={"User-Agent": UA}, follow_redirects=True)
    return _client


def _item_id(*parts: str) -> str:
    raw = "|".join(parts)
    return hashlib.sha1(raw.encode("utf-8", "replace")).hexdigest()[:16]


def _parse_unix(value: Any) -> str:
    if value in (None, ""):
        return ""
    try:
        ts = int(value)
        if ts > 10**12:
            ts //= 1000
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError, OSError):
        return str(value)

_HTML_TAG = re.compile(r"<[^>]+>")
_NEWS_SOURCES = {"all", "cls", "eastmoney", "stock", "weibo", "xueqiu"}


def _strip_html(value: Any) -> str:
    text = html.unescape(str(value or ""))
    return _HTML_TAG.sub(" ", text).replace("\xa0", " ")


def _plain(value: Any) -> str:
    return re.sub(r"\s+", " ", _strip_html(value)).strip()


def fetch_cls(limit: int = 50) -> list[dict[str, Any]]:
    response = _http().get(
        "https://www.cls.cn/nodeapi/telegraphList",
        params={"rn": str(limit), "page": "1"},
        headers={"Referer": "https://www.cls.cn/"},
    )
    response.raise_for_status()
    payload = response.json()
    out: list[dict[str, Any]] = []
    for item in payload.get("data", {}).get("roll_data", []) or []:
        title = (item.get("title") or item.get("brief") or "").strip()
        content = (item.get("content") or item.get("brief") or "").strip()
        published = _parse_unix(item.get("ctime"))
        share = item.get("shareurl") or item.get("shareUrl") or ""
        if not share and item.get("id"):
            share = f"https://www.cls.cn/detail/{item['id']}"
        if not title and not content:
            continue
        if not title:
            title = content[:80]
        out.append(
            {
                "id": _item_id("cls", share, title, published),
                "title": title,
                "content": content,
                "published_at": published,
                "source": "cls",
                "source_label": "财联社",
                "url": share,
            }
        )
    return out


def fetch_eastmoney_wire(limit: int = 50) -> list[dict[str, Any]]:
    response = _http().get(
        "https://np-weblist.eastmoney.com/comm/web/getFastNewsList",
        params={
            "client": "web",
            "biz": "web_724",
            "fastColumn": "102",
            "sortEnd": "",
            "pageSize": str(limit),
            "req_trace": str(uuid.uuid4()),
        },
        headers={"Referer": "https://kuaixun.eastmoney.com/"},
    )
    response.raise_for_status()
    payload = response.json()
    out: list[dict[str, Any]] = []
    for item in payload.get("data", {}).get("fastNewsList", []) or []:
        title = (item.get("title") or "").strip()
        content = (item.get("summary") or item.get("content") or "").strip()
        published = str(item.get("showTime") or "").strip()
        code = item.get("code") or item.get("infoCode") or ""
        url = item.get("url") or ""
        if not url and code:
            url = f"https://finance.eastmoney.com/a/{code}.html"
        if not title:
            continue
        out.append(
            {
                "id": _item_id("eastmoney", url, title, published),
                "title": title,
                "content": content[:800],
                "published_at": published,
                "source": "eastmoney",
                "source_label": "东财 7x24",
                "url": url,
            }
        )
    return out


def _bare_symbol(symbol: str) -> str:
    text = symbol.strip().upper()
    if "." in text:
        text = text.split(".", 1)[0]
    return text


def fetch_eastmoney_stock(symbol: str, limit: int = 30) -> list[dict[str, Any]]:
    code = _bare_symbol(symbol)
    inner = {
        "uid": "",
        "keyword": code,
        "type": ["cmsArticleWebOld"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticleWebOld": {
                "searchScope": "default",
                "sort": "default",
                "pageIndex": 1,
                "pageSize": limit,
                "preTag": "",
                "postTag": "",
            }
        },
    }
    response = _http().get(
        "https://search-api-web.eastmoney.com/search/jsonp",
        params={"cb": "callback", "param": json.dumps(inner, ensure_ascii=False), "_": "1"},
        headers={"Referer": "https://so.eastmoney.com/"},
    )
    response.raise_for_status()
    text = response.text
    data = json.loads(text[text.index("(") + 1 : text.rindex(")")])
    out: list[dict[str, Any]] = []
    for item in data.get("result", {}).get("cmsArticleWebOld", []) or []:
        title = (item.get("title") or "").strip()
        content = (item.get("content") or "").strip()
        published = str(item.get("date") or "").strip()
        url = item.get("url") or ""
        media = item.get("mediaName") or "东方财富"
        if not title:
            continue
        out.append(
            {
                "id": _item_id("stock", url, title, published),
                "title": title,
                "content": content,
                "published_at": published,
                "source": "stock",
                "source_label": media,
                "url": url,
            }
        )
    return out


def _sort_key(item: dict[str, Any]) -> str:
    return str(item.get("published_at") or "")


def fetch_weibo_public(limit: int = 50) -> list[dict[str, Any]]:
    """微博公开财经话题动态（topic_band category=7，免登录）。"""
    limit = max(1, min(int(limit or 50), 80))
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for page in (1, 2, 3):
        if len(out) >= limit:
            break
        response = _http().get(
            "https://weibo.com/ajax/statuses/topic_band",
            params={"sid": "v_weibodesktop", "category": "7", "page": str(page)},
            headers={"Referer": "https://weibo.com/", "Accept": "application/json, text/plain, */*"},
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("ok") not in (1, True, "1") and not (payload.get("data") or {}).get("statuses"):
            raise RuntimeError(payload.get("msg") or "微博话题榜不可用")
        rows = (payload.get("data") or {}).get("statuses") or []
        if not rows:
            break
        for item in rows:
            topic = _plain(item.get("topic") or item.get("summary") or "")
            mblog = item.get("mblog") or {}
            content = _plain(mblog.get("text") or item.get("summary") or "")
            if not topic and not content:
                continue
            if not topic:
                topic = content[:80]
            key = topic or content
            if key in seen:
                continue
            seen.add(key)
            path = quote(f"#{topic}#", safe="")
            url = f"https://s.weibo.com/weibo?q={path}"
            mid = str(item.get("mid") or "")
            out.append(
                {
                    "id": _item_id("weibo", mid, topic),
                    "title": topic,
                    "content": content[:800],
                    "published_at": "",
                    "source": "weibo",
                    "source_label": "微博",
                    "url": url,
                }
            )
            if len(out) >= limit:
                break
    return out


def fetch_xueqiu_public(limit: int = 50) -> list[dict[str, Any]]:
    """雪球热帖。游客会被阿里云 WAF 拦；配置 NEXTLEEK_XUEQIU_COOKIE 后走 hots.json。"""
    from app.config import get_settings

    cookie = (get_settings().xueqiu_cookie or "").strip()
    if not cookie:
        raise RuntimeError("雪球公开接口被 WAF 拦截，请在 .env 设置 NEXTLEEK_XUEQIU_COOKIE")
    response = _http().get(
        "https://xueqiu.com/statuses/hots.json",
        params={"a": "1", "count": str(limit), "page": "1", "scope": "day", "type": "status", "meigu": "0"},
        headers={
            "Referer": "https://xueqiu.com/",
            "Accept": "application/json, text/plain, */*",
            "Cookie": cookie,
        },
    )
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict) and payload.get("error_code"):
        raise RuntimeError(payload.get("error_description") or f"雪球错误 {payload.get('error_code')}")
    rows = payload if isinstance(payload, list) else payload.get("items") or payload.get("list") or []
    out: list[dict[str, Any]] = []
    for item in rows or []:
        user = item.get("user") or {}
        author = _plain(user.get("screen_name") or "")
        title = _plain(item.get("title") or "")
        content = _plain(item.get("text") or item.get("description") or "")
        if not title:
            title = content[:80]
        if not title:
            continue
        target = str(item.get("target") or "")
        url = target if target.startswith("http") else f"https://xueqiu.com{target}"
        published = _parse_unix(item.get("created_at"))
        label = f"雪球·{author}" if author else "雪球"
        out.append(
            {
                "id": _item_id("xueqiu", url, title, published),
                "title": title,
                "content": content[:800],
                "published_at": published,
                "source": "xueqiu",
                "source_label": label,
                "url": url,
            }
        )
        if len(out) >= limit:
            break
    return out


def list_news(
    *,
    source: str = "all",
    keyword: str = "",
    symbol: str = "",
    limit: int = 80,
) -> dict[str, Any]:
    source = (source or "all").strip().lower()
    if source not in _NEWS_SOURCES:
        source = "all"
    keyword = keyword.strip()
    symbol = symbol.strip()
    limit = max(1, min(int(limit or 80), 200))
    cache_key = f"{source}|{keyword}|{symbol}|{limit}"
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(cache_key)
        if hit and now - hit[0] < _CACHE_TTL:
            return hit[1]

    items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    def _safe(name: str, fn) -> None:
        try:
            items.extend(fn())
        except Exception as exc:  # noqa: BLE001
            logger.warning("news source %s failed: %s", name, exc)
            errors.append({"source": name, "error": str(exc)})

    if symbol:
        _safe("stock", lambda: fetch_eastmoney_stock(symbol, limit))
    else:
        if source in {"all", "cls"}:
            _safe("cls", lambda: fetch_cls(limit))
        if source in {"all", "eastmoney"}:
            _safe("eastmoney", lambda: fetch_eastmoney_wire(limit))
        if source == "weibo":
            _safe("weibo", lambda: fetch_weibo_public(limit))
        if source == "xueqiu":
            _safe("xueqiu", lambda: fetch_xueqiu_public(limit))
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    needle = keyword.lower()
    for item in items:
        title = item.get("title") or ""
        if title in seen:
            continue
        if needle and needle not in title.lower() and needle not in (item.get("content") or "").lower():
            continue
        seen.add(title)
        unique.append(item)
    unique.sort(key=_sort_key, reverse=True)
    unique = unique[:limit]
    from app.services.news_tags import tag_news_items

    unique = tag_news_items(unique)
    payload = {
        "items": unique,
        "total": len(unique),
        "source": "stock" if symbol else source,
        "symbol": symbol or None,
        "errors": errors,
        "fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    with _cache_lock:
        _cache[cache_key] = (now, payload)
        if len(_cache) > 32:
            oldest = min(_cache, key=lambda key: _cache[key][0])
            _cache.pop(oldest, None)
    return payload


