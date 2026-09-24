"""展示信号：内置只读 + 自定义条件信号 CRUD。"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.deps import require_csrf, require_user
from app.models import User
from app.services.display_tags import BUILTIN_IDS, catalog
from app.services.user_strategies import field_options
from app.strategy import custom_signals

router = APIRouter(
    prefix="/api/custom-signals",
    tags=["custom-signals"],
    dependencies=[Depends(require_csrf), Depends(require_user)],
)


def _data_dir(request: Request) -> Path:
    repo = getattr(request.app.state, "repo", None)
    if repo is not None:
        return repo.store.data_dir
    from app.config import get_settings

    return get_settings().data_dir


def _invalidate(request: Request) -> None:
    from app.indicators.pipeline import invalidate_custom_signals

    invalidate_custom_signals()
    repo = getattr(request.app.state, "repo", None)
    if repo is not None and hasattr(repo, "clear_cache"):
        try:
            repo.clear_cache()
        except Exception:
            pass


class ConditionModel(BaseModel):
    left: str
    op: str
    right: Any
    leftDays: int = 0
    rightDays: int = 0


class SignalModel(BaseModel):
    id: str
    name: str
    kind: str = "both"
    enabled: bool = True
    tone: str = "bull"
    description: str = ""
    timeframe: str = custom_signals.TIMEFRAME_DAILY
    asset_type: str = "stock"
    conditions: list[ConditionModel] = Field(min_length=1)


@router.get("/options")
def get_options(_: User = Depends(require_user)) -> dict:
    return field_options()


@router.get("")
def list_signals(request: Request, _: User = Depends(require_user), asset_type: str | None = None) -> dict:
    return catalog(_data_dir(request), asset_type)


@router.post("")
def save_signal(req: SignalModel, request: Request, _: User = Depends(require_user)) -> dict:
    if req.id in BUILTIN_IDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="内置信号不可修改")
    if req.tone not in {"bull", "bear", "neutral"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tone 必须是 bull / bear / neutral")
    sig = req.model_dump()
    try:
        custom_signals.validate(sig)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    custom_signals.save_one(_data_dir(request), sig)
    _invalidate(request)
    return {"ok": True, "signal": catalog(_data_dir(request), req.asset_type)}


@router.delete("/{signal_id}")
def delete_signal(signal_id: str, request: Request, _: User = Depends(require_user)) -> dict:
    if signal_id in BUILTIN_IDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="内置信号不可取消")
    if not custom_signals.ID_RE.match(signal_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="信号 id 非法")
    deleted = custom_signals.delete_one(_data_dir(request), signal_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="信号不存在")
    _invalidate(request)
    return {"ok": True}
