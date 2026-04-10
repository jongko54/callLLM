from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from call_llm_api.core.config import Settings
from call_llm_api.domain.models import ChatMessage, RunRecord, ThreadRecord


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
