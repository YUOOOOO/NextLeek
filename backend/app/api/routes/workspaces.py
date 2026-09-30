from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

Kind = Literal["research", "strategies", "live"]
RuntimeState = Literal["enabled", "paused"]

router = APIRouter(prefix="/workspaces", tags=["workspaces"])
_state_file = Path(os.getenv("NEXTLEEK_WORKSPACE_STATE", "data/v3-workspaces.json"))
_lock = RLock()


class WorkspaceItemIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=280)
    detail: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list, max_length=8)


class RuntimeStateIn(BaseModel):
    state: RuntimeState


def _empty_state() -> dict[str, list[dict[str, object]]]:
    return {"research": [], "strategies": [], "live": []}


def _read_state() -> dict[str, list[dict[str, object]]]:
    with _lock:
        if not _state_file.exists():
            return _empty_state()
        try:
            raw = json.loads(_state_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return _empty_state()
        state = _empty_state()
        for kind in state:
            items = raw.get(kind, [])
            state[kind] = items if isinstance(items, list) else []
        return state


def _write_state(state: dict[str, list[dict[str, object]]]) -> None:
    with _lock:
        _state_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = _state_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(_state_file)


@router.get("/{kind}")
async def list_workspace(kind: Kind) -> dict[str, object]:
    state = _read_state()
    items = state[kind]
    return {"kind": kind, "count": len(items), "items": items}


@router.post("/{kind}", status_code=status.HTTP_201_CREATED)
async def create_workspace_item(kind: Kind, payload: WorkspaceItemIn) -> dict[str, object]:
    with _lock:
        state = _read_state()
        now = datetime.now(UTC).isoformat()
        item: dict[str, object] = {
            "id": uuid4().hex,
            "name": payload.name.strip(),
            "description": payload.description.strip(),
            "detail": payload.detail.strip(),
            "tags": [tag.strip() for tag in payload.tags if tag.strip()],
            "state": "paused" if kind == "live" else "draft",
            "created_at": now,
            "updated_at": now,
        }
        state[kind].insert(0, item)
        _write_state(state)
        return item


@router.patch("/live/{item_id}/state")
async def update_runtime_state(item_id: str, payload: RuntimeStateIn) -> dict[str, object]:
    with _lock:
        state = _read_state()
        for item in state["live"]:
            if item.get("id") == item_id:
                item["state"] = payload.state
                item["updated_at"] = datetime.now(UTC).isoformat()
                _write_state(state)
                return item
        raise HTTPException(status_code=404, detail="运行定义不存在")


@router.delete("/{kind}/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_item(kind: Kind, item_id: str) -> None:
    with _lock:
        state = _read_state()
        remaining = [item for item in state[kind] if item.get("id") != item_id]
        if len(remaining) == len(state[kind]):
            raise HTTPException(status_code=404, detail="工作项不存在")
        state[kind] = remaining
        _write_state(state)
