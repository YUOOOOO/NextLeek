from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.deps import get_database, require_csrf, require_user
from app.models import User
from app.schemas import (
    FactorCatalog,
    FactorCompileIn,
    FactorCreate,
    FactorGenerateIn,
    FactorRead,
    FactorResearchIn,
    FactorUpdate,
    FormulaPreview,
)
from app.services import formula_ai, formula_research, formula_runtime, user_factors as svc

router = APIRouter(
    prefix="/api/factors",
    tags=["factors"],
    dependencies=[Depends(require_csrf)],
)


def _http(exc: svc.FactorError) -> HTTPException:
    mapping = {
        "not_found": status.HTTP_404_NOT_FOUND,
        "forbidden": status.HTTP_403_FORBIDDEN,
        "invalid": status.HTTP_400_BAD_REQUEST,
        "conflict": status.HTTP_409_CONFLICT,
    }
    return HTTPException(status_code=mapping.get(exc.code, status.HTTP_400_BAD_REQUEST), detail=exc.message)


def _read(factor, *, user_id: str, database, view: str | None = None) -> FactorRead:
    subscribed = factor.id in svc._subscribed_ids(database, user_id)
    counts = svc._subscriber_counts(database, [factor.id])
    sub = svc._subscription(database, user_id, factor.id)
    if view is None:
        view = "working" if factor.owner_id == user_id else ("pinned" if subscribed else "published")
    return FactorRead.model_validate(
        svc.serialize(
            factor,
            user_id=user_id,
            subscribed=subscribed,
            subscriber_count=counts.get(factor.id, 0),
            view=view,
            snapshot=None if sub is None else sub.snapshot,
            pinned_version=None if sub is None else sub.pinned_version,
        )
    )


@router.get("/options")
def options(_: User = Depends(require_user)) -> dict:
    return formula_runtime.formula_meta()


@router.post("/compile", response_model=FormulaPreview)
def compile_factor(payload: FactorCompileIn, _: User = Depends(require_user)) -> FormulaPreview:
    return FormulaPreview.model_validate(formula_runtime.preview(payload.formula))


@router.post("/generate")
async def generate_factor(payload: FactorGenerateIn, _: User = Depends(require_user)) -> dict:
    try:
        return await formula_ai.generate_formula(payload.prompt, "factor")
    except formula_ai.FormulaAIError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc


@router.post("/mine")
def mine_factors(
    payload: FactorResearchIn,
    request: Request,
    _: User = Depends(require_user),
) -> dict:
    from app.services.screener import ScreenerService

    screener = ScreenerService(request.app.state.repo)
    as_of = screener.latest_date()
    if as_of is None:
        return {"ok": False, "warning": "本地暂无行情", "items": []}
    return formula_research.mine_factors(screener, as_of, days=payload.days, horizon=payload.horizon)


@router.get("", response_model=FactorCatalog)
def list_factors(
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
    asset_type: str = "stock",
) -> FactorCatalog:
    return FactorCatalog.model_validate(svc.list_catalog(database, user.id, asset_type=asset_type))


@router.post("", response_model=FactorRead, status_code=status.HTTP_201_CREATED)
def create_factor(
    payload: FactorCreate,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> FactorRead:
    try:
        factor = svc.create_factor(
            database,
            user,
            payload.name,
            payload.formula,
            code=payload.code,
            description=payload.description,
            direction=payload.direction,
            asset_type=payload.asset_type,
        )
    except svc.FactorError as exc:
        raise _http(exc) from exc
    return _read(factor, user_id=user.id, database=database)


@router.get("/{factor_id}", response_model=FactorRead)
def get_factor(
    factor_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> FactorRead:
    try:
        factor, _ = svc.get_visible(database, user.id, factor_id)
    except svc.FactorError as exc:
        raise _http(exc) from exc
    return _read(factor, user_id=user.id, database=database)


@router.patch("/{factor_id}", response_model=FactorRead)
def update_factor(
    factor_id: str,
    payload: FactorUpdate,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> FactorRead:
    try:
        factor, _ = svc.get_visible(database, user.id, factor_id)
        svc.require_owner(factor, user.id)
        factor = svc.update_factor(
            database,
            factor,
            name=payload.name,
            description=payload.description,
            formula=payload.formula,
            direction=payload.direction,
        )
    except svc.FactorError as exc:
        raise _http(exc) from exc
    return _read(factor, user_id=user.id, database=database)


@router.delete("/{factor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_factor(
    factor_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> None:
    try:
        factor, _ = svc.get_visible(database, user.id, factor_id)
        svc.require_owner(factor, user.id)
        svc.delete_factor(database, factor)
    except svc.FactorError as exc:
        raise _http(exc) from exc


@router.post("/{factor_id}/publish", response_model=FactorRead)
def publish_factor(
    factor_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> FactorRead:
    try:
        factor, _ = svc.get_visible(database, user.id, factor_id)
        svc.require_owner(factor, user.id)
        factor = svc.publish_factor(database, factor)
    except svc.FactorError as exc:
        raise _http(exc) from exc
    return _read(factor, user_id=user.id, database=database)


@router.post("/{factor_id}/unpublish", response_model=FactorRead)
def unpublish_factor(
    factor_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> FactorRead:
    try:
        factor, _ = svc.get_visible(database, user.id, factor_id)
        svc.require_owner(factor, user.id)
        factor = svc.unpublish_factor(database, factor)
    except svc.FactorError as exc:
        raise _http(exc) from exc
    return _read(factor, user_id=user.id, database=database)


@router.post("/{factor_id}/subscription", response_model=FactorRead)
def subscribe_factor(
    factor_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> FactorRead:
    try:
        factor, _ = svc.get_visible(database, user.id, factor_id)
        factor = svc.subscribe(database, user, factor)
    except svc.FactorError as exc:
        raise _http(exc) from exc
    return _read(factor, user_id=user.id, database=database)


@router.post("/{factor_id}/subscription/update", response_model=FactorRead)
def update_subscription(
    factor_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> FactorRead:
    try:
        factor, _ = svc.get_visible(database, user.id, factor_id)
        factor = svc.accept_update(database, user, factor)
    except svc.FactorError as exc:
        raise _http(exc) from exc
    return _read(factor, user_id=user.id, database=database)


@router.delete("/{factor_id}/subscription", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe_factor(
    factor_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> None:
    try:
        factor, _ = svc.get_visible(database, user.id, factor_id)
        svc.unsubscribe(database, user, factor)
    except svc.FactorError as exc:
        raise _http(exc) from exc


@router.post("/{factor_id}/research")
def research_factor(
    factor_id: str,
    payload: FactorResearchIn,
    request: Request,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> dict:
    try:
        factor, subscribed = svc.get_visible(database, user.id, factor_id)
        svc.require_runner(factor, user.id, subscribed)
    except svc.FactorError as exc:
        raise _http(exc) from exc
    from app.services.screener import ScreenerService

    screener = ScreenerService(request.app.state.repo, asset_type=getattr(factor, "asset_type", "stock") or "stock")
    as_of = screener.latest_date()
    if as_of is None:
        return {"ok": False, "warning": "本地暂无行情"}
    spec = svc.spec_for_run(database, factor, user.id)
    extra = svc.specs_for_user(database, user.id, asset_type=getattr(factor, "asset_type", "stock") or "stock")
    return formula_research.research_factor(
        screener,
        as_of,
        spec.formula_text,
        days=payload.days,
        horizon=payload.horizon,
        extra_specs=extra,
        code=spec.id,
        start=payload.start,
        end=payload.end,
    )
