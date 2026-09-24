"""财经快讯聚合：财联社 telegraph + 东财 7x24 / 个股搜索。

数据源与解析对齐 QuantMind TradingAgents-astock `a_stock.get_global_news` /
`_fetch_news_eastmoney`，不依赖 Huntly。
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import uuid
from datetime import datetime
from typing import Any

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


def list_news(
    *,
    source: str = "all",
    keyword: str = "",
    symbol: str = "",
    limit: int = 80,
) -> dict[str, Any]:
    source = (source or "all").strip().lower()
    if source not in {"all", "cls", "eastmoney", "stock"}:
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


