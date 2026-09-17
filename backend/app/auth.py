from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import User, UserSession
from app.schemas import UserCreate
from app.security import (
    create_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    utcnow,
    verify_password,
)


class AuthError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def normalize_email(email: str) -> str:
    return email.strip().lower()


def user_count(database: Session) -> int:
    return int(database.scalar(select(func.count()).select_from(User)) or 0)


def is_configured(database: Session) -> bool:
    return user_count(database) > 0


def get_user_by_email(database: Session, email: str) -> User | None:
    return database.scalar(select(User).where(User.email == normalize_email(email)))


def get_user_by_username(database: Session, username: str) -> User | None:
    return database.scalar(select(User).where(User.username == username.strip().lower()))


def get_user_by_id(database: Session, user_id: str) -> User | None:
    return database.get(User, user_id)


def list_users(database: Session) -> list[User]:
    return list(database.scalars(select(User).order_by(User.created_at.asc())))


def create_user(database: Session, payload: UserCreate, *, first_admin: bool = False) -> User:
    email = normalize_email(payload.email)
    username = payload.username.strip().lower()
    if get_user_by_email(database, email):
        raise AuthError("email_taken", "该邮箱已被使用")
    if get_user_by_username(database, username):
        raise AuthError("username_taken", "该用户名已被使用")

    user = User(
        email=email,
        username=username,
        password_hash=hash_password(payload.password),
        role="admin" if first_admin else payload.role,
        is_active=True,
    )
    database.add(user)
    database.commit()
    database.refresh(user)
    return user


def bootstrap_admin(database: Session, settings: Settings) -> User | None:
    if is_configured(database):
        return None
    password = settings.bootstrap_admin_password
    if settings.bootstrap_admin_email is None or password is None:
        return None
    return create_user(
        database,
        UserCreate(
            email=settings.bootstrap_admin_email,
            username=settings.bootstrap_admin_username,
            password=password.get_secret_value(),
            role="admin",
        ),
        first_admin=True,
    )


def authenticate(database: Session, account: str, password: str) -> User:
    ident = account.strip()
    user = (
        get_user_by_email(database, ident)
        if "@" in ident
        else get_user_by_username(database, ident)
    )
    if user is None or not verify_password(password, user.password_hash):
        raise AuthError("invalid_credentials", "用户名、邮箱或密码错误")
    if not user.is_active:
        raise AuthError("inactive", "账号已被停用")
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        database.commit()
        database.refresh(user)
    return user


def create_session(database: Session, user: User, settings: Settings) -> tuple[UserSession, str, str]:
    raw_token = create_token()
    csrf_token = create_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        csrf_token_hash=hash_token(csrf_token),
        expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
    )
    database.add(session)
    database.commit()
    database.refresh(session)
    return session, raw_token, csrf_token


def get_session_by_token(database: Session, token: str) -> UserSession | None:
    if not token:
        return None
    session = database.scalar(
        select(UserSession).where(UserSession.token_hash == hash_token(token))
    )
    if session is None or session.expires_at <= utcnow():
        if session is not None:
            database.delete(session)
            database.commit()
        return None
    return session


def revoke_session(database: Session, session: UserSession) -> None:
    database.delete(session)
    database.commit()


def revoke_user_sessions(database: Session, user_id: str) -> None:
    sessions = list(database.scalars(select(UserSession).where(UserSession.user_id == user_id)))
    for session in sessions:
        database.delete(session)
    database.commit()


def update_user(
    database: Session,
    user: User,
    *,
    username: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
) -> User:
    if username is not None:
        existing = get_user_by_username(database, username)
        if existing is not None and existing.id != user.id:
            raise AuthError("username_taken", "该用户名已被使用")
        user.username = username.strip().lower()
    if role is not None:
        user.role = role
    if is_active is not None:
        user.is_active = is_active
        if not is_active:
            database.flush()
            for session in list(user.sessions):
                database.delete(session)
    database.commit()
    database.refresh(user)
    return user


def reset_password(database: Session, user: User, password: str) -> User:
    user.password_hash = hash_password(password)
    database.flush()
    for session in list(user.sessions):
        database.delete(session)
    database.commit()
    database.refresh(user)
    return user


def change_password(
    database: Session,
    user: User,
    current_password: str,
    new_password: str,
    keep_session: UserSession | None = None,
) -> User:
    if not verify_password(current_password, user.password_hash):
        raise AuthError("invalid_password", "当前密码不正确")
    if current_password == new_password:
        raise AuthError("same_password", "新密码不能与当前密码相同")
    user.password_hash = hash_password(new_password)
    database.flush()
    for session in list(user.sessions):
        if keep_session is None or session.id != keep_session.id:
            database.delete(session)
    database.commit()
    database.refresh(user)
    return user


def delete_user(database: Session, user: User) -> None:
    database.delete(user)
    database.commit()


def remaining_admin_count(database: Session, exclude_user_id: str | None = None) -> int:
    query = select(func.count()).select_from(User).where(
        User.role == "admin",
        User.is_active.is_(True),
    )
    if exclude_user_id is not None:
        query = query.where(User.id != exclude_user_id)
    return int(database.scalar(query) or 0)
