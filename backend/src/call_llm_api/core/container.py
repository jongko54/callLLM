from dataclasses import dataclass
from typing import Any

from call_llm_api.core.config import Settings
from call_llm_api.infrastructure.llm.openai_compatible import OpenAICompatibleClient
from call_llm_api.infrastructure.persistence.base import RunRepository, ThreadRepository
from call_llm_api.infrastructure.tools.registry import ToolRegistry


@dataclass(slots=True)
class AppContainer:
  settings: Settings
  llm_client: OpenAICompatibleClient
  run_repository: RunRepository
  thread_repository: ThreadRepository
  tool_registry: ToolRegistry
  task_queue: Any = None
  database_manager: Any = None
