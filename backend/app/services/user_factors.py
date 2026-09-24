"""用户因子：公式 DSL 定义、发布、订阅。列名 = code，写入策略公式。"""
from __future__ import annotations

import re
import uuid
from collections.abc import Collection, Iterable
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.factors.registry import FactorSpec
from app.models import Factor, FactorSubscription, User
from app.security import utcnow
from app.services import formula_runtime

CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
DIRECTIONS = frozenset({"high", "low", "none"})


class FactorError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def compile_user_formula(formula: str, extra: Collection[str] | None = None):
    try:
        return formula_runtime.compile_user_formula(formula, extra)
    except ValueError as exc:
        raise FactorError("invalid", str(exc)) from exc


def reserved_codes() -> set[str]:
    reserved = set(formula_runtime.known_identifiers())
    reserved.update({"symbol", "name", "date"})
    return reserved


def normalize_code(value: str | None) -> str:
    code = (value or "").strip().lower()
    if not code:
        code = "f" + uuid.uuid4().hex[:10]
    if not CODE_RE.match(code):
        raise FactorError("invalid", "代码须为小写字母开头，仅含字母数字下划线，最长 40")
    if code in reserved_codes():
        raise FactorError("invalid", f"代码 {code} 已被内置字段占用")
    return code


def normalize_direction(value: str | None) -> str:
    direction = (value or "none").strip()
    if direction not in DIRECTIONS:
        raise FactorError("invalid", "方向只能是 high / low / none")
    return direction


def working_payload(factor: Factor) -> dict:
    return {
        "code": factor.code,
        "name": factor.name,
        "description": factor.description or "",
        "formula": factor.formula,
        "direction": factor.direction or "none",
    }


def _display_source(payload: dict, live: Factor | None = None) -> dict:
    return {
        "code": payload.get("code") or (live.code if live is not None else ""),
        "name": payload.get("name") or (live.name if live is not None else ""),
        "description": payload.get("description", ""),
        "formula": payload.get("formula") or (live.formula if live is not None else ""),
        "direction": payload.get("direction") or "none",
    }


def _view_source(factor: Factor, view: str, snapshot: dict | None) -> dict:
    if view == "pinned" and snapshot:
        return _display_source(snapshot)
    if view == "published":
        published = factor.published_snapshot
        if published:
            return _display_source(published)
    return _display_source(working_payload(factor), live=factor)


def _has_unpublished_changes(factor: Factor) -> bool:
    snap = factor.published_snapshot
    if factor.status != "published" or not snap:
        return False
    live = working_payload(factor)
    return any(live.get(key) != snap.get(key) for key in ("name", "description", "formula", "direction"))


def payload_to_spec(payload: dict, *, extra: Collection[str] | None = None) -> FactorSpec:
    formula = str(payload.get("formula") or "")
    compiled = compile_user_formula(formula, extra)
    code = str(payload.get("code") or "")
    return FactorSpec(
        id=code,
        label=str(payload.get("name") or code),
        group="自定义",
        formula_text=formula,
        kind="custom",
        version=int(payload.get("version") or 1),
        dependencies=compiled.dependencies,
        warmup_bars=compiled.warmup_bars,
        direction=str(payload.get("direction") or "none"),  # type: ignore[arg-type]
        stability="stable",
    )


def serialize(
    factor: Factor,
    *,
    user_id: str,
    subscribed: bool,
    subscriber_count: int,
    view: str = "working",
    snapshot: dict | None = None,
    pinned_version: int | None = None,
) -> dict:
    owner = factor.owner
    source = _view_source(factor, view, snapshot)
    version = int(factor.version or 0)
    pinned = 0 if pinned_version is None else int(pinned_version)
    warmup = 1
    try:
        warmup = compile_user_formula(str(source.get("formula") or "")).warmup_bars
    except FactorError:
        pass
    return {
        "id": factor.id,
        "code": source.get("code") or factor.code,
        "name": source.get("name") or factor.name,
        "description": source.get("description") or "",
        "formula": source.get("formula") or "",
        "direction": source.get("direction") or "none",
        "status": factor.status,
        "owner_id": factor.owner_id,
        "owner_username": owner.username if owner is not None else "",
        "subscriber_count": subscriber_count,
        "subscribed": subscribed,
        "is_owner": factor.owner_id == user_id,
        "asset_type": str(getattr(factor, "asset_type", None) or "stock"),
        "version": version,
        "warmup_bars": warmup,
        "has_unpublished_changes": factor.owner_id == user_id and _has_unpublished_changes(factor),
        "update_available": subscribed and version > pinned,
        "created_at": factor.created_at,
        "updated_at": factor.updated_at,
        "published_at": factor.published_at,
    }


def _load(database: Session, factor_id: str) -> Factor:
    factor = database.scalar(
        select(Factor).options(selectinload(Factor.owner)).where(Factor.id == factor_id)
    )
    if factor is None:
        raise FactorError("not_found", "因子不存在")
    return factor


def _subscription(database: Session, user_id: str, factor_id: str) -> FactorSubscription | None:
    return database.scalar(
        select(FactorSubscription).where(
            FactorSubscription.user_id == user_id,
            FactorSubscription.factor_id == factor_id,
        )
    )


def _subscribed_ids(database: Session, user_id: str) -> set[str]:
    rows = database.scalars(
        select(FactorSubscription.factor_id).where(FactorSubscription.user_id == user_id)
    ).all()
    return set(rows)


def _subscriber_counts(database: Session, factor_ids: list[str]) -> dict[str, int]:
    if not factor_ids:
        return {}
    rows = database.execute(
        select(FactorSubscription.factor_id, func.count())
        .where(FactorSubscription.factor_id.in_(factor_ids))
        .group_by(FactorSubscription.factor_id)
    ).all()
    return {factor_id: int(count) for factor_id, count in rows}


def _subscription_map(database: Session, user_id: str) -> dict[str, FactorSubscription]:
    rows = database.scalars(
        select(FactorSubscription).where(FactorSubscription.user_id == user_id)
    ).all()
    return {row.factor_id: row for row in rows}


def can_view(factor: Factor, user_id: str, subscribed: bool) -> bool:
    return factor.owner_id == user_id or subscribed or factor.status == "published"


def can_run(factor: Factor, user_id: str, subscribed: bool) -> bool:
    return factor.owner_id == user_id or subscribed


def get_visible(database: Session, user_id: str, factor_id: str) -> tuple[Factor, bool]:
    factor = _load(database, factor_id)
    subscribed = factor.id in _subscribed_ids(database, user_id)
    if not can_view(factor, user_id, subscribed):
        raise FactorError("not_found", "因子不存在")
    return factor, subscribed


def require_owner(factor: Factor, user_id: str) -> None:
    if factor.owner_id != user_id:
        raise FactorError("forbidden", "只能操作自己的因子")


def require_runner(factor: Factor, user_id: str, subscribed: bool) -> None:
    if not can_run(factor, user_id, subscribed):
        raise FactorError("forbidden", "请先订阅该因子")


def create_factor(
    database: Session,
    owner: User,
    name: str,
    formula: str,
    *,
    code: str | None = None,
    description: str = "",
    direction: str = "none",
    asset_type: str = "stock",
) -> Factor:
    code = normalize_code(code)
    existing = database.scalar(select(Factor).where(Factor.code == code))
    if existing is not None:
        raise FactorError("conflict", f"代码 {code} 已被占用")
    compile_user_formula(formula)
    asset_type = (asset_type or "stock").strip().lower()
    if asset_type not in {"stock", "etf"}:
        raise FactorError("invalid", "资产类型只能是股票或ETF")
    factor = Factor(
        owner_id=owner.id,
        code=code,
        name=name,
        description=description,
        formula=formula,
        direction=normalize_direction(direction),
        asset_type=asset_type,
        status="draft",
        version=0,
    )
    database.add(factor)
    database.commit()
    database.refresh(factor)
    return _load(database, factor.id)


def update_factor(
    database: Session,
    factor: Factor,
    *,
    name: str | None = None,
    description: str | None = None,
    formula: str | None = None,
    direction: str | None = None,
) -> Factor:
    if name is not None:
        factor.name = name
    if description is not None:
        factor.description = description
    if formula is not None:
        compile_user_formula(formula)
        factor.formula = formula
    if direction is not None:
        factor.direction = normalize_direction(direction)
    factor.updated_at = utcnow()
    database.commit()
    database.refresh(factor)
    return _load(database, factor.id)


def publish_factor(database: Session, factor: Factor) -> Factor:
    compile_user_formula(factor.formula)
    factor.published_snapshot = working_payload(factor)
    factor.version = int(factor.version or 0) + 1
    factor.status = "published"
    if factor.published_at is None:
        factor.published_at = utcnow()
    factor.updated_at = utcnow()
    database.commit()
    database.refresh(factor)
    return _load(database, factor.id)


def unpublish_factor(database: Session, factor: Factor) -> Factor:
    factor.status = "draft"
    factor.updated_at = utcnow()
    database.commit()
    database.refresh(factor)
    return _load(database, factor.id)


def delete_factor(database: Session, factor: Factor) -> None:
    database.delete(factor)
    database.commit()


def subscribe(database: Session, user: User, factor: Factor) -> Factor:
    if factor.owner_id == user.id:
        raise FactorError("invalid", "不能订阅自己的因子")
    if factor.status != "published":
        raise FactorError("forbidden", "只能订阅已发布的因子")
    existing = _subscription(database, user.id, factor.id)
    if existing is None:
        snapshot = factor.published_snapshot or working_payload(factor)
        version = int(factor.version or 1)
        database.add(
            FactorSubscription(
                user_id=user.id,
                factor_id=factor.id,
                snapshot=snapshot,
                pinned_version=version,
            )
        )
        database.commit()
    return _load(database, factor.id)


def accept_update(database: Session, user: User, factor: Factor) -> Factor:
    if factor.owner_id == user.id:
        raise FactorError("invalid", "不能更新自己的订阅")
    if factor.status != "published":
        raise FactorError("forbidden", "因子已撤回")
    existing = _subscription(database, user.id, factor.id)
    if existing is None:
        raise FactorError("forbidden", "请先订阅该因子")
    existing.snapshot = factor.published_snapshot or working_payload(factor)
    existing.pinned_version = int(factor.version or 1)
    database.commit()
    return _load(database, factor.id)


def unsubscribe(database: Session, user: User, factor: Factor) -> None:
    existing = _subscription(database, user.id, factor.id)
    if existing is not None:
        database.delete(existing)
        database.commit()


def list_catalog(database: Session, user_id: str, asset_type: str = "stock") -> dict[str, list[dict]]:
    asset_type = (asset_type or "stock").strip().lower() or "stock"
    mine = list(
        database.scalars(
            select(Factor)
            .options(selectinload(Factor.owner))
            .where(Factor.owner_id == user_id, Factor.asset_type == asset_type)
            .order_by(Factor.updated_at.desc())
        ).all()
    )
    subscribed_rows = list(
        database.scalars(
            select(Factor)
            .options(selectinload(Factor.owner))
            .join(FactorSubscription)
            .where(
                FactorSubscription.user_id == user_id,
                Factor.owner_id != user_id,
                Factor.asset_type == asset_type,
            )
            .order_by(FactorSubscription.created_at.desc())
        ).all()
    )
    market = list(
        database.scalars(
            select(Factor)
            .options(selectinload(Factor.owner))
            .where(Factor.status == "published", Factor.asset_type == asset_type)
            .order_by(Factor.published_at.desc())
        ).all()
    )
    all_ids = [item.id for item in (*mine, *subscribed_rows, *market)]
    counts = _subscriber_counts(database, all_ids)
    subscribed_ids = {item.id for item in subscribed_rows}
    subs = _subscription_map(database, user_id)

    def pack(items: list[Factor], *, view: str, force_subscribed: bool | None = None) -> list[dict]:
        out = []
        for item in items:
            flag = True if force_subscribed else item.id in subscribed_ids
            sub = subs.get(item.id)
            out.append(
                serialize(
                    item,
                    user_id=user_id,
                    subscribed=flag,
                    subscriber_count=counts.get(item.id, 0),
                    view=view,
                    snapshot=None if sub is None else sub.snapshot,
                    pinned_version=None if sub is None else sub.pinned_version,
                )
            )
        return out

    return {
        "mine": pack(mine, view="working", force_subscribed=False),
        "subscribed": pack(subscribed_rows, view="pinned", force_subscribed=True),
        "market": pack(market, view="published"),
    }


def spec_for_run(database: Session, factor: Factor, user_id: str) -> FactorSpec:
    if factor.owner_id == user_id:
        payload = working_payload(factor)
    else:
        existing = _subscription(database, user_id, factor.id)
        if existing is not None and existing.snapshot:
            payload = existing.snapshot
        elif factor.published_snapshot:
            payload = factor.published_snapshot
        else:
            payload = working_payload(factor)
    payload = dict(payload)
    payload.setdefault("code", factor.code)
    payload["version"] = factor.version or 1
    return payload_to_spec(payload)


def specs_for_user(
    database: Session,
    user_id: str,
    codes: Iterable[str] | None = None,
    asset_type: str = "stock",
) -> dict[str, FactorSpec]:
    wanted = {str(code) for code in (codes or []) if code}
    catalog = list_catalog(database, user_id, asset_type=asset_type)
    visible = {item["code"]: item for item in (*catalog["mine"], *catalog["subscribed"])}
    if not wanted:
        wanted = set(visible)
    out: dict[str, FactorSpec] = {}
    pending = set(wanted)
    while pending:
        code = pending.pop()
        if code in out:
            continue
        item = visible.get(code)
        if item is None:
            continue
        factor, _ = get_visible(database, user_id, item["id"])
        spec = spec_for_run(database, factor, user_id)
        out[spec.id] = spec
        pending.update(dep for dep in spec.dependencies if dep in visible and dep not in out)
    return out


def specs_for_formula(database: Session, user_id: str, formula: str) -> dict[str, FactorSpec]:
    del formula
    return specs_for_user(database, user_id)
