from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(_BACKEND_ROOT / ".env"),
            str(_BACKEND_ROOT / ".env.local"),
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(
        default="postgresql+asyncpg://hitguess:hitguess@localhost:5432/hitguess",
        validation_alias="DATABASE_URL",
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url_for_asyncpg(cls, v: object) -> object:
        """Railway/Heroku-style URLs often use postgres:// or postgresql:// without +asyncpg."""
        if not isinstance(v, str):
            return v
        s = v.strip()
        if s.startswith("postgres://"):
            return "postgresql+asyncpg://" + s[len("postgres://") :]
        if s.startswith("postgresql://") and not s.startswith("postgresql+asyncpg://"):
            return "postgresql+asyncpg://" + s[len("postgresql://") :]
        return s

    redis_url: str = Field(
        default="redis://localhost:6379/0",
        validation_alias="REDIS_URL",
    )
    debug: bool = Field(default=False, validation_alias="DEBUG")

    tidal_client_id: str | None = Field(default=None, validation_alias="TIDAL_CLIENT_ID")
    tidal_client_secret: SecretStr | None = Field(
        default=None,
        validation_alias="TIDAL_CLIENT_SECRET",
    )
    tidal_token_url: str = Field(
        default="https://auth.tidal.com/v1/oauth2/token",
        validation_alias="TIDAL_TOKEN_URL",
    )
    tidal_openapi_base_url: str = Field(
        default="https://openapi.tidal.com/v2",
        validation_alias="TIDAL_OPENAPI_BASE_URL",
    )
    tidal_country_code: str = Field(
        default="PL",
        validation_alias="TIDAL_COUNTRY_CODE",
    )
    tidal_placeholder_cover_url: str = Field(
        default="https://placehold.co/320x320/EBE7DF/000000/png?text=%E2%99%AA",
        validation_alias="TIDAL_PLACEHOLDER_COVER_URL",
    )

    scheduler_timezone: str = Field(
        default="Europe/Warsaw",
        validation_alias="SCHEDULER_TIMEZONE",
    )

    strict_category_logic: bool = Field(
        default=False,
        validation_alias="STRICT_CATEGORY_LOGIC",
        description=(
            "When true: daily picks exclude TIDAL tracks already used by other categories "
            "(same calendar day + any prior use in another category). When false: only this "
            "category's history in the rolling window is excluded (legacy behaviour)."
        ),
    )

    admin_token: SecretStr | None = Field(
        default=None,
        validation_alias="ADMIN_TOKEN",
    )

    # Comma-separated browser origins for CORS (required when frontend is on another host:port).
    cors_allow_origins: str = Field(
        default=(
            "http://localhost:3000,http://127.0.0.1:3000,"
            "http://localhost:3001,http://127.0.0.1:3001,"
            "http://localhost:3002,http://127.0.0.1:3002,"
            "http://localhost:3003,http://127.0.0.1:3003,"
            "http://localhost:5173,http://127.0.0.1:5173"
        ),
        validation_alias="CORS_ALLOW_ORIGINS",
    )


settings = Settings()
