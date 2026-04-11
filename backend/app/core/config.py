from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(
        default="postgresql+asyncpg://hitguess:hitguess@localhost:5432/hitguess",
        validation_alias="DATABASE_URL",
    )
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


settings = Settings()
