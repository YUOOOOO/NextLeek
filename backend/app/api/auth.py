from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app import auth as auth_service
from app.config import Settings
from app.deps import (
    current_settings,
    get_database,
    optional_session,
    require_csrf,
    require_user,
)
from app.models import User, UserSession
from app.schemas import AuthResponse, LoginRequest, SetupStatus, UserCreate, UserRead

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _cookie_kwargs(settings: Settings) -> dict[str, object]:
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "path": "/",
        "max_age": settings.session_ttl_hours * 3600,
    }


def _set_auth_cookies(response: Response, settings: Settings, token: str, csrf_token: str) -> None:
    kwargs = _cookie_kwargs(settings)
    response.set_cookie(settings.session_cookie_name, token, **kwargs)
    csrf_kwargs = dict(kwargs)
    csrf_kwargs["httponly"] = False
    response.set_cookie(settings.csrf_cookie_name, csrf_token, **csrf_kwargs)


def _clear_auth_cookies(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


@router.get("/status", response_model=SetupStatus)
def auth_status(database: Session = Depends(get_database)) -> SetupStatus:
    return SetupStatus(configured=auth_service.is_configured(database))


@router.post("/setup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def setup(
    payload: UserCreate,
    response: Response,
    database: Session = Depends(get_database),
    settings: Settings = Depends(current_settings),
) -> AuthResponse:
    if auth_service.is_configured(database):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="系统已初始化")
    try:
        user = auth_service.create_user(database, payload, first_admin=True)
        _, token, csrf_token = auth_service.create_session(database, user, settings)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc
    _set_auth_cookies(response, settings, token, csrf_token)
    return AuthResponse(user=UserRead.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    response: Response,
    database: Session = Depends(get_database),
    settings: Settings = Depends(current_settings),
) -> AuthResponse:
    try:
        user = auth_service.authenticate(database, payload.email, payload.password)
        _, token, csrf_token = auth_service.create_session(database, user, settings)
    except auth_service.AuthError as exc:
        status_code = (
            status.HTTP_403_FORBIDDEN if exc.code == "inactive" else status.HTTP_401_UNAUTHORIZED
        )
        raise HTTPException(status_code=status_code, detail=exc.message) from exc
    _set_auth_cookies(response, settings, token, csrf_token)
    return AuthResponse(user=UserRead.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_csrf)])
def logout(
    response: Response,
    database: Session = Depends(get_database),
    session: UserSession | None = Depends(optional_session),
    settings: Settings = Depends(current_settings),
) -> None:
    if session is not None:
        auth_service.revoke_session(database, session)
    _clear_auth_cookies(response, settings)


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(require_user)) -> UserRead:
    return UserRead.model_validate(user)
