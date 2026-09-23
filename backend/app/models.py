from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db import Base
from app.security import utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    sessions: Mapped[list[UserSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    strategies: Mapped[list[Strategy]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    strategy_subscriptions: Mapped[list[StrategySubscription]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    strategy_watches: Mapped[list["StrategyWatch"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    factors: Mapped[list["Factor"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    factor_subscriptions: Mapped[list["FactorSubscription"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )



class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="sessions")


class AiConversation(Base):
    __tablename__ = "ai_conversations"
    __table_args__ = (UniqueConstraint("user_id", "workspace", name="uq_ai_conversation_user_workspace"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workspace: Mapped[str] = mapped_column(String(16), index=True)
    messages: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship()


class Strategy(Base):
    __tablename__ = "strategies"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(40))
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    kind: Mapped[str] = mapped_column(String(16), default="conditions")
    conditions: Mapped[list] = mapped_column(JSON, default=list)
    formula: Mapped[str] = mapped_column(Text, default="")
    children: Mapped[list] = mapped_column(JSON, default=list)
    merge_mode: Mapped[str] = mapped_column(String(16), default="union")
    min_confirm: Mapped[int] = mapped_column(Integer, default=1)
    basic_filter: Mapped[dict] = mapped_column(JSON, default=dict)
    order_by: Mapped[str] = mapped_column(String(64), default="change_pct")
    descending: Mapped[bool] = mapped_column(Boolean, default=True)
    result_limit: Mapped[int] = mapped_column(Integer, default=100)
    version: Mapped[int] = mapped_column(Integer, default=0)
    published_snapshot: Mapped[dict | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    owner: Mapped[User] = relationship(back_populates="strategies")
    subscriptions: Mapped[list[StrategySubscription]] = relationship(
        back_populates="strategy", cascade="all, delete-orphan"
    )
    watches: Mapped[list["StrategyWatch"]] = relationship(
        back_populates="strategy", cascade="all, delete-orphan"
    )


class StrategySubscription(Base):
    __tablename__ = "strategy_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "strategy_id", name="uq_strategy_subscription"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    strategy_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("strategies.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    snapshot: Mapped[dict | None] = mapped_column(JSON, default=None)
    pinned_version: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped[User] = relationship(back_populates="strategy_subscriptions")
    strategy: Mapped[Strategy] = relationship(back_populates="subscriptions")


class StrategyWatch(Base):
    __tablename__ = "strategy_watches"
    __table_args__ = (UniqueConstraint("user_id", "strategy_id", name="uq_strategy_watch"),)

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    strategy_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("strategies.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="strategy_watches")
    strategy: Mapped[Strategy] = relationship(back_populates="watches")


class Factor(Base):
    __tablename__ = "factors"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text, default="")
    formula: Mapped[str] = mapped_column(Text)
    direction: Mapped[str] = mapped_column(String(8), default="none")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    published_snapshot: Mapped[dict | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    owner: Mapped[User] = relationship(back_populates="factors")
    subscriptions: Mapped[list["FactorSubscription"]] = relationship(
        back_populates="factor", cascade="all, delete-orphan"
    )


class FactorSubscription(Base):
    __tablename__ = "factor_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "factor_id", name="uq_factor_subscription"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    factor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("factors.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    snapshot: Mapped[dict | None] = mapped_column(JSON, default=None)
    pinned_version: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped[User] = relationship(back_populates="factor_subscriptions")
    factor: Mapped[Factor] = relationship(back_populates="subscriptions")
