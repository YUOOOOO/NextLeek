from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import Settings


class Base(DeclarativeBase):
    pass


def create_database_engine(settings: Settings) -> Engine:
    connect_args: dict[str, object] = {}
    if settings.database_url.startswith("sqlite"):
        database_path = settings.database_url.removeprefix("sqlite:///")
        if database_path and database_path != ":memory:":
            Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        connect_args["check_same_thread"] = False

    return create_engine(
        settings.database_url,
        connect_args=connect_args,
        pool_pre_ping=True,
    )


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_database(engine: Engine) -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(engine)
    _ensure_strategy_columns(engine)
    _ensure_subscription_columns(engine)
    _mark_builtin_strategies(engine)


def _add_missing_columns(engine: Engine, table: str, extras: dict[str, str]) -> None:
    if engine.dialect.name != "sqlite":
        return
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    cols = {column["name"] for column in inspector.get_columns(table)}
    with engine.begin() as connection:
        for name, stmt in extras.items():
            if name not in cols:
                connection.execute(text(stmt))


def _ensure_strategy_columns(engine: Engine) -> None:
    _add_missing_columns(
        engine,
        "strategies",
        {
            "basic_filter": "ALTER TABLE strategies ADD COLUMN basic_filter JSON",
            "order_by": "ALTER TABLE strategies ADD COLUMN order_by VARCHAR(64) DEFAULT 'change_pct'",
            "descending": "ALTER TABLE strategies ADD COLUMN descending BOOLEAN DEFAULT 1",
            "result_limit": "ALTER TABLE strategies ADD COLUMN result_limit INTEGER DEFAULT 100",
            "kind": "ALTER TABLE strategies ADD COLUMN kind VARCHAR(16) DEFAULT 'conditions'",
            "children": "ALTER TABLE strategies ADD COLUMN children JSON",
            "merge_mode": "ALTER TABLE strategies ADD COLUMN merge_mode VARCHAR(16) DEFAULT 'union'",
            "min_confirm": "ALTER TABLE strategies ADD COLUMN min_confirm INTEGER DEFAULT 1",
            "version": "ALTER TABLE strategies ADD COLUMN version INTEGER DEFAULT 0",
            "published_snapshot": "ALTER TABLE strategies ADD COLUMN published_snapshot JSON",
            "formula": "ALTER TABLE strategies ADD COLUMN formula TEXT DEFAULT ''",
            "is_builtin": "ALTER TABLE strategies ADD COLUMN is_builtin BOOLEAN DEFAULT 0",
        },
    )


def _ensure_subscription_columns(engine: Engine) -> None:
    _add_missing_columns(
        engine,
        "strategy_subscriptions",
        {
            "snapshot": "ALTER TABLE strategy_subscriptions ADD COLUMN snapshot JSON",
            "pinned_version": "ALTER TABLE strategy_subscriptions ADD COLUMN pinned_version INTEGER DEFAULT 0",
        },
    )

def _mark_builtin_strategies(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    from sqlalchemy import text
    from app.services.market_catalog import MARKET_STRATEGIES

    names = [str(item["name"]) for item in MARKET_STRATEGIES]
    if not names:
        return
    placeholders = ",".join(f":name_{index}" for index in range(len(names)))
    params = {f"name_{index}": name for index, name in enumerate(names)}
    with engine.begin() as connection:
        connection.execute(
            text(
                f"UPDATE strategies SET is_builtin = 1, owner_id = 'builtin' "
                f"WHERE name IN ({placeholders}) AND status = 'published'"
            ),
            params,
        )


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Generator[Session, None, None]:
    database = factory()
    try:
        yield database
    finally:
        database.close()
