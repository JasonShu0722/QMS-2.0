"""
Configuration management for the QMS backend.
"""

import json
from urllib.parse import urlsplit, urlunsplit
from typing import Optional

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def prefer_ipv4_loopback_for_localhost(url: str) -> str:
    """Avoid Windows localhost resolving to an unavailable IPv6 listener."""
    try:
        parsed = urlsplit(url)
    except ValueError:
        return url

    if parsed.hostname != "localhost":
        return url

    user_info = ""
    if "@" in parsed.netloc:
        user_info = f"{parsed.netloc.rsplit('@', 1)[0]}@"

    try:
        port = f":{parsed.port}" if parsed.port else ""
    except ValueError:
        return url

    return urlunsplit(
        (
            parsed.scheme,
            f"{user_info}127.0.0.1{port}",
            parsed.path,
            parsed.query,
            parsed.fragment,
        )
    )


class Settings(BaseSettings):
    APP_NAME: str = "QMS Quality Management System"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "stable"
    DEBUG: bool = False

    DATABASE_URL: str = "postgresql+asyncpg://qms_user:password@localhost:5432/qms_db"
    DB_ECHO: bool = False

    REDIS_URL: str = "redis://localhost:6379/0"

    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_HOURS: int = 24

    PASSWORD_MIN_LENGTH: int = 8
    PASSWORD_EXPIRE_DAYS: int = 90
    MAX_LOGIN_ATTEMPTS: int = 5
    ACCOUNT_LOCKOUT_MINUTES: int = 30
    INTERNAL_REGISTRATION_EMAIL_DOMAIN: str = "ics-energy.com"

    LDAP_SERVER: Optional[str] = None
    LDAP_BASE_DN: Optional[str] = None
    LDAP_BIND_DN: Optional[str] = None
    LDAP_BIND_PASSWORD: Optional[str] = None
    LDAP_ENABLED: bool = False

    IMS_BASE_URL: Optional[str] = None
    IMS_API_KEY: Optional[str] = None
    IMS_TIMEOUT: int = 30

    SMTP_SERVER: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: Optional[str] = None
    SMTP_USE_TLS: bool = True

    CELERY_BROKER_URL: Optional[str] = None
    CELERY_RESULT_BACKEND: Optional[str] = None

    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024

    CORS_ORIGINS: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"],
        validation_alias=AliasChoices("CORS_ORIGINS", "BACKEND_CORS_ORIGINS"),
    )

    OPENAI_API_KEY: Optional[str] = None
    OPENAI_BASE_URL: Optional[str] = None

    PLATFORM_ADMIN_USERNAMES: str = "admin"
    REQ_PANEL_ADMIN_USERNAME: str = "requirements_admin"
    REQ_PANEL_ADMIN_PASSWORD: str = "ReqPanelAdmin@2026"
    REQ_PANEL_ADMIN_FULL_NAME: str = "需求面板管理员"
    REQ_PANEL_VIEWER_USERNAME: str = "requirements_viewer"
    REQ_PANEL_VIEWER_PASSWORD: str = "ReqPanelViewer@2026"
    REQ_PANEL_VIEWER_FULL_NAME: str = "需求面板查阅账号"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if isinstance(value, list):
            return value

        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                return json.loads(raw)
            return [item.strip() for item in raw.split(",") if item.strip()]

        return value

    @field_validator("DATABASE_URL", "REDIS_URL", mode="before")
    @classmethod
    def normalize_localhost_urls(cls, value):
        if isinstance(value, str):
            return prefer_ipv4_loopback_for_localhost(value)
        return value


settings = Settings()
