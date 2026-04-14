from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from call_llm_api.core.config import Settings
from call_llm_api.domain.models import (
  AgentProfileRecord,
  BenchmarkCaseRecord,
  BenchmarkCaseResultRecord,
  BenchmarkRunRecord,
  BenchmarkSuiteRecord,
  ChatMessage,
  ModelRegistryRecord,
  RunRecord,
  ThreadRecord,
)


class Base(DeclarativeBase):
  pass


class ThreadTable(Base):
  __tablename__ = "threads"

  id: Mapped[str] = mapped_column(String(64), primary_key=True)
  title: Mapped[str | None] = mapped_column(String(255), nullable=True)
  messages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
  metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
  created_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  updated_at: Mapped[Any] = mapped_column(DateTime(timezone=True))


class RunTable(Base):
  __tablename__ = "runs"

  id: Mapped[str] = mapped_column(String(64), primary_key=True)
  kind: Mapped[str] = mapped_column(String(32))
  status: Mapped[str] = mapped_column(String(32))
  provider: Mapped[str] = mapped_column(String(128))
  model: Mapped[str] = mapped_column(String(255))
  thread_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
  job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
  messages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
  output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
  raw_response: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
  error: Mapped[str | None] = mapped_column(Text, nullable=True)
  events: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
  metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
  created_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  updated_at: Mapped[Any] = mapped_column(DateTime(timezone=True))


class ModelRegistryTable(Base):
  __tablename__ = "model_registry"

  id: Mapped[str] = mapped_column(String(64), primary_key=True)
  name: Mapped[str] = mapped_column(String(255))
  provider: Mapped[str] = mapped_column(String(64))
  base_url: Mapped[str] = mapped_column(String(512))
  served_model_name: Mapped[str] = mapped_column(String(255))
  api_type: Mapped[str] = mapped_column(String(64))
  api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
  enabled: Mapped[bool]
  health_status: Mapped[str] = mapped_column(String(64))
  capabilities_json: Mapped[dict[str, Any]] = mapped_column("capabilities", JSON, default=dict)
  default_params_json: Mapped[dict[str, Any]] = mapped_column("default_params", JSON, default=dict)
  metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
  created_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  updated_at: Mapped[Any] = mapped_column(DateTime(timezone=True))


class AgentProfileTable(Base):
  __tablename__ = "agent_profiles"

  id: Mapped[str] = mapped_column(String(64), primary_key=True)
  name: Mapped[str] = mapped_column(String(255))
  description: Mapped[str | None] = mapped_column(Text, nullable=True)
  strategy_kind: Mapped[str] = mapped_column(String(64))
  framework: Mapped[str] = mapped_column(String(64))
  system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
  tool_names: Mapped[list[str]] = mapped_column(JSON, default=list)
  retrieval_policy_json: Mapped[dict[str, Any]] = mapped_column("retrieval_policy", JSON, default=dict)
  generation_defaults_json: Mapped[dict[str, Any]] = mapped_column("generation_defaults", JSON, default=dict)
  metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
  enabled: Mapped[bool]
  created_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  updated_at: Mapped[Any] = mapped_column(DateTime(timezone=True))


class BenchmarkSuiteTable(Base):
  __tablename__ = "benchmark_suites"

  id: Mapped[str] = mapped_column(String(64), primary_key=True)
  name: Mapped[str] = mapped_column(String(255))
  version: Mapped[str] = mapped_column(String(64))
  description: Mapped[str | None] = mapped_column(Text, nullable=True)
  tags: Mapped[list[str]] = mapped_column(JSON, default=list)
  status: Mapped[str] = mapped_column(String(64))
  metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
  created_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  updated_at: Mapped[Any] = mapped_column(DateTime(timezone=True))


class BenchmarkCaseTable(Base):
  __tablename__ = "benchmark_cases"

  id: Mapped[str] = mapped_column(String(64), primary_key=True)
  suite_id: Mapped[str] = mapped_column(String(64), index=True)
  name: Mapped[str] = mapped_column(String(255))
  slug: Mapped[str] = mapped_column(String(255))
  input_messages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
  expected_output_json: Mapped[dict[str, Any]] = mapped_column("expected_output", JSON, default=dict)
  rubric_json: Mapped[dict[str, Any]] = mapped_column("rubric", JSON, default=dict)
  metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
  enabled: Mapped[bool]
  created_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  updated_at: Mapped[Any] = mapped_column(DateTime(timezone=True))


class BenchmarkRunTable(Base):
  __tablename__ = "benchmark_runs"

  id: Mapped[str] = mapped_column(String(64), primary_key=True)
  suite_id: Mapped[str] = mapped_column(String(64), index=True)
  model_id: Mapped[str] = mapped_column(String(64), index=True)
  agent_profile_id: Mapped[str] = mapped_column(String(64), index=True)
  status: Mapped[str] = mapped_column(String(64))
  runner_version: Mapped[str] = mapped_column(String(64))
  params_json: Mapped[dict[str, Any]] = mapped_column("params", JSON, default=dict)
  summary_json: Mapped[dict[str, Any]] = mapped_column("summary", JSON, default=dict)
  error: Mapped[str | None] = mapped_column(Text, nullable=True)
  created_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  updated_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  started_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=True)
  finished_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=True)


class BenchmarkCaseResultTable(Base):
  __tablename__ = "benchmark_case_results"

  id: Mapped[str] = mapped_column(String(128), primary_key=True)
  benchmark_run_id: Mapped[str] = mapped_column(String(64), index=True)
  benchmark_case_id: Mapped[str] = mapped_column(String(64), index=True)
  status: Mapped[str] = mapped_column(String(64))
  latency_ms: Mapped[int | None]
  first_token_ms: Mapped[int | None]
  prompt_tokens: Mapped[int | None]
  completion_tokens: Mapped[int | None]
  score_json: Mapped[dict[str, Any]] = mapped_column("score", JSON, default=dict)
  output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
  raw_output_json: Mapped[dict[str, Any] | None] = mapped_column("raw_output", JSON, nullable=True)
  trace_json: Mapped[list[dict[str, Any]]] = mapped_column("trace", JSON, default=list)
  error: Mapped[str | None] = mapped_column(Text, nullable=True)
  created_at: Mapped[Any] = mapped_column(DateTime(timezone=True))
  updated_at: Mapped[Any] = mapped_column(DateTime(timezone=True))


class SQLAlchemyDatabaseManager:
  def __init__(self, settings: Settings) -> None:
    self._settings = settings
    self._ensure_sqlite_dir()
    self.engine: AsyncEngine = create_async_engine(settings.database_url, future=True)
    self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)

  async def initialize(self) -> None:
    if not self._settings.database_auto_create:
      return
    async with self.engine.begin() as conn:
      await conn.run_sync(Base.metadata.create_all)

  async def close(self) -> None:
    await self.engine.dispose()

  def _ensure_sqlite_dir(self) -> None:
    if not self._settings.database_url.startswith("sqlite"):
      return
    raw_path = self._settings.database_url.split("///", maxsplit=1)[-1]
    db_path = Path(raw_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)


class SQLAlchemyRunRepository:
  def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
    self._session_factory = session_factory

  async def save(self, run: RunRecord) -> RunRecord:
    async with self._session_factory() as session:
      record = await session.get(RunTable, run.id)
      payload = self._run_to_row(run)
      if record is None:
        record = RunTable(**payload)
        session.add(record)
      else:
        for key, value in payload.items():
          setattr(record, key, value)
      await session.commit()
      return self._row_to_run(record)

  async def get(self, run_id: str) -> RunRecord | None:
    async with self._session_factory() as session:
      record = await session.get(RunTable, run_id)
      if record is None:
        return None
      return self._row_to_run(record)

  async def list_runs(self) -> list[RunRecord]:
    async with self._session_factory() as session:
      result = await session.execute(select(RunTable).order_by(RunTable.created_at.desc()))
      return [self._row_to_run(record) for record in result.scalars().all()]

  @staticmethod
  def _run_to_row(run: RunRecord) -> dict[str, Any]:
    return {
      "id": run.id,
      "kind": run.kind.value,
      "status": run.status.value,
      "provider": run.provider,
      "model": run.model,
      "thread_id": run.thread_id,
      "job_id": run.job_id,
      "messages": [message.model_dump(mode="json") for message in run.messages],
      "output_text": run.output_text,
      "raw_response": run.raw_response,
      "error": run.error,
      "events": run.events,
      "metadata_json": run.metadata,
      "created_at": run.created_at,
      "updated_at": run.updated_at,
    }

  @staticmethod
  def _row_to_run(record: RunTable) -> RunRecord:
    return RunRecord(
      id=record.id,
      kind=record.kind,
      status=record.status,
      provider=record.provider,
      model=record.model,
      thread_id=record.thread_id,
      job_id=record.job_id,
      messages=[ChatMessage.model_validate(message) for message in record.messages or []],
      output_text=record.output_text,
      raw_response=record.raw_response,
      error=record.error,
      events=record.events or [],
      metadata=record.metadata_json or {},
      created_at=record.created_at,
      updated_at=record.updated_at,
    )


class SQLAlchemyThreadRepository:
  def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
    self._session_factory = session_factory

  async def save(self, thread: ThreadRecord) -> ThreadRecord:
    async with self._session_factory() as session:
      record = await session.get(ThreadTable, thread.id)
      payload = self._thread_to_row(thread)
      if record is None:
        record = ThreadTable(**payload)
        session.add(record)
      else:
        for key, value in payload.items():
          setattr(record, key, value)
      await session.commit()
      return self._row_to_thread(record)

  async def get(self, thread_id: str) -> ThreadRecord | None:
    async with self._session_factory() as session:
      record = await session.get(ThreadTable, thread_id)
      if record is None:
        return None
      return self._row_to_thread(record)

  async def list_threads(self) -> list[ThreadRecord]:
    async with self._session_factory() as session:
      result = await session.execute(select(ThreadTable).order_by(ThreadTable.updated_at.desc()))
      return [self._row_to_thread(record) for record in result.scalars().all()]

  @staticmethod
  def _thread_to_row(thread: ThreadRecord) -> dict[str, Any]:
    return {
      "id": thread.id,
      "title": thread.title,
      "messages": [message.model_dump(mode="json") for message in thread.messages],
      "metadata_json": thread.metadata,
      "created_at": thread.created_at,
      "updated_at": thread.updated_at,
    }

  @staticmethod
  def _row_to_thread(record: ThreadTable) -> ThreadRecord:
    return ThreadRecord(
      id=record.id,
      title=record.title,
      messages=[ChatMessage.model_validate(message) for message in record.messages or []],
      metadata=record.metadata_json or {},
      created_at=record.created_at,
      updated_at=record.updated_at,
    )


class SQLAlchemyModelRegistryRepository:
  def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
    self._session_factory = session_factory

  async def save(self, model: ModelRegistryRecord) -> ModelRegistryRecord:
    async with self._session_factory() as session:
      record = await session.get(ModelRegistryTable, model.id)
      payload = self._model_to_row(model)
      if record is None:
        record = ModelRegistryTable(**payload)
        session.add(record)
      else:
        for key, value in payload.items():
          setattr(record, key, value)
      await session.commit()
      return self._row_to_model(record)

  async def get(self, model_id: str) -> ModelRegistryRecord | None:
    async with self._session_factory() as session:
      record = await session.get(ModelRegistryTable, model_id)
      if record is None:
        return None
      return self._row_to_model(record)

  async def list_models(self) -> list[ModelRegistryRecord]:
    async with self._session_factory() as session:
      result = await session.execute(select(ModelRegistryTable).order_by(ModelRegistryTable.updated_at.desc()))
      return [self._row_to_model(record) for record in result.scalars().all()]

  @staticmethod
  def _model_to_row(model: ModelRegistryRecord) -> dict[str, Any]:
    return {
      "id": model.id,
      "name": model.name,
      "provider": model.provider,
      "base_url": model.base_url,
      "served_model_name": model.served_model_name,
      "api_type": model.api_type,
      "api_key": model.api_key,
      "enabled": model.enabled,
      "health_status": model.health_status.value,
      "capabilities_json": model.capabilities,
      "default_params_json": model.default_params,
      "metadata_json": model.metadata,
      "created_at": model.created_at,
      "updated_at": model.updated_at,
    }

  @staticmethod
  def _row_to_model(record: ModelRegistryTable) -> ModelRegistryRecord:
    return ModelRegistryRecord(
      id=record.id,
      name=record.name,
      provider=record.provider,
      base_url=record.base_url,
      served_model_name=record.served_model_name,
      api_type=record.api_type,
      api_key=record.api_key,
      enabled=record.enabled,
      health_status=record.health_status,
      capabilities=record.capabilities_json or {},
      default_params=record.default_params_json or {},
      metadata=record.metadata_json or {},
      created_at=record.created_at,
      updated_at=record.updated_at,
    )


class SQLAlchemyAgentProfileRepository:
  def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
    self._session_factory = session_factory

  async def save(self, profile: AgentProfileRecord) -> AgentProfileRecord:
    async with self._session_factory() as session:
      record = await session.get(AgentProfileTable, profile.id)
      payload = self._profile_to_row(profile)
      if record is None:
        record = AgentProfileTable(**payload)
        session.add(record)
      else:
        for key, value in payload.items():
          setattr(record, key, value)
      await session.commit()
      return self._row_to_profile(record)

  async def get(self, profile_id: str) -> AgentProfileRecord | None:
    async with self._session_factory() as session:
      record = await session.get(AgentProfileTable, profile_id)
      if record is None:
        return None
      return self._row_to_profile(record)

  async def list_profiles(self) -> list[AgentProfileRecord]:
    async with self._session_factory() as session:
      result = await session.execute(select(AgentProfileTable).order_by(AgentProfileTable.updated_at.desc()))
      return [self._row_to_profile(record) for record in result.scalars().all()]

  @staticmethod
  def _profile_to_row(profile: AgentProfileRecord) -> dict[str, Any]:
    return {
      "id": profile.id,
      "name": profile.name,
      "description": profile.description,
      "strategy_kind": profile.strategy_kind.value,
      "framework": profile.framework.value,
      "system_prompt": profile.system_prompt,
      "tool_names": profile.tool_names,
      "retrieval_policy_json": profile.retrieval_policy,
      "generation_defaults_json": profile.generation_defaults,
      "metadata_json": profile.metadata,
      "enabled": profile.enabled,
      "created_at": profile.created_at,
      "updated_at": profile.updated_at,
    }

  @staticmethod
  def _row_to_profile(record: AgentProfileTable) -> AgentProfileRecord:
    return AgentProfileRecord(
      id=record.id,
      name=record.name,
      description=record.description,
      strategy_kind=record.strategy_kind,
      framework=record.framework,
      system_prompt=record.system_prompt,
      tool_names=record.tool_names or [],
      retrieval_policy=record.retrieval_policy_json or {},
      generation_defaults=record.generation_defaults_json or {},
      metadata=record.metadata_json or {},
      enabled=record.enabled,
      created_at=record.created_at,
      updated_at=record.updated_at,
    )


class SQLAlchemyBenchmarkSuiteRepository:
  def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
    self._session_factory = session_factory

  async def save_suite(self, suite: BenchmarkSuiteRecord) -> BenchmarkSuiteRecord:
    async with self._session_factory() as session:
      record = await session.get(BenchmarkSuiteTable, suite.id)
      payload = self._suite_to_row(suite)
      if record is None:
        record = BenchmarkSuiteTable(**payload)
        session.add(record)
      else:
        for key, value in payload.items():
          setattr(record, key, value)
      await session.commit()
      return self._row_to_suite(record)

  async def get_suite(self, suite_id: str) -> BenchmarkSuiteRecord | None:
    async with self._session_factory() as session:
      record = await session.get(BenchmarkSuiteTable, suite_id)
      if record is None:
        return None
      return self._row_to_suite(record)

  async def list_suites(self) -> list[BenchmarkSuiteRecord]:
    async with self._session_factory() as session:
      result = await session.execute(select(BenchmarkSuiteTable).order_by(BenchmarkSuiteTable.updated_at.desc()))
      return [self._row_to_suite(record) for record in result.scalars().all()]

  async def save_case(self, case: BenchmarkCaseRecord) -> BenchmarkCaseRecord:
    async with self._session_factory() as session:
      record = await session.get(BenchmarkCaseTable, case.id)
      payload = self._case_to_row(case)
      if record is None:
        record = BenchmarkCaseTable(**payload)
        session.add(record)
      else:
        for key, value in payload.items():
          setattr(record, key, value)
      await session.commit()
      return self._row_to_case(record)

  async def get_case(self, case_id: str) -> BenchmarkCaseRecord | None:
    async with self._session_factory() as session:
      record = await session.get(BenchmarkCaseTable, case_id)
      if record is None:
        return None
      return self._row_to_case(record)

  async def list_cases(self, suite_id: str) -> list[BenchmarkCaseRecord]:
    async with self._session_factory() as session:
      result = await session.execute(
        select(BenchmarkCaseTable)
        .where(BenchmarkCaseTable.suite_id == suite_id)
        .order_by(BenchmarkCaseTable.created_at.asc())
      )
      return [self._row_to_case(record) for record in result.scalars().all()]

  @staticmethod
  def _suite_to_row(suite: BenchmarkSuiteRecord) -> dict[str, Any]:
    return {
      "id": suite.id,
      "name": suite.name,
      "version": suite.version,
      "description": suite.description,
      "tags": suite.tags,
      "status": suite.status.value,
      "metadata_json": suite.metadata,
      "created_at": suite.created_at,
      "updated_at": suite.updated_at,
    }

  @staticmethod
  def _row_to_suite(record: BenchmarkSuiteTable) -> BenchmarkSuiteRecord:
    return BenchmarkSuiteRecord(
      id=record.id,
      name=record.name,
      version=record.version,
      description=record.description,
      tags=record.tags or [],
      status=record.status,
      metadata=record.metadata_json or {},
      created_at=record.created_at,
      updated_at=record.updated_at,
    )

  @staticmethod
  def _case_to_row(case: BenchmarkCaseRecord) -> dict[str, Any]:
    return {
      "id": case.id,
      "suite_id": case.suite_id,
      "name": case.name,
      "slug": case.slug,
      "input_messages": [message.model_dump(mode="json") for message in case.input_messages],
      "expected_output_json": case.expected_output,
      "rubric_json": case.rubric,
      "metadata_json": case.metadata,
      "enabled": case.enabled,
      "created_at": case.created_at,
      "updated_at": case.updated_at,
    }

  @staticmethod
  def _row_to_case(record: BenchmarkCaseTable) -> BenchmarkCaseRecord:
    return BenchmarkCaseRecord(
      id=record.id,
      suite_id=record.suite_id,
      name=record.name,
      slug=record.slug,
      input_messages=[ChatMessage.model_validate(message) for message in record.input_messages or []],
      expected_output=record.expected_output_json or {},
      rubric=record.rubric_json or {},
      metadata=record.metadata_json or {},
      enabled=record.enabled,
      created_at=record.created_at,
      updated_at=record.updated_at,
    )


class SQLAlchemyBenchmarkRunRepository:
  def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
    self._session_factory = session_factory

  async def save_run(self, run: BenchmarkRunRecord) -> BenchmarkRunRecord:
    async with self._session_factory() as session:
      record = await session.get(BenchmarkRunTable, run.id)
      payload = self._run_to_row(run)
      if record is None:
        record = BenchmarkRunTable(**payload)
        session.add(record)
      else:
        for key, value in payload.items():
          setattr(record, key, value)
      await session.commit()
      return self._row_to_run(record)

  async def get_run(self, run_id: str) -> BenchmarkRunRecord | None:
    async with self._session_factory() as session:
      record = await session.get(BenchmarkRunTable, run_id)
      if record is None:
        return None
      return self._row_to_run(record)

  async def list_runs(self) -> list[BenchmarkRunRecord]:
    async with self._session_factory() as session:
      result = await session.execute(select(BenchmarkRunTable).order_by(BenchmarkRunTable.created_at.desc()))
      return [self._row_to_run(record) for record in result.scalars().all()]

  async def save_case_result(self, result: BenchmarkCaseResultRecord) -> BenchmarkCaseResultRecord:
    async with self._session_factory() as session:
      record = await session.get(BenchmarkCaseResultTable, result.id)
      payload = self._case_result_to_row(result)
      if record is None:
        record = BenchmarkCaseResultTable(**payload)
        session.add(record)
      else:
        for key, value in payload.items():
          setattr(record, key, value)
      await session.commit()
      return self._row_to_case_result(record)

  async def list_case_results(self, run_id: str) -> list[BenchmarkCaseResultRecord]:
    async with self._session_factory() as session:
      result = await session.execute(
        select(BenchmarkCaseResultTable)
        .where(BenchmarkCaseResultTable.benchmark_run_id == run_id)
        .order_by(BenchmarkCaseResultTable.created_at.asc())
      )
      return [self._row_to_case_result(record) for record in result.scalars().all()]

  @staticmethod
  def _run_to_row(run: BenchmarkRunRecord) -> dict[str, Any]:
    return {
      "id": run.id,
      "suite_id": run.suite_id,
      "model_id": run.model_id,
      "agent_profile_id": run.agent_profile_id,
      "status": run.status.value,
      "runner_version": run.runner_version,
      "params_json": run.params,
      "summary_json": run.summary,
      "error": run.error,
      "created_at": run.created_at,
      "updated_at": run.updated_at,
      "started_at": run.started_at,
      "finished_at": run.finished_at,
    }

  @staticmethod
  def _row_to_run(record: BenchmarkRunTable) -> BenchmarkRunRecord:
    return BenchmarkRunRecord(
      id=record.id,
      suite_id=record.suite_id,
      model_id=record.model_id,
      agent_profile_id=record.agent_profile_id,
      status=record.status,
      runner_version=record.runner_version,
      params=record.params_json or {},
      summary=record.summary_json or {},
      error=record.error,
      created_at=record.created_at,
      updated_at=record.updated_at,
      started_at=record.started_at,
      finished_at=record.finished_at,
    )

  @staticmethod
  def _case_result_to_row(result: BenchmarkCaseResultRecord) -> dict[str, Any]:
    return {
      "id": result.id,
      "benchmark_run_id": result.benchmark_run_id,
      "benchmark_case_id": result.benchmark_case_id,
      "status": result.status.value,
      "latency_ms": result.latency_ms,
      "first_token_ms": result.first_token_ms,
      "prompt_tokens": result.prompt_tokens,
      "completion_tokens": result.completion_tokens,
      "score_json": result.score,
      "output_text": result.output_text,
      "raw_output_json": result.raw_output,
      "trace_json": result.trace,
      "error": result.error,
      "created_at": result.created_at,
      "updated_at": result.updated_at,
    }

  @staticmethod
  def _row_to_case_result(record: BenchmarkCaseResultTable) -> BenchmarkCaseResultRecord:
    return BenchmarkCaseResultRecord(
      id=record.id,
      benchmark_run_id=record.benchmark_run_id,
      benchmark_case_id=record.benchmark_case_id,
      status=record.status,
      latency_ms=record.latency_ms,
      first_token_ms=record.first_token_ms,
      prompt_tokens=record.prompt_tokens,
      completion_tokens=record.completion_tokens,
      score=record.score_json or {},
      output_text=record.output_text,
      raw_output=record.raw_output_json,
      trace=record.trace_json or [],
      error=record.error,
      created_at=record.created_at,
      updated_at=record.updated_at,
    )
