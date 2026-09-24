"""从快讯标题/正文提取个股、交易所板块、概念/行业。

匹配口径:
- 个股: instruments 简称（去 ST/*ST/-U 等后缀后的核心名 + 原名）或 6 位代码
- 板块: 命中个股后按代码前缀推 沪主板/深主板/创业板/科创板/北交所
- 概念/行业: 复用 ext_gn_ths / ext_hy_ths；本地未拉扩展表时为空

消歧: 名称按长度降序扫描，避免「中国电信」被「电信」截走。长度 < 3 的简称忽略。
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

from app.services.market_overview_builder import _board

logger = logging.getLogger(__name__)

_CACHE_TTL = 300.0
_lock = threading.Lock()
_cache: tuple[float, dict[str, Any]] | None = None

_CODE_RE = re.compile(r"(?<!\d)(\d{6})(?:\.(SH|SZ|BJ))?(?!\d)")
_PREFIX_RE = re.compile(r"^(?:\*ST|ST|S)")
_UNLISTED_RE = re.compile(r"[-－][UWB]$", re.I)
_SECTOR_MENTION = re.compile(r"([\u4e00-\u9fff]{2,8})(?:板块|概念|行业)")
_SKIP_MENTIONS = {"相关", "多个", "部分", "整体", "市场", "整个", "主要", "热点", "热门", "各", "该", "本", "所属", "对应"}
_SKIP_NAMES = {
    "机器人",
    "黄金",
    "石油",
    "钢铁",
    "煤炭",
    "银行",
    "证券",
    "保险",
    "汽车",
    "医药",
    "白酒",
    "光伏",
    "芯片",
    "军工",
    "航天",
    "航空",
    "港口",
    "物流",
    "地产",
    "建筑",
    "软件",
    "通信",
    "电子",
    "农业",
    "食品",
    "饮料",
    "传媒",
    "锂电",
    "储能",
    "氢能",
    "稀土",
    "猪肉",
    "疫苗",
    "中药",
    "指数",
    "板块",
    "概念",
    "股市",
    "股票",
    "A股",
    "港股",
    "美股",
}
_MAX_STOCKS = 6
_MAX_BOARDS = 4
_MAX_CONCEPTS = 4
_MAX_INDUSTRIES = 3

def _core_name(name: str) -> str:
    text = (name or "").strip()
    text = _PREFIX_RE.sub("", text).strip()
    text = _UNLISTED_RE.sub("", text).strip()
    return text

def _get_repo():
    from app.strategy.market_data import _get_repo

    return _get_repo()


def _load_index() -> dict[str, Any]:
    global _cache
    now = time.monotonic()
    with _lock:
        if _cache is not None and now - _cache[0] < _CACHE_TTL:
            return _cache[1]

    names: dict[str, str] = {}
    symbol_names: dict[str, str] = {}
    codes: dict[str, str] = {}
    concept_of: dict[str, list[str]] = {}
    industry_of: dict[str, list[str]] = {}
    try:
        repo = _get_repo()
        df = repo.get_instruments()
        if df is not None and not df.is_empty() and "symbol" in df.columns:
            for row in df.select(
                [c for c in ("symbol", "name", "code") if c in df.columns]
            ).iter_rows(named=True):
                symbol = str(row.get("symbol") or "").strip().upper()
                if not symbol:
                    continue
                code = str(row.get("code") or "").strip() or symbol.split(".", 1)[0]
                codes.setdefault(code, symbol)
                raw = str(row.get("name") or "").strip()
                if not raw:
                    continue
                symbol_names.setdefault(symbol, raw)
                for alias in (raw, _core_name(raw)):
                    if len(alias) < 3 or alias in _SKIP_NAMES:
                        continue
                    names.setdefault(alias, symbol)
        try:
            from app.services.rps_rotation import _load_concept_map_df

            cmap, _ = _load_concept_map_df(repo, "concept")
            imap, _ = _load_concept_map_df(repo, "industry")
            if cmap is not None and not cmap.is_empty():
                for row in cmap.iter_rows(named=True):
                    sym = str(row.get("_sym_up") or "").upper()
                    member = str(row.get("concept") or "").strip()
                    if sym and member:
                        bucket = concept_of.setdefault(sym, [])
                        if member not in bucket:
                            bucket.append(member)
            if imap is not None and not imap.is_empty():
                for row in imap.iter_rows(named=True):
                    sym = str(row.get("_sym_up") or "").upper()
                    member = str(row.get("industry") or "").strip()
                    if sym and member:
                        bucket = industry_of.setdefault(sym, [])
                        if member not in bucket:
                            bucket.append(member)
        except Exception as exc:  # noqa: BLE001
            logger.debug("news concept map unavailable: %s", exc)
            concept_of, industry_of = {}, {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("news tag index failed: %s", exc)
        names, symbol_names, codes, concept_of, industry_of = {}, {}, {}, {}, {}

    ordered = tuple(sorted(names, key=len, reverse=True))
    payload = {
        "names": names,
        "symbol_names": symbol_names,
        "codes": codes,
        "ordered": ordered,
        "concept_of": concept_of,
        "industry_of": industry_of,
    }
    with _lock:
        _cache = (now, payload)
    return payload


def invalidate_tag_index() -> None:
    global _cache
    with _lock:
        _cache = None

def _scan_names(text: str, ordered: tuple[str, ...], names: dict[str, str]) -> list[str]:
    hits: list[str] = []
    seen: set[str] = set()
    occupied = bytearray(len(text))
    for alias in ordered:
        start = 0
        while True:
            idx = text.find(alias, start)
            if idx < 0:
                break
            end = idx + len(alias)
            if any(occupied[idx:end]):
                start = idx + 1
                continue
            symbol = names[alias]
            if symbol not in seen:
                seen.add(symbol)
                hits.append(symbol)
            for i in range(idx, end):
                occupied[i] = 1
            start = end
            if len(hits) >= 24:
                return hits
    return hits


def _scan_codes(text: str, codes: dict[str, str], already: set[str]) -> list[str]:
    extra: list[str] = []
    known_symbols = set(codes.values())
    for match in _CODE_RE.finditer(text):
        code = match.group(1)
        suffix = (match.group(2) or "").upper()
        if suffix:
            symbol = f"{code}.{suffix}"
            if symbol not in already and symbol in known_symbols:
                extra.append(symbol)
            continue
        symbol = codes.get(code)
        if symbol and symbol not in already:
            extra.append(symbol)
    return extra

def _scan_mentions(text: str) -> list[str]:
    out: list[str] = []
    for match in _SECTOR_MENTION.finditer(text):
        label = match.group(1)
        if label in _SKIP_MENTIONS or label in out:
            continue
        out.append(label)
        if len(out) >= _MAX_CONCEPTS:
            break
    return out

def _stock_payload(symbol: str, symbol_names: dict[str, str]) -> dict[str, str]:
    code = symbol.split(".", 1)[0]
    return {
        "symbol": symbol,
        "name": symbol_names.get(symbol) or code,
        "board": _board(symbol),
    }

def tag_news_item(item: dict[str, Any], index: dict[str, Any] | None = None) -> dict[str, Any]:
    index = index or _load_index()
    text = f"{item.get('title') or ''}\n{item.get('content') or ''}"
    names: dict[str, str] = index["names"]
    symbol_names: dict[str, str] = index.get("symbol_names") or {}
    codes: dict[str, str] = index["codes"]
    ordered: tuple[str, ...] = index["ordered"]
    concept_of: dict[str, list[str]] = index["concept_of"]
    industry_of: dict[str, list[str]] = index["industry_of"]

    symbols = _scan_names(text, ordered, names)
    seen = set(symbols)
    for symbol in _scan_codes(text, codes, seen):
        if symbol not in seen:
            seen.add(symbol)
            symbols.append(symbol)

    stocks = [_stock_payload(symbol, symbol_names) for symbol in symbols[:_MAX_STOCKS]]
    boards: list[str] = []
    for stock in stocks:
        board = stock["board"]
        if board and board not in boards and board != "其他":
            boards.append(board)
        if len(boards) >= _MAX_BOARDS:
            break

    concepts: list[str] = []
    industries: list[str] = []
    for stock in stocks:
        for member in concept_of.get(stock["symbol"]) or []:
            if isinstance(member, str) and member not in concepts:
                concepts.append(member)
            if len(concepts) >= _MAX_CONCEPTS:
                break
        raw_ind = industry_of.get(stock["symbol"]) or []
        if isinstance(raw_ind, str):
            raw_ind = [raw_ind]
        for member in raw_ind:
            leaf = member.split("-")[-1] if member else ""
            label = leaf or member
            if label and label not in industries:
                industries.append(label)
            if len(industries) >= _MAX_INDUSTRIES:
                break
        if len(concepts) >= _MAX_CONCEPTS and len(industries) >= _MAX_INDUSTRIES:
            break
    for mention in _scan_mentions(text):
        if mention not in concepts and mention not in industries:
            concepts.append(mention)
        if len(concepts) >= _MAX_CONCEPTS:
            break

    tagged = dict(item)
    tagged["stocks"] = stocks
    tagged["boards"] = boards
    tagged["concepts"] = concepts[:_MAX_CONCEPTS]
    tagged["industries"] = industries[:_MAX_INDUSTRIES]
    return tagged


def tag_news_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not items:
        return items
    index = _load_index()
    return [tag_news_item(item, index) for item in items]


_MEMBER_KINDS = {"board", "concept", "industry"}
_MEMBER_LIMIT = 200


def list_members(kind: str, name: str, *, limit: int = _MEMBER_LIMIT) -> dict[str, Any]:
    kind = (kind or "").strip().lower()
    name = (name or "").strip()
    limit = max(1, min(int(limit or _MEMBER_LIMIT), 500))
    if kind not in _MEMBER_KINDS or not name:
        return {"kind": kind, "name": name, "total": 0, "rows": []}

    index = _load_index()
    symbol_names: dict[str, str] = index.get("symbol_names") or {}
    matched: list[str] = []

    if kind == "board":
        matched = [symbol for symbol in symbol_names if _board(symbol) == name]
    elif kind == "concept":
        for symbol, members in (index.get("concept_of") or {}).items():
            labels = members if isinstance(members, list) else [members]
            if name in labels:
                matched.append(symbol)
    else:
        for symbol, members in (index.get("industry_of") or {}).items():
            labels = members if isinstance(members, list) else [members]
            for member in labels:
                text = str(member)
                leaf = text.split("-")[-1]
                if name in {text, leaf}:
                    matched.append(symbol)
                    break

    def _sort_key(symbol: str) -> tuple[int, str, str]:
        label = symbol_names.get(symbol) or symbol
        return (1 if "ST" in label.upper() else 0, label, symbol)

    matched = sorted(set(matched), key=_sort_key)
    rows = [_stock_payload(symbol, symbol_names) for symbol in matched[:limit]]
    return {"kind": kind, "name": name, "total": len(matched), "rows": rows}
