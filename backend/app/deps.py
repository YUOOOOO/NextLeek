from __future__ import annotations

from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import auth as auth_service
from app.config import Settings, get_settings
from app.db import session_scope
from app.models import User, UserSession
from app.security import hash_token


def get_database(request: Request) -> Generator[Session, None, None]:
    with session_scope(request.app.state.session_factory) as database:
        yield database


def current_settings() -> Settings:
    return get_settings()


def optional_session(
    request: Request,
    database: Annotated[Session, Depends(get_database)],
    settings: Annotated[Settings, Depends(current_settings)],
) -> UserSession | None:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    return auth_service.get_session_by_token(database, token)


def require_session(
    session: Annotated[UserSession | None, Depends(optional_session)],
) -> UserSession:
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或会话已过期")
    return session


def require_user(session: Annotated[UserSession, Depends(require_session)]) -> User:
    user = session.user
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或会话已过期")
    return user


def require_admin(user: Annotated[User, Depends(require_user)]) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


def require_csrf(
    request: Request,
    session: Annotated[UserSession, Depends(require_session)],
    x_csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    if not x_csrf_token or hash_token(x_csrf_token) != session.csrf_token_hash:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF 校验失败")
