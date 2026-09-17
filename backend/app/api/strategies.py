from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.deps import get_database, require_csrf, require_user
from app.models import User
from app.schemas import (
    FormulaPreview,
    StrategyCatalog,
    StrategyCompileIn,
    StrategyCreate,
    StrategyGenerateIn,
    StrategyRead,
    StrategyResearchIn,
    StrategyRunResult,
    StrategyUpdate,
)
from app.services import user_strategies as svc

router = APIRouter(
    prefix="/api/strategies",
    tags=["strategies"],
    dependencies=[Depends(require_csrf)],
)


def _http(exc: svc.StrategyError) -> HTTPException:
    mapping = {
        "not_found": status.HTTP_404_NOT_FOUND,
        "forbidden": status.HTTP_403_FORBIDDEN,
        "invalid": status.HTTP_400_BAD_REQUEST,
        "conflict": status.HTTP_409_CONFLICT,
    }
    return HTTPException(status_code=mapping.get(exc.code, status.HTTP_400_BAD_REQUEST), detail=exc.message)


def _read(strategy, *, user_id: str, database, view: str | None = None) -> StrategyRead:
    subscribed = strategy.id in svc._subscribed_ids(database, user_id)
    counts = svc._subscriber_counts(database, [strategy.id])
    sub = svc._subscription(database, user_id, strategy.id)
    if view is None:
        if strategy.owner_id == user_id:
            view = "working"
        elif subscribed:
            view = "pinned"
        else:
            view = "published"
    return StrategyRead.model_validate(
        svc.serialize(
            strategy,
            user_id=user_id,
            subscribed=subscribed,
            subscriber_count=counts.get(strategy.id, 0),
            monitoring=strategy.id in svc._watch_ids(database, user_id),
            view=view,
            snapshot=None if sub is None else sub.snapshot,
            pinned_version=None if sub is None else sub.pinned_version,
        )
    )


@router.get("/options")
def options(_: User = Depends(require_user)) -> dict:
    return svc.field_options()


@router.post("/compile", response_model=FormulaPreview)
def compile_strategy(payload: StrategyCompileIn, _: User = Depends(require_user)) -> FormulaPreview:
    from app.services import formula_runtime

    return FormulaPreview.model_validate(formula_runtime.preview(payload.formula))


@router.post("/generate")
async def generate_strategy(payload: StrategyGenerateIn, _: User = Depends(require_user)) -> dict:
    from app.services import formula_ai

    try:
        return await formula_ai.generate_formula(payload.prompt, "strategy")
    except formula_ai.FormulaAIError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc


@router.post("/mine")
def mine_strategies(
    payload: StrategyResearchIn,
    request: Request,
    _: User = Depends(require_user),
) -> dict:
    from app.services import formula_research
    from app.services.screener import ScreenerService

    screener = ScreenerService(request.app.state.repo)
    as_of = screener.latest_date()
    if as_of is None:
        return {"ok": False, "warning": "本地暂无行情", "items": []}
    return formula_research.mine_strategies(screener, as_of, days=payload.days, horizon=payload.horizon)


@router.get("", response_model=StrategyCatalog)
def list_strategies(
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyCatalog:
    return StrategyCatalog.model_validate(svc.list_catalog(database, user.id))


@router.post("", response_model=StrategyRead, status_code=status.HTTP_201_CREATED)
def create_strategy(
    payload: StrategyCreate,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRead:
    try:
        strategy = svc.create_strategy(
            database,
            user,
            payload.name,
            payload.description,
            payload.conditions,
            kind=payload.kind,
            formula=payload.formula,
            children=payload.children,
            merge_mode=payload.merge_mode,
            min_confirm=payload.min_confirm,
            basic_filter=payload.basic_filter,
            order_by=payload.order_by,
            descending=payload.descending,
            limit=payload.limit,
        )
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    return _read(strategy, user_id=user.id, database=database)


@router.get("/{strategy_id}", response_model=StrategyRead)
def get_strategy(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRead:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    return _read(strategy, user_id=user.id, database=database)


@router.patch("/{strategy_id}", response_model=StrategyRead)
def update_strategy(
    strategy_id: str,
    payload: StrategyUpdate,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRead:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
        svc.require_owner(strategy, user.id)
        strategy = svc.update_strategy(
            database,
            strategy,
            name=payload.name,
            description=payload.description,
            kind=payload.kind,
            formula=payload.formula,
            conditions=payload.conditions,
            children=payload.children,
            merge_mode=payload.merge_mode,
            min_confirm=payload.min_confirm,
            basic_filter=payload.basic_filter,
            order_by=payload.order_by,
            descending=payload.descending,
            limit=payload.limit,
        )
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    return _read(strategy, user_id=user.id, database=database)


@router.delete("/{strategy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_strategy(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> None:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
        svc.require_owner(strategy, user.id)
        svc.delete_strategy(database, strategy)
    except svc.StrategyError as exc:
        raise _http(exc) from exc


@router.post("/{strategy_id}/publish", response_model=StrategyRead)
def publish_strategy(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRead:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
        svc.require_owner(strategy, user.id)
        strategy = svc.publish_strategy(database, strategy)
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    return _read(strategy, user_id=user.id, database=database)


@router.post("/{strategy_id}/unpublish", response_model=StrategyRead)
def unpublish_strategy(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRead:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
        svc.require_owner(strategy, user.id)
        strategy = svc.unpublish_strategy(database, strategy)
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    return _read(strategy, user_id=user.id, database=database)


@router.post("/{strategy_id}/subscription", response_model=StrategyRead)
def subscribe_strategy(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRead:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
        strategy = svc.subscribe(database, user, strategy)
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    return _read(strategy, user_id=user.id, database=database)

@router.post("/{strategy_id}/subscription/update", response_model=StrategyRead)
def update_subscription(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRead:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
        strategy = svc.accept_update(database, user, strategy)
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    return _read(strategy, user_id=user.id, database=database)



@router.delete("/{strategy_id}/subscription", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe_strategy(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> None:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
        svc.unsubscribe(database, user, strategy)
    except svc.StrategyError as exc:
        raise _http(exc) from exc


@router.post("/{strategy_id}/monitor", response_model=StrategyRead)
def start_strategy_monitor(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRead:
    try:
        strategy, subscribed = svc.get_visible(database, user.id, strategy_id)
        strategy = svc.start_watch(database, user, strategy, subscribed)
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    return _read(strategy, user_id=user.id, database=database)


@router.delete("/{strategy_id}/monitor", status_code=status.HTTP_204_NO_CONTENT)
def stop_strategy_monitor(
    strategy_id: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> None:
    try:
        strategy, _ = svc.get_visible(database, user.id, strategy_id)
        svc.stop_watch(database, user, strategy)
    except svc.StrategyError as exc:
        raise _http(exc) from exc

@router.post("/{strategy_id}/run", response_model=StrategyRunResult)
def run_strategy(
    strategy_id: str,
    request: Request,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> StrategyRunResult:
    try:
        strategy, subscribed = svc.get_visible(database, user.id, strategy_id)
        svc.require_runner(strategy, user.id, subscribed)
    except svc.StrategyError as exc:
        raise _http(exc) from exc

    from app.services.screener import ScreenerService
    from app.services.strategy_runtime import execute_spec

    repo = request.app.state.repo
    screener = ScreenerService(repo)
    as_of = screener.latest_date()
    if as_of is None:
        return StrategyRunResult(
            as_of=None,
            strategy_id=strategy.id,
            rows=[],
            total=0,
            elapsed_ms=0,
            warnings=["本地暂无 enriched 数据，请先在数据页同步日K并计算指标"],
        )
    warnings = screener.coverage_warnings(as_of)
    spec = svc.spec_for_run(database, strategy, user.id)
    result = execute_spec(screener, as_of, spec)
    return StrategyRunResult(
        as_of=as_of.isoformat(),
        strategy_id=strategy.id,
        rows=result.rows,
        total=result.total,
        elapsed_ms=round(result.elapsed_ms, 1),
        warnings=warnings,
    )


@router.post("/{strategy_id}/research")
def research_strategy(
    strategy_id: str,
    payload: StrategyResearchIn,
    request: Request,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> dict:
    try:
        strategy, subscribed = svc.get_visible(database, user.id, strategy_id)
        svc.require_runner(strategy, user.id, subscribed)
    except svc.StrategyError as exc:
        raise _http(exc) from exc
    from app.services import formula_research
    from app.services.screener import ScreenerService

    screener = ScreenerService(request.app.state.repo)
    as_of = screener.latest_date()
    if as_of is None:
        return {"ok": False, "warning": "本地暂无行情"}
    spec = svc.spec_for_run(database, strategy, user.id)
    kind = spec.get("kind") or "conditions"
    extra = spec.get("_extra_specs") or {}
    if kind == "formula":
        return formula_research.research_strategy(
            screener,
            as_of,
            spec.get("formula") or "",
            days=payload.days,
            horizon=payload.horizon,
            extra_specs=extra,
            basic_filter=spec.get("basic_filter") or {},
        )
    raise HTTPException(status_code=400, detail="回测目前支持公式策略")
