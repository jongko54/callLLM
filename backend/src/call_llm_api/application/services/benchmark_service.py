import re
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from call_llm_api.application.benchmark_runners import (
  BenchmarkRunnerContext,
  BenchmarkRunnerRegistry,
  BenchmarkRunnerResult,
  build_provider_payload,
  build_request_preview,
  build_default_benchmark_runner_registry,
)
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
from call_llm_api.infrastructure.llm.openai_compatible import OpenAICompatibleClient
from call_llm_api.infrastructure.grounding import LocationGrounder, OpenStreetMapLocationGrounder
from call_llm_api.infrastructure.persistence.base import (
  AgentProfileRepository,
  BenchmarkRunRepository,
  BenchmarkSuiteRepository,
  ModelRegistryRepository,
)
from call_llm_api.infrastructure.tools.registry import ToolRegistry

IDENTITY_QUERY_PATTERN = re.compile(r"(너는\s*누구|누구야|정체가\s*뭐|뭐하는\s*애|what are you|who are you)", re.IGNORECASE)


class BenchmarkService:
  def __init__(
    self,
    *,
    model_registry_repository: ModelRegistryRepository,
    agent_profile_repository: AgentProfileRepository,
    benchmark_suite_repository: BenchmarkSuiteRepository,
    benchmark_run_repository: BenchmarkRunRepository,
    tool_registry: ToolRegistry,
    settings: Settings,
    runner_registry: BenchmarkRunnerRegistry | None = None,
    location_grounder: LocationGrounder | None = None,
  ) -> None:
    self._model_registry_repository = model_registry_repository
    self._agent_profile_repository = agent_profile_repository
    self._benchmark_suite_repository = benchmark_suite_repository
    self._benchmark_run_repository = benchmark_run_repository
    self._tool_registry = tool_registry
    self._settings = settings
    self._runner_registry = runner_registry or build_default_benchmark_runner_registry()
    self._location_grounder = location_grounder or OpenStreetMapLocationGrounder()

  async def list_registry_models(self) -> list[ModelRegistryRecord]:
    return await self._model_registry_repository.list_models()

  async def get_registry_model(self, model_id: str) -> ModelRegistryRecord:
    model = await self._model_registry_repository.get(model_id)
    if model is None:
      raise NotFoundError(f"Model '{model_id}' was not found.")
    return model

  async def register_model(
    self,
    *,
    name: str,
    provider: str,
    base_url: str,
    served_model_name: str,
    api_type: str,
    api_key: str | None,
    enabled: bool,
    capabilities: dict | None,
    default_params: dict | None,
    metadata: dict | None,
    model_id: str | None = None,
  ) -> ModelRegistryRecord:
    now = datetime.now(UTC)
    existing = None
    if model_id:
      existing = await self._model_registry_repository.get(model_id)

    record = ModelRegistryRecord(
      id=model_id or uuid4().hex,
      name=name,
      provider=provider,
      base_url=base_url,
      served_model_name=served_model_name,
      api_type=api_type,
      api_key=api_key,
      enabled=enabled,
      health_status=existing.health_status if existing else ModelHealthStatus.UNKNOWN,
      capabilities=capabilities or {},
      default_params=default_params or {},
      metadata=metadata or {},
      created_at=existing.created_at if existing else now,
      updated_at=now,
    )
    return await self._model_registry_repository.save(record)

  async def probe_model(self, model_id: str) -> ModelRegistryRecord:
    model = await self.get_registry_model(model_id)
    client = self._build_client_for_model(model)
    try:
      payload = await client.list_models()
      upstream_models = [
        item.get("id")
        for item in payload.get("data", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
      ]
      health = ModelHealthStatus.HEALTHY if model.served_model_name in upstream_models else ModelHealthStatus.UNAVAILABLE
      probed = model.model_copy(
        update={
          "health_status": health,
          "metadata": {
            **model.metadata,
            "last_probe_at": datetime.now(UTC).isoformat(),
            "last_probe_models": upstream_models,
          },
          "updated_at": datetime.now(UTC),
        }
      )
      return await self._model_registry_repository.save(probed)
    except ProviderRequestError as exc:
      failed = model.model_copy(
        update={
          "health_status": ModelHealthStatus.UNAVAILABLE,
          "metadata": {
            **model.metadata,
            "last_probe_at": datetime.now(UTC).isoformat(),
            "last_probe_error": exc.message,
          },
          "updated_at": datetime.now(UTC),
        }
      )
      return await self._model_registry_repository.save(failed)
    finally:
      await client.close()

  async def list_agent_profiles(self) -> list[AgentProfileRecord]:
    return await self._agent_profile_repository.list_profiles()

  async def get_agent_profile(self, profile_id: str) -> AgentProfileRecord:
    profile = await self._agent_profile_repository.get(profile_id)
    if profile is None:
      raise NotFoundError(f"Agent profile '{profile_id}' was not found.")
    return profile

  async def create_agent_profile(
    self,
    *,
    name: str,
    description: str | None,
    strategy_kind: AgentStrategyKind | str,
    framework: AgentFramework | str,
    system_prompt: str | None,
    tool_names: list[str] | None,
    retrieval_policy: dict | None,
    generation_defaults: dict | None,
    metadata: dict | None,
    enabled: bool,
    profile_id: str | None = None,
  ) -> AgentProfileRecord:
    now = datetime.now(UTC)
    existing = None
    if profile_id:
      existing = await self._agent_profile_repository.get(profile_id)

    profile = AgentProfileRecord(
      id=profile_id or uuid4().hex,
      name=name,
      description=description,
      strategy_kind=strategy_kind,
      framework=framework,
      system_prompt=system_prompt,
      tool_names=tool_names or [],
      retrieval_policy=retrieval_policy or {},
      generation_defaults=generation_defaults or {},
      metadata=metadata or {},
      enabled=enabled,
      created_at=existing.created_at if existing else now,
      updated_at=now,
    )
    return await self._agent_profile_repository.save(profile)

  async def execute_profile_response(
    self,
    *,
    model_id: str,
    profile_id: str,
    messages: list[ChatMessage],
    context_documents: list[str] | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    metadata: dict | None = None,
  ) -> tuple[ModelRegistryRecord, AgentProfileRecord, dict]:
    model = await self.get_registry_model(model_id)
    profile = await self.get_agent_profile(profile_id)

    if model.enabled is False or model.capabilities.get("chat_completions") is False:
      raise BadRequestError(f"Model '{model.name}' is not available for chat responses.")
    if not profile.enabled:
      raise BadRequestError(f"Agent profile '{profile.name}' is disabled.")
    self._ensure_model_supports_profile(model, profile)

    grounded_response = await self._maybe_build_grounded_response(profile, messages, metadata)
    if grounded_response is not None:
      grounded_response.setdefault("raw_output", {"grounded": True})
      grounded_response.setdefault("usage", {})
      return model, profile, grounded_response

    merged_context_documents = await self._merge_response_context_documents(messages, context_documents)
    case, run = self._build_response_case_and_run(
      model=model,
      profile=profile,
      messages=messages,
      context_documents=merged_context_documents,
      temperature=temperature,
      max_tokens=max_tokens,
      metadata=metadata,
    )

    client = self._build_client_for_model(model)
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
      return (
        model,
        profile,
        {
          "output_text": result.output_text,
          "raw_output": result.raw_output,
          "trace": result.trace,
          "usage": result.usage,
        },
      )
    except ProviderRequestError as exc:
      raise ProviderRequestError(self._normalize_case_error(exc.message), status_code=exc.status_code) from exc
    except ToolExecutionError as exc:
      raise ToolExecutionError(self._normalize_case_error(exc.message)) from exc
    except BadRequestError as exc:
      raise BadRequestError(self._normalize_case_error(exc.message)) from exc
    finally:
      await client.close()

  async def stream_profile_response(
    self,
    *,
    model_id: str,
    profile_id: str,
    messages: list[ChatMessage],
    context_documents: list[str] | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    metadata: dict | None = None,
  ) -> AsyncIterator[dict]:
    model = await self.get_registry_model(model_id)
    profile = await self.get_agent_profile(profile_id)

    if model.enabled is False or model.capabilities.get("chat_completions") is False:
      raise BadRequestError(f"Model '{model.name}' is not available for chat responses.")
    if not profile.enabled:
      raise BadRequestError(f"Agent profile '{profile.name}' is disabled.")
    self._ensure_model_supports_profile(model, profile)

    if profile.framework != AgentFramework.CUSTOM:
      raise BadRequestError(
        f"Streaming is currently available only for custom profiles. '{profile.name}' uses '{profile.framework.value}'."
      )
    if profile.strategy_kind == AgentStrategyKind.TOOL:
      raise BadRequestError(
        f"Streaming is not yet available for tool profiles. '{profile.name}' requires multi-step tool execution."
      )

    grounded_response = await self._maybe_build_grounded_response(profile, messages, metadata)
    if grounded_response is not None:
      yield {
        "event": "run.started",
        "data": {
          "model": model.model_dump(mode="json"),
          "profile": profile.model_dump(mode="json"),
          "trace": grounded_response["trace"],
        },
      }
      for delta in self._chunk_text(grounded_response["output_text"]):
        yield {"event": "message.delta", "data": {"delta": delta}}
      yield {
        "event": "run.completed",
        "data": {
          "output_text": grounded_response["output_text"],
          "raw_output": {"grounded": True},
          "trace": grounded_response["trace"],
          "usage": {},
        },
      }
      return

    merged_context_documents = await self._merge_response_context_documents(messages, context_documents)
    case, run = self._build_response_case_and_run(
      model=model,
      profile=profile,
      messages=messages,
      context_documents=merged_context_documents,
      temperature=temperature,
      max_tokens=max_tokens,
      metadata=metadata,
    )
    client = self._build_client_for_model(model)
    context = BenchmarkRunnerContext(
      client=client,
      model=model,
      profile=profile,
      case=case,
      run=run,
      tool_registry=self._tool_registry,
      settings=self._settings,
    )
    payload = build_provider_payload(context)
    trace = [
      {
        "event": "request.built",
        "framework": profile.framework.value,
        "strategy": profile.strategy_kind.value,
        "message_count": len(payload.get("messages") or []),
        "request_preview": build_request_preview(payload),
      }
    ]
    started_at = perf_counter()
    first_token_at: float | None = None
    fragments: list[str] = []

    try:
      yield {
        "event": "run.started",
        "data": {
          "model": model.model_dump(mode="json"),
          "profile": profile.model_dump(mode="json"),
          "trace": trace,
        },
      }
      async for chunk in client.stream_chat_completion_chunks(payload):
        delta = self._extract_stream_delta(chunk)
        if not delta:
          continue
        if first_token_at is None:
          first_token_at = perf_counter()
        fragments.append(delta)
        yield {
          "event": "message.delta",
          "data": {
            "delta": delta,
          },
        }
    except ProviderRequestError as exc:
      yield {
        "event": "run.failed",
        "data": {
          "error": self._normalize_case_error(exc.message),
          "status_code": exc.status_code,
        },
      }
      return
    finally:
      await client.close()

    result = BenchmarkRunnerResult(
      output_text="".join(fragments).strip(),
      raw_output=None,
      trace=trace,
      usage={
        "first_token_ms": int((first_token_at - started_at) * 1000) if first_token_at is not None else None,
      },
    )
    yield {
      "event": "run.completed",
      "data": {
        "model": model.model_dump(mode="json"),
        "profile": profile.model_dump(mode="json"),
        "output_text": result.output_text,
        "raw_output": result.raw_output,
        "trace": result.trace,
        "usage": result.usage,
      },
    }

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
    models = {model.id: model for model in await self._model_registry_repository.list_models()}
    profiles = {profile.id: profile for profile in await self._agent_profile_repository.list_profiles()}

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
    model = await self.get_registry_model(model_id)
    profile = await self.get_agent_profile(agent_profile_id)
    if not model.enabled:
      raise BadRequestError(f"Model '{model_id}' is disabled.")
    if not profile.enabled:
      raise BadRequestError(f"Agent profile '{agent_profile_id}' is disabled.")
    self._ensure_model_supports_profile(model, profile)

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
    model = await self.get_registry_model(run.model_id)
    profile = await self.get_agent_profile(run.agent_profile_id)
    cases = [case for case in await self._benchmark_suite_repository.list_cases(run.suite_id) if case.enabled]
    self._ensure_model_supports_profile(model, profile)

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
    client: OpenAICompatibleClient,
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
        error=self._normalize_case_error(getattr(exc, "message", str(exc))),
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
        error=self._normalize_case_error(f"{exc.__class__.__name__}: {exc}"),
        created_at=now,
        updated_at=datetime.now(UTC),
      )

  def _build_client_for_model(self, model: ModelRegistryRecord) -> OpenAICompatibleClient:
    effective_settings = self._settings.model_copy(
      update={
        "provider_base_url": model.base_url,
        "provider_api_key": model.api_key or self._settings.provider_api_key,
        "default_model": model.served_model_name,
      }
    )
    return OpenAICompatibleClient(effective_settings)

  @staticmethod
  def _ensure_model_supports_profile(model: ModelRegistryRecord, profile: AgentProfileRecord) -> None:
    requires_tool_calling = (
      profile.strategy_kind == AgentStrategyKind.TOOL
      or bool(profile.tool_names)
      or bool(profile.metadata.get("requires_tool_calling"))
    )
    if requires_tool_calling and model.capabilities.get("tool_calling") is not True:
      raise BadRequestError(
        f"Model '{model.name}' is not configured for tool calling. "
        "Enable auto tool calling on the upstream model server or choose a direct/RAG profile."
      )

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
  def _normalize_case_error(message: str) -> str:
    normalized = message.strip()
    if '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set' in normalized:
      return (
        f"{normalized} "
        "Upstream vLLM currently is not configured for auto tool calling; enable those flags on the model server to benchmark tool agents."
      )
    return normalized

  @staticmethod
  def _extract_stream_delta(chunk: dict) -> str:
    choice = (chunk.get("choices") or [{}])[0]
    delta = choice.get("delta") or {}
    content = delta.get("content")
    if isinstance(content, str):
      return content
    if isinstance(content, list):
      parts = [part.get("text", "") for part in content if isinstance(part, dict)]
      return "".join(parts)
    return ""

  @staticmethod
  def _build_response_case_and_run(
    *,
    model: ModelRegistryRecord,
    profile: AgentProfileRecord,
    messages: list[ChatMessage],
    context_documents: list[str] | None,
    temperature: float | None,
    max_tokens: int | None,
    metadata: dict | None,
  ) -> tuple[BenchmarkCaseRecord, BenchmarkRunRecord]:
    now = datetime.now(UTC)
    case = BenchmarkCaseRecord(
      id=f"response-case-{uuid4().hex}",
      suite_id="response-chat",
      name="Response chat turn",
      slug="response-chat-turn",
      input_messages=messages,
      expected_output={},
      rubric={},
      metadata={
        **(metadata or {}),
        "context_documents": [item for item in (context_documents or []) if isinstance(item, str) and item.strip()],
        "response_mode": True,
      },
      enabled=True,
      created_at=now,
      updated_at=now,
    )
    run_params: dict[str, object] = {}
    if temperature is not None:
      run_params["temperature"] = temperature
    if max_tokens is not None:
      run_params["max_tokens"] = max_tokens
    run = BenchmarkRunRecord(
      id=f"response-run-{uuid4().hex}",
      suite_id="response-chat",
      model_id=model.id,
      agent_profile_id=profile.id,
      status=BenchmarkRunStatus.RUNNING,
      params=run_params,
      summary={},
      error=None,
      created_at=now,
      updated_at=now,
      started_at=now,
      finished_at=None,
    )
    return case, run

  async def _merge_response_context_documents(
    self,
    messages: Sequence[ChatMessage],
    context_documents: list[str] | None,
  ) -> list[str]:
    explicit_context = [item for item in (context_documents or []) if isinstance(item, str) and item.strip()]
    try:
      grounded_context = await self._location_grounder.build_context_documents(messages)
    except Exception:
      grounded_context = []
    merged: list[str] = []
    seen: set[str] = set()
    for item in [*explicit_context, *grounded_context]:
      normalized = item.strip()
      if not normalized or normalized in seen:
        continue
      seen.add(normalized)
      merged.append(normalized)
    return merged

  async def _maybe_build_grounded_response(
    self,
    profile: AgentProfileRecord,
    messages: Sequence[ChatMessage],
    metadata: dict | None,
  ) -> dict | None:
    source = str((metadata or {}).get("source") or "")
    if source != "response-page" or profile.strategy_kind != AgentStrategyKind.DIRECT:
      return None
    identity_response = self._maybe_build_identity_response(messages)
    if identity_response is not None:
      return identity_response
    try:
      return await self._location_grounder.maybe_build_grounded_response(messages)
    except Exception:
      return None

  @staticmethod
  def _chunk_text(text: str, size: int = 24) -> list[str]:
    if not text:
      return []
    return [text[index:index + size] for index in range(0, len(text), size)]

  @staticmethod
  def _maybe_build_identity_response(messages: Sequence[ChatMessage]) -> dict | None:
    latest_user_text = next(
      (
        message.content.strip()
        for message in reversed(messages)
        if message.role == "user" and isinstance(message.content, str) and message.content.strip()
      ),
      "",
    )
    if not latest_user_text or not IDENTITY_QUERY_PATTERN.search(latest_user_text):
      return None
    return {
      "output_text": (
        "저는 callLLM에서 동작하는 AI 어시스턴트예요. "
        "질문 정리, 정보 설명, 비교, 초안 작성 같은 작업을 도와드릴 수 있어요."
      ),
      "trace": [{"event": "grounded.identity_response"}],
      "raw_output": {"grounded": True},
      "usage": {},
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
