"""全局配置 — NextLeek 账号体系 + TSP 数据层。"""
from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_IS_FROZEN = getattr(sys, "frozen", False)


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _resource_root() -> Path:
    if _IS_FROZEN:
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return _project_root()


def _user_data_root() -> Path:
    if _IS_FROZEN:
        return Path(sys.executable).resolve().parent / "data"
    return _PROJECT_ROOT / "data"


_PROJECT_ROOT = _project_root()
_RESOURCE_ROOT = _resource_root()
_ENV_FILE = Path(
    os.environ.get(
        "TICKFLOW_ENV_FILE",
        str(_RESOURCE_ROOT / ".env") if not _IS_FROZEN else ".env",
    )
)


def _nextleek_alias(*names: str) -> AliasChoices:
    return AliasChoices(*names)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", str(_ENV_FILE)),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = Field(
        default="NextLeek",
        validation_alias=_nextleek_alias("NEXTLEEK_APP_NAME", "APP_NAME"),
    )
    environment: str = Field(
        default="development",
        validation_alias=_nextleek_alias("NEXTLEEK_ENVIRONMENT", "ENVIRONMENT"),
    )
    database_url: str = Field(
        default="sqlite:///./data/nextleek.db",
        validation_alias=_nextleek_alias("NEXTLEEK_DATABASE_URL", "DATABASE_URL"),
    )
    cors_origins: str = Field(
        default="http://localhost:3011,http://localhost:3018",
        validation_alias=_nextleek_alias("NEXTLEEK_CORS_ORIGINS", "CORS_ORIGINS"),
    )

    session_cookie_name: str = Field(
        default="nextleek_session",
        validation_alias=_nextleek_alias("NEXTLEEK_SESSION_COOKIE_NAME"),
    )
    csrf_cookie_name: str = Field(
        default="nextleek_csrf",
        validation_alias=_nextleek_alias("NEXTLEEK_CSRF_COOKIE_NAME"),
    )
    session_ttl_hours: int = Field(
        default=168,
        validation_alias=_nextleek_alias("NEXTLEEK_SESSION_TTL_HOURS"),
    )
    cookie_secure: bool = Field(
        default=False,
        validation_alias=_nextleek_alias("NEXTLEEK_COOKIE_SECURE"),
    )

    bootstrap_admin_email: str | None = Field(
        default=None,
        validation_alias=_nextleek_alias("NEXTLEEK_BOOTSTRAP_ADMIN_EMAIL"),
    )
    bootstrap_admin_username: str = Field(
        default="admin",
        validation_alias=_nextleek_alias("NEXTLEEK_BOOTSTRAP_ADMIN_USERNAME"),
    )
    bootstrap_admin_password: SecretStr | None = Field(
        default=None,
        validation_alias=_nextleek_alias("NEXTLEEK_BOOTSTRAP_ADMIN_PASSWORD"),
    )

    # TickFlow
    tickflow_api_key: str = Field(default="", description="留空启用 free 模式")

    # AI
    ai_provider: str = "openai_compat"
    ai_base_url: str = "https://api.zhaji.dev/v1"
    ai_api_key: str = ""
    ai_model: str = "gpt-5.5"
    ai_codex_command: str = "codex"
    ai_codex_reasoning_effort: str = ""
    ai_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )
    ai_max_output_tokens: int = 8192
    ai_context_window: int = 64000

    # Server
    host: str = "0.0.0.0"
    port: int = 3018
    log_level: str = "INFO"
    backtest_range_guard: bool = False
    backtest_matrix_disk_cache_enabled: bool = True
    backtest_matrix_cache_max_mb: int = 512
    backtest_matrix_cache_prewarm: bool = True
    backtest_matrix_cache_prewarm_years: int = 5

    polars_collect_permits: int = 4
    polars_collect_background_permits: int = 2

    watchdog_enabled: bool = True
    watchdog_interval_s: float = 30.0
    watchdog_probe_timeout_s: float = 15.0
    watchdog_failure_threshold: int = 2

    strategy_run_all_workers: int = 1
    strategy_run_all_first_return_s: float = 15.0

    auth_password: str = ""

    data_dir: Path = _user_data_root()
    tiers_yaml: Path = _RESOURCE_ROOT / "tiers.yaml" if _IS_FROZEN else _PROJECT_ROOT / "tiers.yaml"
    static_dir: Path = Field(
        default=_RESOURCE_ROOT / "static" if _IS_FROZEN else (_PROJECT_ROOT / "frontend" / "dist"),
        validation_alias=_nextleek_alias("NEXTLEEK_STATIC_DIR", "STATIC_DIR"),
    )

    @model_validator(mode="after")
    def _resolve_paths(self) -> Settings:
        if not self.data_dir.is_absolute():
            self.data_dir = (_PROJECT_ROOT / self.data_dir).resolve()
        if self.backtest_matrix_cache_max_mb <= 0:
            raise ValueError("backtest_matrix_cache_max_mb must be positive")
        if self.backtest_matrix_cache_prewarm_years <= 0:
            raise ValueError("backtest_matrix_cache_prewarm_years must be positive")
        if self.ai_max_output_tokens <= 0:
            raise ValueError("ai_max_output_tokens must be positive")
        if self.ai_context_window <= 0:
            raise ValueError("ai_context_window must be positive")
        if self.polars_collect_permits < 2:
            raise ValueError("polars_collect_permits must be >= 2")
        if not 1 <= self.polars_collect_background_permits < self.polars_collect_permits:
            raise ValueError(
                "polars_collect_background_permits must be in [1, polars_collect_permits)"
            )
        if self.watchdog_interval_s <= 0 or self.watchdog_probe_timeout_s <= 0:
            raise ValueError("watchdog intervals must be positive")
        if self.watchdog_failure_threshold < 1:
            raise ValueError("watchdog_failure_threshold must be >= 1")
        if self.strategy_run_all_workers < 1:
            raise ValueError("strategy_run_all_workers must be >= 1")
        if self.strategy_run_all_first_return_s < 0:
            raise ValueError("strategy_run_all_first_return_s must be >= 0")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def use_free_mode(self) -> bool:
        from app import secrets_store

        return not secrets_store.get_tickflow_key()


@lru_cache
def get_settings() -> Settings:
    return Settings()


class _LazySettings:
    """TSP 模块 `from app.config import settings` 始终读到当前 get_settings()。"""

    def __getattr__(self, item: str):
        return getattr(get_settings(), item)

    def __repr__(self) -> str:
        return repr(get_settings())


settings = _LazySettings()
