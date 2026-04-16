from datetime import UTC, datetime

from call_llm_api.application.benchmark_runners import get_framework_runtime_statuses
from call_llm_api.core.config import Settings, get_settings
from call_llm_api.core.container import AppContainer
from call_llm_api.domain.models import (
  AgentFramework,
  AgentProfileRecord,
  AgentStrategyKind,
  ModelRegistryRecord,
)
from call_llm_api.infrastructure.llm.openai_compatible import OpenAICompatibleClient
from call_llm_api.infrastructure.persistence.in_memory import (
  InMemoryAgentProfileRepository,
  InMemoryBenchmarkRunRepository,
  InMemoryBenchmarkSuiteRepository,
  InMemoryModelRegistryRepository,
  InMemoryRunRepository,
  InMemoryThreadRepository,
)
from call_llm_api.infrastructure.persistence.sqlalchemy_store import (
  SQLAlchemyAgentProfileRepository,
  SQLAlchemyBenchmarkRunRepository,
  SQLAlchemyBenchmarkSuiteRepository,
  SQLAlchemyDatabaseManager,
  SQLAlchemyModelRegistryRepository,
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
    model_registry_repository = InMemoryModelRegistryRepository()
    agent_profile_repository = InMemoryAgentProfileRepository()
    benchmark_suite_repository = InMemoryBenchmarkSuiteRepository()
    benchmark_run_repository = InMemoryBenchmarkRunRepository()
  else:
    database_manager = SQLAlchemyDatabaseManager(settings)
    await database_manager.initialize()
    run_repository = SQLAlchemyRunRepository(database_manager.session_factory)
    thread_repository = SQLAlchemyThreadRepository(database_manager.session_factory)
    model_registry_repository = SQLAlchemyModelRegistryRepository(database_manager.session_factory)
    agent_profile_repository = SQLAlchemyAgentProfileRepository(database_manager.session_factory)
    benchmark_suite_repository = SQLAlchemyBenchmarkSuiteRepository(database_manager.session_factory)
    benchmark_run_repository = SQLAlchemyBenchmarkRunRepository(database_manager.session_factory)

  task_queue = None
  if settings.queue_backend == "redis":
    task_queue = RedisTaskQueue(settings)

  container = AppContainer(
    settings=settings,
    llm_client=llm_client,
    run_repository=run_repository,
    thread_repository=thread_repository,
    model_registry_repository=model_registry_repository,
    agent_profile_repository=agent_profile_repository,
    benchmark_suite_repository=benchmark_suite_repository,
    benchmark_run_repository=benchmark_run_repository,
    tool_registry=tool_registry,
    task_queue=task_queue,
    database_manager=database_manager,
  )
  await _seed_registry_defaults(container)
  return container


async def close_container(container: AppContainer) -> None:
  await container.llm_client.close()
  if container.task_queue is not None:
    await container.task_queue.close()
  if container.database_manager is not None:
    await container.database_manager.close()


async def _seed_registry_defaults(container: AppContainer) -> None:
  now = datetime.now(UTC)
  framework_statuses = get_framework_runtime_statuses()

  existing_model = await container.model_registry_repository.get("default-upstream-model")
  default_model_record = ModelRegistryRecord(
    id="default-upstream-model",
    name=container.settings.default_model,
    provider="openai-compatible",
    base_url=container.settings.provider_base_url,
    served_model_name=container.settings.default_model,
    api_key=container.settings.provider_api_key,
    enabled=True,
    capabilities={
      "chat_completions": True,
      "streaming": True,
      "tool_calling": container.settings.provider_tool_calling,
    },
    default_params={
      "temperature": 0.7,
      "extra_body": {
        "chat_template_kwargs": {
          "enable_thinking": False,
        }
      },
    },
    metadata={
      "seeded": True,
      "reasoning_mode": "disabled_by_default",
    },
    created_at=now,
    updated_at=now,
  )

  if existing_model is None:
    await container.model_registry_repository.save(
      default_model_record
    )
  elif existing_model.metadata.get("seeded"):
    await container.model_registry_repository.save(
      existing_model.model_copy(
        update={
          "name": default_model_record.name,
          "provider": default_model_record.provider,
          "base_url": default_model_record.base_url,
          "served_model_name": default_model_record.served_model_name,
          "api_key": default_model_record.api_key,
          "enabled": default_model_record.enabled,
          "capabilities": default_model_record.capabilities,
          "default_params": default_model_record.default_params,
          "metadata": {
            **existing_model.metadata,
            "seeded": True,
          },
          "updated_at": now,
        }
      )
    )

  default_profiles = [
    AgentProfileRecord(
      id="direct-chat",
      name="Direct Chat",
      description="Single-step baseline without retrieval or tool usage.",
      strategy_kind=AgentStrategyKind.DIRECT,
      framework=AgentFramework.CUSTOM,
      system_prompt=(
        "Answer the user's request directly and clearly. "
        "Lead with the answer whenever possible. "
        "Do not mention internal benchmark or workflow details unless the user asks."
      ),
      generation_defaults={"temperature": 0.5},
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.CUSTOM],
        "library_ids": ["custom-runtime"],
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="rag-context",
      name="RAG Context",
      description="Injects case-provided context documents into the system prompt.",
      strategy_kind=AgentStrategyKind.RAG,
      framework=AgentFramework.CUSTOM,
      system_prompt=(
        "Answer using the retrieved context when it is relevant. "
        "If the context is insufficient, say what is missing instead of inventing details. "
        "Prefer one grounded answer over multiple speculative alternatives."
      ),
      retrieval_policy={"source": "case.metadata.context_documents"},
      generation_defaults={"temperature": 0.1},
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.CUSTOM],
        "library_ids": ["custom-runtime"],
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="tool-agent",
      name="Tool Agent",
      description="Allows the model to call builtin tools before responding.",
      strategy_kind=AgentStrategyKind.TOOL,
      framework=AgentFramework.CUSTOM,
      tool_names=["get_current_time", "echo_text"],
      generation_defaults={"temperature": 0.1, "max_steps": 4},
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.CUSTOM],
        "library_ids": ["custom-runtime"],
        "requires_tool_calling": True,
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="langchain-direct",
      name="LangChain Direct",
      description="LangChain ChatOpenAI baseline over the registered OpenAI-compatible endpoint.",
      strategy_kind=AgentStrategyKind.DIRECT,
      framework=AgentFramework.LANGCHAIN,
      generation_defaults={"temperature": 0.7},
      enabled=framework_statuses[AgentFramework.LANGCHAIN]["available"],
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.LANGCHAIN],
        "library_ids": ["langchain-runtime"],
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="langchain-tool",
      name="LangChain Tool Agent",
      description="LangChain tool loop with builtin functions for benchmark parity checks.",
      strategy_kind=AgentStrategyKind.TOOL,
      framework=AgentFramework.LANGCHAIN,
      tool_names=["get_current_time", "echo_text"],
      generation_defaults={"temperature": 0.1, "max_steps": 4},
      enabled=framework_statuses[AgentFramework.LANGCHAIN]["available"],
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.LANGCHAIN],
        "library_ids": ["langchain-runtime"],
        "requires_tool_calling": True,
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="langgraph-agent",
      name="LangGraph Agent",
      description="LangGraph state machine runner for tool-using benchmark flows.",
      strategy_kind=AgentStrategyKind.TOOL,
      framework=AgentFramework.LANGGRAPH,
      tool_names=["get_current_time", "echo_text"],
      generation_defaults={"temperature": 0.1, "max_steps": 4},
      enabled=framework_statuses[AgentFramework.LANGGRAPH]["available"],
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.LANGGRAPH],
        "library_ids": ["langgraph-runtime"],
        "requires_tool_calling": True,
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="llamaindex-direct",
      name="LlamaIndex Direct",
      description="LlamaIndex OpenAILike baseline for registered OpenAI-compatible endpoints.",
      strategy_kind=AgentStrategyKind.DIRECT,
      framework=AgentFramework.LLAMAINDEX,
      generation_defaults={"temperature": 0.7},
      enabled=framework_statuses[AgentFramework.LLAMAINDEX]["available"],
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.LLAMAINDEX],
        "library_ids": ["llamaindex-runtime"],
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="llamaindex-rag",
      name="LlamaIndex RAG",
      description="LlamaIndex prompt assembly with case-provided context documents.",
      strategy_kind=AgentStrategyKind.RAG,
      framework=AgentFramework.LLAMAINDEX,
      system_prompt=(
        "Answer using the retrieved context when it is relevant. "
        "If the context is insufficient, say what is missing instead of inventing details. "
        "Prefer one grounded answer over multiple speculative alternatives."
      ),
      retrieval_policy={"source": "case.metadata.context_documents"},
      generation_defaults={"temperature": 0.1},
      enabled=framework_statuses[AgentFramework.LLAMAINDEX]["available"],
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.LLAMAINDEX],
        "library_ids": ["llamaindex-runtime"],
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="opencode-plan",
      name="OpenCode Plan",
      description="OpenCode-style planning agent tuned for decomposition and structured reasoning.",
      strategy_kind=AgentStrategyKind.DIRECT,
      framework=AgentFramework.CUSTOM,
      system_prompt=(
        "Work like a planning agent. Break the request into a short execution plan internally, "
        "track the key constraints, then return a structured final answer without exposing chain-of-thought "
        "or pretending to have run tools."
      ),
      generation_defaults={"temperature": 0.3},
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.CUSTOM],
        "library_ids": ["opencode-runtime"],
        "agent_family": "opencode",
      },
      created_at=now,
      updated_at=now,
    ),
    AgentProfileRecord(
      id="opencode-build",
      name="OpenCode Build",
      description="OpenCode-style build agent that uses tools before composing a final answer.",
      strategy_kind=AgentStrategyKind.TOOL,
      framework=AgentFramework.CUSTOM,
      system_prompt=(
        "Work like a build agent. Use tools when they help, keep intermediate steps concise, "
        "and return a final answer only after incorporating tool outputs."
      ),
      tool_names=["get_current_time", "echo_text"],
      generation_defaults={"temperature": 0.2, "max_steps": 4},
      metadata={
        "seeded": True,
        "runtime_status": framework_statuses[AgentFramework.CUSTOM],
        "library_ids": ["opencode-runtime"],
        "agent_family": "opencode",
        "requires_tool_calling": True,
      },
      created_at=now,
      updated_at=now,
    ),
  ]

  for profile in default_profiles:
    existing = await container.agent_profile_repository.get(profile.id)
    if existing is None:
      await container.agent_profile_repository.save(profile)
      continue

    if existing.metadata.get("seeded"):
      await container.agent_profile_repository.save(
        existing.model_copy(
          update={
            "name": profile.name,
            "description": profile.description,
            "strategy_kind": profile.strategy_kind,
            "framework": profile.framework,
            "system_prompt": profile.system_prompt,
            "tool_names": profile.tool_names,
            "retrieval_policy": profile.retrieval_policy,
            "generation_defaults": profile.generation_defaults,
            "enabled": profile.enabled,
            "metadata": {
              **existing.metadata,
              **profile.metadata,
              "seeded": True,
            },
            "updated_at": now,
          }
        )
      )
