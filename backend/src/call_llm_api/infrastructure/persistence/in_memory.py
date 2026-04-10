import asyncio

from call_llm_api.domain.models import RunRecord, ThreadRecord


class InMemoryRunRepository:
  def __init__(self) -> None:
    self._runs: dict[str, RunRecord] = {}
    self._lock = asyncio.Lock()

  async def save(self, run: RunRecord) -> RunRecord:
    async with self._lock:
      self._runs[run.id] = run
      return run

  async def get(self, run_id: str) -> RunRecord | None:
    async with self._lock:
      return self._runs.get(run_id)

  async def list_runs(self) -> list[RunRecord]:
    async with self._lock:
      return sorted(self._runs.values(), key=lambda run: run.created_at, reverse=True)


class InMemoryThreadRepository:
  def __init__(self) -> None:
    self._threads: dict[str, ThreadRecord] = {}
    self._lock = asyncio.Lock()

  async def save(self, thread: ThreadRecord) -> ThreadRecord:
    async with self._lock:
      self._threads[thread.id] = thread
      return thread

  async def get(self, thread_id: str) -> ThreadRecord | None:
    async with self._lock:
      return self._threads.get(thread_id)

  async def list_threads(self) -> list[ThreadRecord]:
    async with self._lock:
      return sorted(self._threads.values(), key=lambda thread: thread.updated_at, reverse=True)
