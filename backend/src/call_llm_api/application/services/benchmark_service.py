import re
from collections.abc import Sequence
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from call_llm_api.application.benchmark_runners import (
  BenchmarkRunnerContext,
  BenchmarkRunnerRegistry,
  build_default_benchmark_runner_registry,
)
from call_llm_api.application.services.agent_profile_service import AgentProfileService
from call_llm_api.application.services.model_client_factory import (
  ModelClientFactory,
  build_openai_compatible_client_for_model,
)
from call_llm_api.application.services.model_registry_service import ModelRegistryService
from call_llm_api.application.services.provider_errors import normalize_provider_case_error
from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import BadRequestError, NotFoundError, ProviderRequestError, ToolExecutionError
from call_llm_api.domain.models import (
  AgentFramework,
  AgentProfileRecord,
  AgentStrategyKind,
  BenchmarkCaseRecord,
  BenchmarkCaseResultRecord,
  BenchmarkHistoryEntryRecord,
  BenchmarkRunRecord,
  BenchmarkRunSnapshotRecord,
  BenchmarkRunStatus,
  BenchmarkSuiteRecord,
  BenchmarkSuiteStatus,
  ChatMessage,
  ModelHealthStatus,
  ModelRegistryRecord,
)
from call_llm_api.infrastructure.llm.base import LLMProvider
from call_llm_api.infrastructure.persistence.base import (
  BenchmarkRunRepository,
  BenchmarkSuiteRepository,
)
from call_llm_api.infrastructure.tools.registry import ToolRegistry


class BenchmarkService:
  def __init__(
    self,
    *,
    model_registry_service: ModelRegistryService,
    agent_profile_service: AgentProfileService,
    benchmark_suite_repository: BenchmarkSuiteRepository,
    benchmark_run_repository: BenchmarkRunRepository,
    tool_registry: ToolRegistry,
    settings: Settings,
    runner_registry: BenchmarkRunnerRegistry | None = None,
    client_factory: ModelClientFactory | None = None,
  ) -> None:
    self._model_registry_service = model_registry_service
    self._agent_profile_service = agent_profile_service
    self._benchmark_suite_repository = benchmark_suite_repository
    self._benchmark_run_repository = benchmark_run_repository
    self._tool_registry = tool_registry
    self._settings = settings
    self._runner_registry = runner_registry or build_default_benchmark_runner_registry()
    self._client_factory = client_factory

  async def list_benchmark_suites(self) -> list[BenchmarkSuiteRecord]:
    return await self._benchmark_suite_repository.list_suites()

  async def get_benchmark_suite(self, suite_id: str) -> BenchmarkSuiteRecord:
    suite = await self._benchmark_suite_repository.get_suite(suite_id)
    if suite is None:
      raise NotFoundError(f"Benchmark suite '{suite_id}' was not found.")
    return suite

  async def create_benchmark_suite(
    self,
    *,
    name: str,
    version: str,
    description: str | None,
    tags: list[str] | None,
    status: BenchmarkSuiteStatus | str,
    metadata: dict | None,
    suite_id: str | None = None,
  ) -> BenchmarkSuiteRecord:
    now = datetime.now(UTC)
    existing = None
    if suite_id:
      existing = await self._benchmark_suite_repository.get_suite(suite_id)

    suite = BenchmarkSuiteRecord(
      id=suite_id or uuid4().hex,
      name=name,
      version=version,
      description=description,
      tags=tags or [],
      status=status,
      metadata=metadata or {},
      created_at=existing.created_at if existing else now,
      updated_at=now,
    )
    return await self._benchmark_suite_repository.save_suite(suite)

  async def add_benchmark_case(
    self,
    *,
    suite_id: str,
    name: str,
    slug: str | None,
    input_messages: Sequence[ChatMessage],
    expected_output: dict | None,
    rubric: dict | None,
    metadata: dict | None,
    enabled: bool,
    case_id: str | None = None,
  ) -> BenchmarkCaseRecord:
    await self.get_benchmark_suite(suite_id)
    now = datetime.now(UTC)
    existing = None
    if case_id:
      existing = await self._benchmark_suite_repository.get_case(case_id)

    case = BenchmarkCaseRecord(
      id=case_id or uuid4().hex,
      suite_id=suite_id,
      name=name,
      slug=slug or _slugify(name),
      input_messages=list(input_messages),
      expected_output=expected_output or {},
      rubric=rubric or {},
      metadata=metadata or {},
      enabled=enabled,
      created_at=existing.created_at if existing else now,
      updated_at=now,
    )
    return await self._benchmark_suite_repository.save_case(case)

  async def list_benchmark_cases(self, suite_id: str) -> list[BenchmarkCaseRecord]:
    await self.get_benchmark_suite(suite_id)
    return await self._benchmark_suite_repository.list_cases(suite_id)

  async def list_benchmark_runs(self) -> list[BenchmarkRunRecord]:
    return await self._benchmark_run_repository.list_runs()

  async def list_benchmark_history(self, *, limit: int = 6) -> list[BenchmarkHistoryEntryRecord]:
    if limit <= 0:
      return []

    runs = await self._benchmark_run_repository.list_runs()
    if not runs:
      return []

    suites = {suite.id: suite for suite in await self._benchmark_suite_repository.list_suites()}
    models = {model.id: model for model in await self._model_registry_service.list_registry_models()}
    profiles = {profile.id: profile for profile in await self._agent_profile_service.list_agent_profiles()}

    grouped_runs: dict[str, list[BenchmarkRunRecord]] = {}
    for run in runs:
      grouped_runs.setdefault(run.suite_id, []).append(run)

    ordered_suite_ids = sorted(
      grouped_runs.keys(),
      key=lambda suite_id: max(
        [suites.get(suite_id).updated_at if suites.get(suite_id) else datetime.min.replace(tzinfo=UTC)]
        + [run.updated_at for run in grouped_runs[suite_id]]
      ),
      reverse=True,
    )[:limit]

    history: list[BenchmarkHistoryEntryRecord] = []
    for suite_id in ordered_suite_ids:
      suite = suites.get(suite_id)
      if suite is None:
        continue

      cases = await self._benchmark_suite_repository.list_cases(suite_id)
      ordered_runs = sorted(grouped_runs[suite_id], key=lambda run: run.created_at)
      run_snapshots: list[BenchmarkRunSnapshotRecord] = []
      for run in ordered_runs:
        model = models.get(run.model_id) or self._build_missing_model_record(run.model_id, run.created_at)
        profile = profiles.get(run.agent_profile_id) or self._build_missing_profile_record(run.agent_profile_id, run.created_at)
        results = await self._benchmark_run_repository.list_case_results(run.id)
        run_snapshots.append(
          BenchmarkRunSnapshotRecord(
            run=run,
            model=model,
            profile=profile,
            results=results,
          )
        )

      history.append(
        BenchmarkHistoryEntryRecord(
          suite=suite,
          cases=cases,
          runs=run_snapshots,
          latest_updated_at=max([suite.updated_at] + [run.updated_at for run in ordered_runs]),
        )
      )

    return history

  async def get_benchmark_run(self, run_id: str) -> BenchmarkRunRecord:
    run = await self._benchmark_run_repository.get_run(run_id)
    if run is None:
      raise NotFoundError(f"Benchmark run '{run_id}' was not found.")
    return run

  async def list_benchmark_run_results(self, run_id: str) -> list[BenchmarkCaseResultRecord]:
    await self.get_benchmark_run(run_id)
    return await self._benchmark_run_repository.list_case_results(run_id)

  async def create_benchmark_run(
    self,
    *,
    suite_id: str,
    model_id: str,
    agent_profile_id: str,
    params: dict | None,
  ) -> BenchmarkRunRecord:
    await self.get_benchmark_suite(suite_id)
    model = await self._model_registry_service.get_registry_model(model_id)
    profile = await self._agent_profile_service.get_agent_profile(agent_profile_id)
    if not model.enabled:
      raise BadRequestError(f"Model '{model_id}' is disabled.")
    if not profile.enabled:
      raise BadRequestError(f"Agent profile '{agent_profile_id}' is disabled.")
    self._agent_profile_service.ensure_model_supports_profile(model, profile)

    now = datetime.now(UTC)
    run = BenchmarkRunRecord(
      id=uuid4().hex,
      suite_id=suite_id,
      model_id=model_id,
      agent_profile_id=agent_profile_id,
      status=BenchmarkRunStatus.QUEUED,
      params=params or {},
      created_at=now,
      updated_at=now,
    )
    return await self._benchmark_run_repository.save_run(run)

  async def execute_benchmark_run(self, run_id: str) -> BenchmarkRunRecord:
    run = await self.get_benchmark_run(run_id)
    model = await self._model_registry_service.get_registry_model(run.model_id)
    profile = await self._agent_profile_service.get_agent_profile(run.agent_profile_id)
    cases = [case for case in await self._benchmark_suite_repository.list_cases(run.suite_id) if case.enabled]
    self._agent_profile_service.ensure_model_supports_profile(model, profile)

    running = await self._benchmark_run_repository.save_run(
      run.model_copy(
        update={
          "status": BenchmarkRunStatus.RUNNING,
          "error": None,
          "summary": {},
          "started_at": datetime.now(UTC),
          "updated_at": datetime.now(UTC),
        }
      )
    )

    client = self._build_client_for_model(model)
    case_results: list[BenchmarkCaseResultRecord] = []
    try:
      for case in cases:
        case_result = await self._execute_case(
          client=client,
          run=running,
          model=model,
          profile=profile,
          case=case,
        )
        saved_case_result = await self._benchmark_run_repository.save_case_result(case_result)
        case_results.append(saved_case_result)

      summary = self._build_summary(case_results)
      return await self._benchmark_run_repository.save_run(
        running.model_copy(
          update={
            "status": BenchmarkRunStatus.COMPLETED,
            "summary": summary,
            "finished_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
          }
        )
      )
    except Exception as exc:
      return await self._benchmark_run_repository.save_run(
        running.model_copy(
          update={
            "status": BenchmarkRunStatus.FAILED,
            "error": str(exc),
            "summary": self._build_summary(case_results),
            "finished_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
          }
        )
      )
    finally:
      await client.close()

  async def _execute_case(
    self,
    *,
    client: LLMProvider,
    run: BenchmarkRunRecord,
    model: ModelRegistryRecord,
    profile: AgentProfileRecord,
    case: BenchmarkCaseRecord,
  ) -> BenchmarkCaseResultRecord:
    now = datetime.now(UTC)
    started = perf_counter()
    try:
      runner = self._runner_registry.get(profile.framework)
      result = await runner.run_case(
        BenchmarkRunnerContext(
          client=client,
          model=model,
          profile=profile,
          case=case,
          run=run,
          tool_registry=self._tool_registry,
          settings=self._settings,
        )
      )
      latency_ms = int((perf_counter() - started) * 1000)
      usage = result.usage or {}
      return BenchmarkCaseResultRecord(
        id=f"{run.id}:{case.id}",
        benchmark_run_id=run.id,
        benchmark_case_id=case.id,
        status=BenchmarkRunStatus.COMPLETED,
        latency_ms=latency_ms,
        first_token_ms=latency_ms,
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
        score=self._score_case_output(case, result.output_text),
        output_text=result.output_text,
        raw_output=result.raw_output,
        trace=result.trace,
        created_at=now,
        updated_at=datetime.now(UTC),
      )
    except (ProviderRequestError, ToolExecutionError, BadRequestError) as exc:
      return BenchmarkCaseResultRecord(
        id=f"{run.id}:{case.id}",
        benchmark_run_id=run.id,
        benchmark_case_id=case.id,
        status=BenchmarkRunStatus.FAILED,
        latency_ms=int((perf_counter() - started) * 1000),
        output_text=None,
        raw_output=None,
        trace=[],
        error=normalize_provider_case_error(getattr(exc, "message", str(exc))),
        created_at=now,
        updated_at=datetime.now(UTC),
      )
    except Exception as exc:
      return BenchmarkCaseResultRecord(
        id=f"{run.id}:{case.id}",
        benchmark_run_id=run.id,
        benchmark_case_id=case.id,
        status=BenchmarkRunStatus.FAILED,
        latency_ms=int((perf_counter() - started) * 1000),
        output_text=None,
        raw_output=None,
        trace=[
          {
            "event": "runner.exception",
            "framework": profile.framework.value,
            "error_type": exc.__class__.__name__,
          }
        ],
        error=normalize_provider_case_error(f"{exc.__class__.__name__}: {exc}"),
        created_at=now,
        updated_at=datetime.now(UTC),
      )

  def _build_client_for_model(self, model: ModelRegistryRecord) -> LLMProvider:
    if self._client_factory is not None:
      return self._client_factory(model)
    return build_openai_compatible_client_for_model(model=model, settings=self._settings)

  @staticmethod
  def _score_case_output(case: BenchmarkCaseRecord, output_text: str) -> dict:
    score: dict[str, bool | int] = {}
    contains = case.expected_output.get("contains")
    if isinstance(contains, str) and contains:
      score["contains_expected"] = contains.lower() in output_text.lower()

    keywords = case.expected_output.get("keywords")
    if isinstance(keywords, list):
      normalized = output_text.lower()
      matched = [keyword for keyword in keywords if isinstance(keyword, str) and keyword.lower() in normalized]
      score["keyword_match_count"] = len(matched)
      score["keyword_match_total"] = len([keyword for keyword in keywords if isinstance(keyword, str)])
    return score

  @staticmethod
  def _build_summary(results: Sequence[BenchmarkCaseResultRecord]) -> dict:
    completed = [result for result in results if result.status == BenchmarkRunStatus.COMPLETED]
    failed = [result for result in results if result.status == BenchmarkRunStatus.FAILED]
    latencies = [result.latency_ms for result in completed if isinstance(result.latency_ms, int)]
    contains_scores = [
      result.score.get("contains_expected")
      for result in completed
      if "contains_expected" in result.score
    ]
    return {
      "total_cases": len(results),
      "completed_cases": len(completed),
      "failed_cases": len(failed),
      "average_latency_ms": int(sum(latencies) / len(latencies)) if latencies else None,
      "contains_pass_rate": (
        round(sum(1 for value in contains_scores if value) / len(contains_scores), 4)
        if contains_scores
        else None
      ),
    }

  @staticmethod
  def _build_missing_model_record(model_id: str, timestamp: datetime) -> ModelRegistryRecord:
    return ModelRegistryRecord(
      id=model_id,
      name=f"Missing model ({model_id})",
      provider="unknown",
      base_url="",
      served_model_name=model_id,
      api_type="openai_compatible",
      api_key=None,
      enabled=False,
      health_status=ModelHealthStatus.UNAVAILABLE,
      capabilities={},
      default_params={},
      metadata={"missing": True},
      created_at=timestamp,
      updated_at=timestamp,
    )

  @staticmethod
  def _build_missing_profile_record(profile_id: str, timestamp: datetime) -> AgentProfileRecord:
    return AgentProfileRecord(
      id=profile_id,
      name=f"Missing profile ({profile_id})",
      description="The original agent profile is no longer present in the registry.",
      strategy_kind=AgentStrategyKind.DIRECT,
      framework=AgentFramework.CUSTOM,
      system_prompt=None,
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={"missing": True},
      enabled=False,
      created_at=timestamp,
      updated_at=timestamp,
    )


def _slugify(value: str) -> str:
  normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
  return normalized.strip("-") or uuid4().hex
