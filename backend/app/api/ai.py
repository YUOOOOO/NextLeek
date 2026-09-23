from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_database, require_csrf, require_user
from app.models import AiConversation, User
from app.schemas import AiConversationRead, AiConversationWrite
from app.security import utcnow

router = APIRouter(prefix="/api/ai/conversations", tags=["ai"], dependencies=[Depends(require_csrf)])
_ALLOWED_WORKSPACES = {"strategy", "factor"}
_ALLOWED_WORKSPACES = {"strategy", "factor", "global"}

def _workspace(value: str) -> str:
    workspace = value.strip().lower()
    if workspace not in _ALLOWED_WORKSPACES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的 AI 工作区")
    return workspace


@router.get("", response_model=AiConversationRead)
def get_conversation(
    workspace: str = Query(...),
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> AiConversationRead:
    workspace = _workspace(workspace)
    conversation = database.scalar(
        select(AiConversation).where(
            AiConversation.user_id == user.id,
            AiConversation.workspace == workspace,
        )
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="暂无对话记录")
    return AiConversationRead.model_validate({
        "workspace": conversation.workspace,
        "messages": conversation.messages or [],
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
    })


@router.put("/{workspace}", response_model=AiConversationRead)
def save_conversation(
    workspace: str,
    payload: AiConversationWrite,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> AiConversationRead:
    workspace = _workspace(workspace)
    conversation = database.scalar(
        select(AiConversation).where(
            AiConversation.user_id == user.id,
            AiConversation.workspace == workspace,
        )
    )
    messages = [item.model_dump(exclude_none=True) for item in payload.messages]
    if conversation is None:
        conversation = AiConversation(user_id=user.id, workspace=workspace, messages=messages)
        database.add(conversation)
    else:
        conversation.messages = messages
        conversation.updated_at = utcnow()
    database.commit()
    database.refresh(conversation)
    return AiConversationRead.model_validate({
        "workspace": conversation.workspace,
        "messages": conversation.messages or [],
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
    })
