from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NEXTLEEK_",
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "NextLeek"
    environment: str = "development"
    database_url: str = "sqlite:///./data/nextleek.db"
    static_dir: Path = Path("../frontend/dist")
    cors_origins: str = "http://localhost:3011,http://localhost:3018"

    session_cookie_name: str = "nextleek_session"
    csrf_cookie_name: str = "nextleek_csrf"
    session_ttl_hours: int = 168
    cookie_secure: bool = False

    bootstrap_admin_email: str | None = None
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: SecretStr | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
