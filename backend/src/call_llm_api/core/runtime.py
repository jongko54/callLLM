from call_llm_api.core.config import Settings, get_settings
from call_llm_api.core.container import AppContainer
from call_llm_api.infrastructure.llm.openai_compatible import OpenAICompatibleClient
from call_llm_api.infrastructure.persistence.in_memory import InMemoryRunRepository, InMemoryThreadRepository
from call_llm_api.infrastructure.persistence.sqlalchemy_store import (
  SQLAlchemyDatabaseManager,
  SQLAlchemyRunRepository,
  SQLAlchemyThreadRepository,
)
from call_llm_api.infrastructure.queue.redis_queue import RedisTaskQueue
from call_llm_api.infrastructure.tools.registry import build_builtin_tool_registry


async def build_container(settings: Settings | None = None) -> AppContainer:
  settings = settings or get_settings()
  llm_client = OpenAICompatibleClient(settings)
  tool_registry = build_builtin_tool_registry()

  database_manager = None
  if settings.persistence_backend == "memory":
    run_repository = InMemoryRunRepository()
    thread_repository = InMemoryThreadRepository()
  else:
    database_manager = SQLAlchemyDatabaseManager(settings)
    await database_manager.initialize()
    run_repository = SQLAlchemyRunRepository(database_manager.session_factory)
    thread_repository = SQLAlchemyThreadRepository(database_manager.session_factory)

  task_queue = None
  if settings.queue_backend == "redis":
    task_queue = RedisTaskQueue(settings)

  return AppContainer(
    settings=settings,
    llm_client=llm_client,
    run_repository=run_repository,
    thread_repository=thread_repository,
    tool_registry=tool_registry,
    task_queue=task_queue,
    database_manager=database_manager,
  )


async def close_container(container: AppContainer) -> None:
  await container.llm_client.close()
  if container.task_queue is not None:
    await container.task_queue.close()
  if container.database_manager is not None:
    await container.database_manager.close()
