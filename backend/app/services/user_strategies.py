"""用户策略：创建、发布、订阅，执行走 ScreenerService 条件 DSL。"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Strategy, StrategySubscription, StrategyWatch, User
from app.security import utcnow
from app.strategy import custom_signals


class StrategyError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def normalize_conditions(raw: list[Any]) -> list[dict]:
    if not raw:
        return []
    conditions = []
    for item in raw:
        data = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        conditions.append(
            {
                "left": str(data["left"]),
                "op": str(data["op"]),
                "right": str(data["right"]),
                "leftDays": int(data.get("leftDays") or 0),
                "rightDays": int(data.get("rightDays") or 0),
            }
        )
    sig = {
        "id": "user",
        "name": "user",
        "kind": "entry",
        "timeframe": custom_signals.TIMEFRAME_DAILY,
        "conditions": conditions,
    }
    try:
        custom_signals.validate(sig)
    except ValueError as exc:
        raise StrategyError("invalid", str(exc)) from exc
    return conditions


MAX_COMPOSITE_CHILDREN = 8


def normalize_kind(value: str | None) -> str:
    kind = (value or "conditions").strip()
    if kind not in {"formula", "conditions", "composite"}:
        raise StrategyError("invalid", "策略类型只能是公式、条件或叠加")
    return kind


def normalize_asset_type(value: str | None) -> str:
    asset_type = (value or "stock").strip().lower()
    if asset_type not in {"stock", "etf"}:
        raise StrategyError("invalid", "资产类型只能是股票或ETF")
    return asset_type


def normalize_formula(formula: str | None, *, extra: list[str] | None = None) -> str:
    text = (formula or "").strip()
    if not text:
        raise StrategyError("invalid", "请填写策略公式")
    from app.services import formula_runtime

    try:
        formula_runtime.compile_user_formula(text, extra, require_bool=True)
    except ValueError as extra_error:
        raise StrategyError("invalid", str(extra_error)) from extra_error
    return text


def _factor_codes(database: Session, user_id: str, asset_type: str = "stock") -> list[str]:
    from app.services import user_factors

    return list(user_factors.specs_for_user(database, user_id, asset_type=asset_type))


def normalize_merge_mode(value: str | None) -> str:
    mode = (value or "union").strip()
    if mode not in {"union", "intersect"}:
        raise StrategyError("invalid", "叠加方式只能是并集或交集")
    return mode


def normalize_children(database: Session, owner_id: str, raw: list[Any] | None, *, asset_type: str = "stock") -> list[dict]:
    items = raw or []
    if len(items) < 2:
        raise StrategyError("invalid", "叠加至少选择 2 个策略")
    if len(items) > MAX_COMPOSITE_CHILDREN:
        raise StrategyError("invalid", f"叠加最多 {MAX_COMPOSITE_CHILDREN} 个策略")
    seen: set[str] = set()
    out: list[dict] = []
    for item in items:
        data = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        child_id = str(data.get("strategy_id") or "")
        if not child_id or child_id in seen:
            raise StrategyError("invalid", "叠加子策略无效或重复")
        seen.add(child_id)
        child = _load(database, child_id)
        if (child.kind or "conditions") == "composite":
            raise StrategyError("invalid", "不能叠加另一个叠加策略")
        if child.owner_id != owner_id and child.status != "published":
            raise StrategyError("forbidden", "只能叠加自己的或已发布的策略")
        if normalize_asset_type(getattr(child, "asset_type", None)) != asset_type:
            raise StrategyError("invalid", "叠加子策略必须是同一资产类型")
        weight = float(data.get("weight") or 1)
        if weight < 0:
            raise StrategyError("invalid", "权重必须大于等于 0")
        out.append({"strategy_id": child_id, "weight": weight})
    return out


def _subscribed_ids(database: Session, user_id: str) -> set[str]:
    rows = database.scalars(
        select(StrategySubscription.strategy_id).where(StrategySubscription.user_id == user_id)
    ).all()
    return set(rows)


def _subscriber_counts(database: Session, strategy_ids: list[str]) -> dict[str, int]:
    if not strategy_ids:
        return {}
    rows = database.execute(
        select(StrategySubscription.strategy_id, func.count())
        .where(StrategySubscription.strategy_id.in_(strategy_ids))
        .group_by(StrategySubscription.strategy_id)
    ).all()
    return {strategy_id: int(count) for strategy_id, count in rows}


def serialize(
    strategy: Strategy,
    *,
    user_id: str,
    subscribed: bool,
    subscriber_count: int,
    monitoring: bool = False,
    view: str = "working",
    snapshot: dict | None = None,
    pinned_version: int | None = None,
) -> dict:
    owner = strategy.owner
    source = _view_source(strategy, view, snapshot)
    basic = source.get("basic_filter") or {}
    version = int(strategy.version or 0)
    pinned = 0 if pinned_version is None else int(pinned_version)
    return {
        "id": strategy.id,
        "name": source.get("name") or strategy.name,
        "description": source.get("description") if "description" in source else (strategy.description or ""),
        "status": strategy.status,
        "asset_type": normalize_asset_type(getattr(strategy, "asset_type", None)),
        "kind": _canonical_kind(source.get("kind"), source.get("formula") or ""),
        "formula": source.get("formula") or "",
        "conditions": source.get("conditions") or [],
        "children": source.get("children") or [],
        "merge_mode": source.get("merge_mode") or "union",
        "min_confirm": int(source.get("min_confirm") or 1),
        "basic_filter": {
            "price_min": basic.get("price_min", 3),
            "price_max": basic.get("price_max", 300),
            "market_cap_min": basic.get("market_cap_min", 10e8),
            "amount_min": basic.get("amount_min", 0.2e8),
            "exclude_st": bool(basic.get("exclude_st", True)),
            "boards": basic.get("boards")
            or ["沪主板", "深主板", "创业板", "科创板", "北交所"],
        },
        "order_by": source.get("order_by") or "change_pct",
        "descending": True if source.get("descending") is None else bool(source.get("descending")),
        "limit": int(source.get("result_limit") or source.get("limit") or 100),
        "owner_id": strategy.owner_id,
        "owner_username": "内置" if strategy.is_builtin else (owner.username if owner is not None else ""),
        "subscriber_count": subscriber_count,
        "subscribed": subscribed,
        "is_owner": not strategy.is_builtin and strategy.owner_id == user_id,
        "monitoring": monitoring,
        "version": version,
        "has_unpublished_changes": not strategy.is_builtin and strategy.owner_id == user_id and _has_unpublished_changes(strategy),
        "update_available": subscribed and version > pinned,
        "created_at": strategy.created_at,
        "updated_at": strategy.updated_at,
        "published_at": strategy.published_at,
    }


def _canonical_kind(value: object, formula: str = "") -> str:
    kind = str(value or "").strip()
    if kind in {"formula", "conditions", "composite"}:
        return kind
    if formula.strip():
        return "formula"
    return "formula"


def _view_source(strategy: Strategy, view: str, snapshot: dict | None) -> dict:
    if view == "pinned" and snapshot:
        return _display_source(snapshot)
    if view == "published":
        published = strategy.published_snapshot
        if published:
            return _display_source(published)
    return _display_source(working_payload(strategy), live=strategy)


def _display_source(payload: dict, live: Strategy | None = None) -> dict:
    children = []
    for item in payload.get("children") or []:
        children.append(
            {
                "strategy_id": item.get("strategy_id") or item.get("id") or "",
                "name": item.get("name") or "",
                "weight": float(item.get("weight") or 1),
            }
        )
    if live is not None and live.kind == "composite":
        for item in children:
            if not item["name"]:
                item["name"] = item["strategy_id"]
    return {
        "name": payload.get("name"),
        "description": payload.get("description", ""),
        "kind": payload.get("kind") or "conditions",
        "formula": payload.get("formula") or "",
        "conditions": payload.get("conditions") or [],
        "children": children,
        "merge_mode": payload.get("merge_mode") or "union",
        "min_confirm": payload.get("min_confirm") or 1,
        "basic_filter": payload.get("basic_filter") or {},
        "order_by": payload.get("order_by") or "change_pct",
        "descending": payload.get("descending"),
        "result_limit": payload.get("result_limit") or payload.get("limit") or 100,
    }


def working_payload(strategy: Strategy) -> dict:
    return {
        "name": strategy.name,
        "description": strategy.description or "",
        "kind": strategy.kind or "conditions",
        "asset_type": normalize_asset_type(getattr(strategy, "asset_type", None)),
        "formula": strategy.formula or "",
        "conditions": strategy.conditions or [],
        "children": [
            {"strategy_id": item.get("strategy_id"), "weight": float(item.get("weight") or 1)}
            for item in (strategy.children or [])
            if item.get("strategy_id")
        ],
        "merge_mode": strategy.merge_mode or "union",
        "min_confirm": int(strategy.min_confirm or 1),
        "basic_filter": strategy.basic_filter or {},
        "order_by": strategy.order_by or "change_pct",
        "descending": True if strategy.descending is None else bool(strategy.descending),
        "result_limit": strategy.result_limit or 100,
    }


def freeze_snapshot(database: Session, strategy: Strategy) -> dict:
    payload = working_payload(strategy)
    if payload["kind"] != "composite":
        return payload
    frozen = []
    for ref in payload["children"]:
        child = _load(database, ref["strategy_id"])
        if (child.kind or "conditions") == "composite":
            raise StrategyError("invalid", "不能叠加另一个叠加策略")
        child_payload = working_payload(child)
        child_payload["id"] = child.id
        child_payload["strategy_id"] = child.id
        child_payload["name"] = child.name
        child_payload["weight"] = ref["weight"]
        frozen.append(child_payload)
    payload["children"] = frozen
    return payload


def _children_refs(raw: list | None) -> list[tuple[str, float]]:
    refs = []
    for item in raw or []:
        cid = str(item.get("strategy_id") or item.get("id") or "")
        if cid:
            refs.append((cid, float(item.get("weight") or 1)))
    return refs


def _has_unpublished_changes(strategy: Strategy) -> bool:
    snap = strategy.published_snapshot
    if strategy.status != "published" or not snap:
        return False
    live = working_payload(strategy)
    keys = (
        "name",
        "description",
        "kind",
        "formula",
        "conditions",
        "basic_filter",
        "order_by",
        "descending",
        "result_limit",
        "merge_mode",
        "min_confirm",
    )
    for key in keys:
        if live.get(key) != snap.get(key):
            return True
    return _children_refs(live.get("children")) != _children_refs(snap.get("children"))


def spec_for_run(database: Session, strategy: Strategy, user_id: str) -> dict:
    if strategy.owner_id == user_id:
        payload = freeze_snapshot(database, strategy)
    else:
        existing = _subscription(database, user_id, strategy.id)
        if existing is not None and existing.snapshot:
            payload = existing.snapshot
        elif strategy.published_snapshot:
            payload = strategy.published_snapshot
        else:
            payload = freeze_snapshot(database, strategy)
    from app.services import user_factors

    payload = dict(payload)
    payload.setdefault("asset_type", normalize_asset_type(getattr(strategy, "asset_type", None)))
    payload["_extra_specs"] = user_factors.specs_for_user(database, user_id, asset_type=payload["asset_type"])
    return payload


def _subscription(database: Session, user_id: str, strategy_id: str) -> StrategySubscription | None:
    return database.scalar(
        select(StrategySubscription).where(
            StrategySubscription.user_id == user_id,
            StrategySubscription.strategy_id == strategy_id,
        )
    )


ALLOWED_BOARDS = ["沪主板", "深主板", "创业板", "科创板", "北交所"]


def normalize_basic_filter(raw: Any, asset_type: str = "stock") -> dict:
    data = raw.model_dump() if hasattr(raw, "model_dump") else dict(raw or {})
    if asset_type == "etf":
        return {
            "price_min": data.get("price_min"),
            "price_max": data.get("price_max"),
            "market_cap_min": data.get("market_cap_min"),
            "amount_min": data.get("amount_min"),
            "exclude_st": bool(data.get("exclude_st", False)),
            "boards": [],
        }
    boards = [board for board in (data.get("boards") or []) if board in ALLOWED_BOARDS]
    return {
        "price_min": data.get("price_min"),
        "price_max": data.get("price_max"),
        "market_cap_min": data.get("market_cap_min"),
        "amount_min": data.get("amount_min"),
        "exclude_st": bool(data.get("exclude_st", True)),
        "boards": boards or list(ALLOWED_BOARDS),
    }


def normalize_order_by(value: str | None) -> str:
    key = (value or "change_pct").strip()
    allowed = custom_signals.ALLOWED_FIELDS | {"symbol", "name"}
    if key not in allowed:
        raise StrategyError("invalid", f"不能按 {key} 排序")
    return key


def _load(database: Session, strategy_id: str) -> Strategy:
    strategy = database.scalar(
        select(Strategy).options(selectinload(Strategy.owner)).where(Strategy.id == strategy_id)
    )
    if strategy is None:
        raise StrategyError("not_found", "策略不存在")
    return strategy


def can_view(strategy: Strategy, user_id: str, subscribed: bool) -> bool:
    return strategy.owner_id == user_id or subscribed or strategy.status == "published"


def can_run(strategy: Strategy, user_id: str, subscribed: bool) -> bool:
    return strategy.owner_id == user_id or subscribed


def create_strategy(
    database: Session,
    owner: User,
    name: str,
    description: str,
    conditions: list[Any],
    *,
    kind: str = "conditions",
    asset_type: str = "stock",
    formula: str = "",
    children: list[Any] | None = None,
    merge_mode: str = "union",
    min_confirm: int = 1,
    basic_filter: Any = None,
    order_by: str = "change_pct",
    descending: bool = True,
    limit: int = 100,
) -> Strategy:
    kind = normalize_kind(kind)
    asset_type = normalize_asset_type(asset_type)
    child_refs = normalize_children(database, owner.id, children, asset_type=asset_type) if kind == "composite" else []
    body = normalize_conditions(conditions) if kind == "conditions" else []
    extra = _factor_codes(database, owner.id, asset_type)
    formula_text = (
        normalize_formula(formula, extra=extra)
        if kind == "formula"
        else (formula or "")
    )
    if kind == "conditions" and not body:
        raise StrategyError("invalid", "至少一条条件")
    strategy = Strategy(
        owner_id=owner.id,
        name=name,
        description=description,
        status="draft",
        asset_type=asset_type,
        kind=kind,
        formula=formula_text,
        conditions=body,
        children=child_refs,
        merge_mode=normalize_merge_mode(merge_mode),
        min_confirm=min_confirm,
        basic_filter=normalize_basic_filter(basic_filter, asset_type),
        order_by=normalize_order_by(order_by),
        descending=descending,
        result_limit=limit,
        version=0,
    )
    database.add(strategy)
    database.commit()
    database.refresh(strategy)
    return _load(database, strategy.id)


def update_strategy(
    database: Session,
    strategy: Strategy,
    *,
    name: str | None = None,
    description: str | None = None,
    kind: str | None = None,
    formula: str | None = None,
    conditions: list[Any] | None = None,
    children: list[Any] | None = None,
    merge_mode: str | None = None,
    min_confirm: int | None = None,
    basic_filter: Any = None,
    order_by: str | None = None,
    descending: bool | None = None,
    limit: int | None = None,
) -> Strategy:
    if name is not None:
        strategy.name = name
    if description is not None:
        strategy.description = description
    if kind is not None:
        strategy.kind = normalize_kind(kind)
    if formula is not None:
        strategy.formula = formula
    if conditions is not None:
        strategy.conditions = conditions
    next_kind = strategy.kind or "conditions"
    if children is not None:
        strategy.children = (
            normalize_children(database, strategy.owner_id, children, asset_type=normalize_asset_type(getattr(strategy, "asset_type", None)))
            if next_kind == "composite"
            else []
        )
    if merge_mode is not None:
        strategy.merge_mode = normalize_merge_mode(merge_mode)
    if min_confirm is not None:
        strategy.min_confirm = min_confirm
    if basic_filter is not None:
        strategy.basic_filter = normalize_basic_filter(basic_filter, normalize_asset_type(getattr(strategy, "asset_type", None)))
    if order_by is not None:
        strategy.order_by = normalize_order_by(order_by)
    if descending is not None:
        strategy.descending = descending
    if limit is not None:
        strategy.result_limit = limit
    if next_kind == "composite":
        if len(strategy.children or []) < 2:
            raise StrategyError("invalid", "叠加至少选择 2 个策略")
    elif next_kind == "formula":
        strategy.formula = normalize_formula(strategy.formula, extra=_factor_codes(database, strategy.owner_id, normalize_asset_type(getattr(strategy, "asset_type", None))))
        strategy.conditions = []
    else:
        strategy.conditions = normalize_conditions(strategy.conditions or [])
        if not strategy.conditions:
            raise StrategyError("invalid", "至少一条条件")
        strategy.formula = ""
    strategy.updated_at = utcnow()
    database.commit()
    database.refresh(strategy)
    return _load(database, strategy.id)


def publish_strategy(database: Session, strategy: Strategy) -> Strategy:
    kind = strategy.kind or "conditions"
    if kind == "composite":
        if len(strategy.children or []) < 2:
            raise StrategyError("invalid", "发布前叠加至少选择 2 个策略")
    elif kind == "formula":
        strategy.formula = normalize_formula(strategy.formula, extra=_factor_codes(database, strategy.owner_id, normalize_asset_type(getattr(strategy, "asset_type", None))))
    elif not strategy.conditions:
        raise StrategyError("invalid", "发布前至少需要一条条件")
    strategy.published_snapshot = freeze_snapshot(database, strategy)
    strategy.version = int(strategy.version or 0) + 1
    strategy.status = "published"
    if strategy.published_at is None:
        strategy.published_at = utcnow()
    strategy.updated_at = utcnow()
    database.commit()
    database.refresh(strategy)
    return _load(database, strategy.id)


def unpublish_strategy(database: Session, strategy: Strategy) -> Strategy:
    strategy.status = "draft"
    strategy.updated_at = utcnow()
    database.commit()
    database.refresh(strategy)
    return _load(database, strategy.id)


def delete_strategy(database: Session, strategy: Strategy) -> None:
    database.delete(strategy)
    database.commit()


def subscribe(database: Session, user: User, strategy: Strategy) -> Strategy:
    if strategy.owner_id == user.id:
        raise StrategyError("invalid", "不能订阅自己的策略")
    if strategy.status != "published":
        raise StrategyError("forbidden", "只能订阅已发布的策略")
    existing = _subscription(database, user.id, strategy.id)
    if existing is None:
        snapshot = strategy.published_snapshot or freeze_snapshot(database, strategy)
        version = int(strategy.version or 1)
        database.add(
            StrategySubscription(
                user_id=user.id,
                strategy_id=strategy.id,
                snapshot=snapshot,
                pinned_version=version,
            )
        )
        database.commit()
    return _load(database, strategy.id)


def accept_update(database: Session, user: User, strategy: Strategy) -> Strategy:
    if strategy.owner_id == user.id:
        raise StrategyError("invalid", "不能更新自己的订阅")
    if strategy.status != "published":
        raise StrategyError("forbidden", "策略已撤回")
    existing = _subscription(database, user.id, strategy.id)
    if existing is None:
        raise StrategyError("forbidden", "请先订阅该策略")
    snapshot = strategy.published_snapshot or freeze_snapshot(database, strategy)
    existing.snapshot = snapshot
    existing.pinned_version = int(strategy.version or 1)
    database.commit()
    return _load(database, strategy.id)


def unsubscribe(database: Session, user: User, strategy: Strategy) -> None:
    existing = _subscription(database, user.id, strategy.id)
    if existing is not None:
        database.delete(existing)
        database.commit()


def _watch_ids(database: Session, user_id: str) -> set[str]:
    rows = database.scalars(
        select(StrategyWatch.strategy_id).where(StrategyWatch.user_id == user_id)
    ).all()
    return set(rows)


def start_watch(database: Session, user: User, strategy: Strategy, subscribed: bool) -> Strategy:
    require_runner(strategy, user.id, subscribed)
    existing = database.scalar(
        select(StrategyWatch).where(
            StrategyWatch.user_id == user.id,
            StrategyWatch.strategy_id == strategy.id,
        )
    )
    if existing is None:
        database.add(StrategyWatch(user_id=user.id, strategy_id=strategy.id))
        database.commit()
    return _load(database, strategy.id)


def stop_watch(database: Session, user: User, strategy: Strategy) -> None:
    existing = database.scalar(
        select(StrategyWatch).where(
            StrategyWatch.user_id == user.id,
            StrategyWatch.strategy_id == strategy.id,
        )
    )
    if existing is not None:
        database.delete(existing)
        database.commit()


def list_watched_strategies(database: Session) -> list[Strategy]:
    return list(
        database.scalars(
            select(Strategy)
            .options(selectinload(Strategy.owner))
            .join(StrategyWatch)
            .distinct()
        ).all()
    )


def list_watches(database: Session) -> list[StrategyWatch]:
    return list(
        database.scalars(
            select(StrategyWatch).options(
                selectinload(StrategyWatch.strategy).selectinload(Strategy.owner)
            )
        ).all()
    )


def list_user_watches(database: Session, user_id: str) -> list[StrategyWatch]:
    return list(
        database.scalars(
            select(StrategyWatch)
            .options(selectinload(StrategyWatch.strategy).selectinload(Strategy.owner))
            .where(StrategyWatch.user_id == user_id)
            .order_by(StrategyWatch.created_at.desc())
        ).all()
    )



def _subscription_map(database: Session, user_id: str) -> dict[str, StrategySubscription]:
    rows = database.scalars(
        select(StrategySubscription).where(StrategySubscription.user_id == user_id)
    ).all()
    return {row.strategy_id: row for row in rows}


def list_catalog(database: Session, user_id: str, asset_type: str = "stock") -> dict[str, list[dict]]:
    mine = list(
        database.scalars(
            select(Strategy)
            .options(selectinload(Strategy.owner))
            .where(Strategy.owner_id == user_id, Strategy.is_builtin.is_(False), Strategy.asset_type == normalize_asset_type(asset_type))
            .order_by(Strategy.updated_at.desc())
        ).all()
    )
    subscribed_rows = list(
        database.scalars(
            select(Strategy)
            .options(selectinload(Strategy.owner))
            .join(StrategySubscription)
            .where(
                StrategySubscription.user_id == user_id,
                Strategy.owner_id != user_id,
                Strategy.asset_type == normalize_asset_type(asset_type),
            )
            .order_by(StrategySubscription.created_at.desc())
        ).all()
    )
    market = list(
        database.scalars(
            select(Strategy)
            .options(selectinload(Strategy.owner))
            .where(Strategy.status == "published", Strategy.asset_type == normalize_asset_type(asset_type))
            .order_by(Strategy.published_at.desc())
        ).all()
    )
    all_ids = [item.id for item in (*mine, *subscribed_rows, *market)]
    counts = _subscriber_counts(database, all_ids)
    subscribed_ids = {item.id for item in subscribed_rows}
    watch_ids = _watch_ids(database, user_id)
    subs = _subscription_map(database, user_id)
    names = {item.id: item.name for item in (*mine, *subscribed_rows, *market)}

    def pack(
        items: list[Strategy],
        *,
        view: str,
        force_subscribed: bool | None = None,
    ) -> list[dict]:
        out = []
        for item in items:
            if (item.kind or "") == "python":
                continue
            flag = True if force_subscribed else item.id in subscribed_ids
            sub = subs.get(item.id)
            payload = serialize(
                item,
                user_id=user_id,
                subscribed=flag,
                subscriber_count=counts.get(item.id, 0),
                monitoring=item.id in watch_ids,
                view=view,
                snapshot=None if sub is None else sub.snapshot,
                pinned_version=None if sub is None else sub.pinned_version,
            )
            for child in payload["children"]:
                if not child.get("name"):
                    child["name"] = names.get(child["strategy_id"], child["strategy_id"])
            out.append(payload)
        return out

    return {
        "mine": pack(mine, view="working", force_subscribed=False),
        "subscribed": pack(subscribed_rows, view="pinned", force_subscribed=True),
        "market": pack(market, view="published"),
    }


def get_visible(database: Session, user_id: str, strategy_id: str) -> tuple[Strategy, bool]:
    strategy = _load(database, strategy_id)
    subscribed = strategy.id in _subscribed_ids(database, user_id)
    if not can_view(strategy, user_id, subscribed):
        raise StrategyError("not_found", "策略不存在")
    return strategy, subscribed


def require_owner(strategy: Strategy, user_id: str) -> None:
    if strategy.owner_id != user_id:
        raise StrategyError("forbidden", "只能操作自己的策略")


def require_runner(strategy: Strategy, user_id: str, subscribed: bool) -> None:
    if not can_run(strategy, user_id, subscribed):
        raise StrategyError("forbidden", "请先订阅该策略")


def field_options() -> dict:
    from app.indicators.pipeline import ENRICHED_COLUMNS, ENRICHED_COLUMNS_BY_CATEGORY

    allowed = custom_signals.ALLOWED_FIELDS
    quote_fields = {
        "open",
        "high",
        "low",
        "close",
        "volume",
        "amount",
        "turnover_rate",
        "consecutive_limit_ups",
        "consecutive_limit_downs",
    }
    group_labels = {
        "basic": "基础",
        "ma": "均线 MA",
        "ema": "指数均线 EMA",
        "macd": "MACD",
        "boll": "布林带 BOLL",
        "kdj": "KDJ",
        "atr": "ATR",
        "volume": "量价",
        "extremes": "极值",
        "momentum": "动量",
        "deviation": "偏离",
        "volatility": "波动率",
        "rsi": "RSI",
    }

    def labeled(keys: list[str] | set[str]) -> list[dict[str, str]]:
        return [{"key": key, "label": str(ENRICHED_COLUMNS.get(key, key))} for key in keys if key in allowed]

    groups = [{"key": "quote", "label": "行情", "fields": labeled(sorted(allowed & quote_fields))}]
    for cat, label in group_labels.items():
        fields = labeled(ENRICHED_COLUMNS_BY_CATEGORY.get(cat, []))
        if fields:
            groups.append({"key": cat, "label": label, "fields": fields})
    fields = [field for group in groups for field in group["fields"]]
    from app.services import formula_runtime

    meta = formula_runtime.formula_meta()
    return {
        "fields": fields,
        "groups": groups,
        "maxDays": custom_signals.MAX_DAYS,
        "operators": [">", ">=", "<", "<=", "==", "!="],
        "stringOperators": ["contains", "==", "!="],
        "formula_operators": meta["operators"],
        "base_columns": meta["base_columns"],
        "examples": meta["examples"],
    }
