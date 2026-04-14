import asyncio

from call_llm_api.domain.models import (
  AgentProfileRecord,
  BenchmarkCaseRecord,
  BenchmarkCaseResultRecord,
  BenchmarkRunRecord,
  BenchmarkSuiteRecord,
  ModelRegistryRecord,
  RunRecord,
  ThreadRecord,
)


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


class InMemoryModelRegistryRepository:
  def __init__(self) -> None:
    self._models: dict[str, ModelRegistryRecord] = {}
    self._lock = asyncio.Lock()

  async def save(self, model: ModelRegistryRecord) -> ModelRegistryRecord:
    async with self._lock:
      self._models[model.id] = model
      return model

  async def get(self, model_id: str) -> ModelRegistryRecord | None:
    async with self._lock:
      return self._models.get(model_id)

  async def list_models(self) -> list[ModelRegistryRecord]:
    async with self._lock:
      return sorted(self._models.values(), key=lambda record: record.updated_at, reverse=True)


class InMemoryAgentProfileRepository:
  def __init__(self) -> None:
    self._profiles: dict[str, AgentProfileRecord] = {}
    self._lock = asyncio.Lock()

  async def save(self, profile: AgentProfileRecord) -> AgentProfileRecord:
    async with self._lock:
      self._profiles[profile.id] = profile
      return profile

  async def get(self, profile_id: str) -> AgentProfileRecord | None:
    async with self._lock:
      return self._profiles.get(profile_id)

  async def list_profiles(self) -> list[AgentProfileRecord]:
    async with self._lock:
      return sorted(self._profiles.values(), key=lambda record: record.updated_at, reverse=True)


class InMemoryBenchmarkSuiteRepository:
  def __init__(self) -> None:
    self._suites: dict[str, BenchmarkSuiteRecord] = {}
    self._cases: dict[str, BenchmarkCaseRecord] = {}
    self._lock = asyncio.Lock()

  async def save_suite(self, suite: BenchmarkSuiteRecord) -> BenchmarkSuiteRecord:
    async with self._lock:
      self._suites[suite.id] = suite
      return suite

  async def get_suite(self, suite_id: str) -> BenchmarkSuiteRecord | None:
    async with self._lock:
      return self._suites.get(suite_id)

  async def list_suites(self) -> list[BenchmarkSuiteRecord]:
    async with self._lock:
      return sorted(self._suites.values(), key=lambda record: record.updated_at, reverse=True)

  async def save_case(self, case: BenchmarkCaseRecord) -> BenchmarkCaseRecord:
    async with self._lock:
      self._cases[case.id] = case
      return case

  async def get_case(self, case_id: str) -> BenchmarkCaseRecord | None:
    async with self._lock:
      return self._cases.get(case_id)

  async def list_cases(self, suite_id: str) -> list[BenchmarkCaseRecord]:
    async with self._lock:
      matching = [case for case in self._cases.values() if case.suite_id == suite_id]
      return sorted(matching, key=lambda record: record.created_at)


class InMemoryBenchmarkRunRepository:
  def __init__(self) -> None:
    self._runs: dict[str, BenchmarkRunRecord] = {}
    self._case_results: dict[str, BenchmarkCaseResultRecord] = {}
    self._lock = asyncio.Lock()

  async def save_run(self, run: BenchmarkRunRecord) -> BenchmarkRunRecord:
    async with self._lock:
      self._runs[run.id] = run
      return run

  async def get_run(self, run_id: str) -> BenchmarkRunRecord | None:
    async with self._lock:
      return self._runs.get(run_id)

  async def list_runs(self) -> list[BenchmarkRunRecord]:
    async with self._lock:
      return sorted(self._runs.values(), key=lambda record: record.created_at, reverse=True)

  async def save_case_result(self, result: BenchmarkCaseResultRecord) -> BenchmarkCaseResultRecord:
    async with self._lock:
      self._case_results[result.id] = result
      return result

  async def list_case_results(self, run_id: str) -> list[BenchmarkCaseResultRecord]:
    async with self._lock:
      matching = [record for record in self._case_results.values() if record.benchmark_run_id == run_id]
      return sorted(matching, key=lambda record: record.created_at)
