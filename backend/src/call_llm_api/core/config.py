from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
  model_config = SettingsConfigDict(
    env_file=".env",
    env_prefix="CALL_LLM_",
    extra="ignore",
  )

  app_name: str = "callLLM API"
  api_prefix: str = "/api"
  frontend_mount_path: str = "/ui"
  provider_base_url: str = "http://127.0.0.1:18001"
  provider_api_key: str = "local-dev-token"
  default_model: str = "qwen3-8b-int4"
  provider_tool_calling: bool = False
  request_timeout_seconds: float = 60.0
  persistence_backend: str = "sqlalchemy"
  database_url: str = f"sqlite+aiosqlite:///{(PROJECT_ROOT / 'storage' / 'call_llm.db').as_posix()}"
  database_auto_create: bool = True
  queue_backend: str = "inline"
  redis_url: str = "redis://127.0.0.1:6379/0"
  redis_queue_name: str = "call_llm:thread_runs"
  agent_max_steps: int = 6
  allowed_origins: list[str] = Field(
    default_factory=lambda: [
      "http://127.0.0.1:8000",
      "http://localhost:8000",
      "http://127.0.0.1:5500",
      "http://localhost:5500",
    ]
  )
  frontend_dir: Path = PROJECT_ROOT / "instagram-post-clone"


@lru_cache
def get_settings() -> Settings:
  return Settings()
