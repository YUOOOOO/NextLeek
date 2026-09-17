from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import auth as auth_service
from app.deps import get_database, require_admin, require_csrf
from app.models import User
from app.schemas import PasswordReset, UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_csrf)])


@router.get("", response_model=list[UserRead])
def list_users(
    _: User = Depends(require_admin),
    database: Session = Depends(get_database),
) -> list[UserRead]:
    return [UserRead.model_validate(user) for user in auth_service.list_users(database)]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    _: User = Depends(require_admin),
    database: Session = Depends(get_database),
) -> UserRead:
    try:
        user = auth_service.create_user(database, payload)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: str,
    payload: UserUpdate,
    actor: User = Depends(require_admin),
    database: Session = Depends(get_database),
) -> UserRead:
    user = auth_service.get_user_by_id(database, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if user.id == actor.id and payload.role == "user":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能取消自己的管理员身份")
    if user.id == actor.id and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能停用当前登录账号")
    if (
        user.role == "admin"
        and payload.role == "user"
        and auth_service.remaining_admin_count(database, exclude_user_id=user.id) == 0
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="至少保留一名管理员")
    try:
        updated = auth_service.update_user(
            database,
            user,
            username=payload.username,
            role=payload.role,
            is_active=payload.is_active,
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from exc
    return UserRead.model_validate(updated)


@router.post("/{user_id}/password", response_model=UserRead)
def reset_password(
    user_id: str,
    payload: PasswordReset,
    _: User = Depends(require_admin),
    database: Session = Depends(get_database),
) -> UserRead:
    user = auth_service.get_user_by_id(database, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return UserRead.model_validate(auth_service.reset_password(database, user, payload.password))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    actor: User = Depends(require_admin),
    database: Session = Depends(get_database),
) -> None:
    user = auth_service.get_user_by_id(database, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if user.id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除当前登录账号")
    if user.role == "admin" and auth_service.remaining_admin_count(database, exclude_user_id=user.id) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="至少保留一名管理员")
    auth_service.delete_user(database, user)
