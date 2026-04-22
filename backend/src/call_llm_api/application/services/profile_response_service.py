import re
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from call_llm_api.application.benchmark_runners import (
  BenchmarkRunnerContext,
  BenchmarkRunnerRegistry,
  BenchmarkRunnerResult,
  build_default_benchmark_runner_registry,
  build_provider_payload,
  build_request_preview,
)
from call_llm_api.application.services.agent_profile_service import AgentProfileService
from call_llm_api.application.services.model_client_factory import (
  ModelClientFactory,
  build_openai_compatible_client_for_model,
)
from call_llm_api.application.services.model_registry_service import ModelRegistryService
from call_llm_api.application.services.provider_errors import normalize_provider_case_error
from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import BadRequestError, ProviderRequestError, ToolExecutionError
from call_llm_api.domain.models import (
  AgentFramework,
  AgentProfileRecord,
  AgentStrategyKind,
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
  BenchmarkRunStatus,
  ChatMessage,
  ModelRegistryRecord,
)
from call_llm_api.infrastructure.grounding import LocationGrounder
from call_llm_api.infrastructure.llm.base import LLMProvider
from call_llm_api.infrastructure.tools.registry import ToolRegistry

IDENTITY_QUERY_PATTERN = re.compile(r"(너는\s*누구|누구야|정체가\s*뭐|뭐하는\s*애|what are you|who are you)", re.IGNORECASE)
RESPONSE_GROUNDING_MODES = {"raw", "auto", "grounded"}


class ProfileResponseService:
  def __init__(
    self,
    *,
    model_registry_service: ModelRegistryService,
    agent_profile_service: AgentProfileService,
    tool_registry: ToolRegistry,
    settings: Settings,
    location_grounder: LocationGrounder,
    runner_registry: BenchmarkRunnerRegistry | None = None,
    client_factory: ModelClientFactory | None = None,
  ) -> None:
    self._model_registry_service = model_registry_service
    self._agent_profile_service = agent_profile_service
    self._tool_registry = tool_registry
    self._settings = settings
    self._runner_registry = runner_registry or build_default_benchmark_runner_registry()
    self._location_grounder = location_grounder
    self._client_factory = client_factory

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
    model = await self._model_registry_service.get_registry_model(model_id)
    profile = await self._agent_profile_service.get_agent_profile(profile_id)

    self._validate_profile_response(model, profile)

    grounding_mode = self._resolve_response_grounding_mode(metadata)
    grounded_response = await self._maybe_build_grounded_response(profile, messages, metadata, grounding_mode)
    if grounded_response is not None:
      grounded_response.setdefault("raw_output", {"grounded": True})
      grounded_response.setdefault("usage", {})
      return model, profile, grounded_response

    merged_context_documents = await self._merge_response_context_documents(messages, context_documents, grounding_mode)
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
      raise ProviderRequestError(normalize_provider_case_error(exc.message), status_code=exc.status_code) from exc
    except ToolExecutionError as exc:
      raise ToolExecutionError(normalize_provider_case_error(exc.message)) from exc
    except BadRequestError as exc:
      raise BadRequestError(normalize_provider_case_error(exc.message)) from exc
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
    model = await self._model_registry_service.get_registry_model(model_id)
    profile = await self._agent_profile_service.get_agent_profile(profile_id)

    self._validate_profile_response(model, profile)

    if profile.framework != AgentFramework.CUSTOM:
      raise BadRequestError(
        f"Streaming is currently available only for custom profiles. '{profile.name}' uses '{profile.framework.value}'."
      )
    if profile.strategy_kind == AgentStrategyKind.TOOL:
      raise BadRequestError(
        f"Streaming is not yet available for tool profiles. '{profile.name}' requires multi-step tool execution."
      )

    grounding_mode = self._resolve_response_grounding_mode(metadata)
    grounded_response = await self._maybe_build_grounded_response(profile, messages, metadata, grounding_mode)
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

    merged_context_documents = await self._merge_response_context_documents(messages, context_documents, grounding_mode)
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
          "error": normalize_provider_case_error(exc.message),
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

  def _validate_profile_response(self, model: ModelRegistryRecord, profile: AgentProfileRecord) -> None:
    if model.enabled is False or model.capabilities.get("chat_completions") is False:
      raise BadRequestError(f"Model '{model.name}' is not available for chat responses.")
    if not profile.enabled:
      raise BadRequestError(f"Agent profile '{profile.name}' is disabled.")
    self._agent_profile_service.ensure_model_supports_profile(model, profile)

  def _build_client_for_model(self, model: ModelRegistryRecord) -> LLMProvider:
    if self._client_factory is not None:
      return self._client_factory(model)
    return build_openai_compatible_client_for_model(model=model, settings=self._settings)

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
    grounding_mode: str,
  ) -> list[str]:
    explicit_context = [item for item in (context_documents or []) if isinstance(item, str) and item.strip()]
    if grounding_mode == "raw":
      return explicit_context
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
    grounding_mode: str,
  ) -> dict | None:
    source = str((metadata or {}).get("source") or "")
    if source != "response-page" or profile.strategy_kind != AgentStrategyKind.DIRECT or grounding_mode == "raw":
      return None
    identity_response = self._maybe_build_identity_response(messages)
    if identity_response is not None:
      return identity_response
    try:
      return await self._location_grounder.maybe_build_grounded_response(messages)
    except Exception:
      return None

  @staticmethod
  def _resolve_response_grounding_mode(metadata: dict | None) -> str:
    mode = str((metadata or {}).get("grounding_mode") or "auto").strip().lower()
    return mode if mode in RESPONSE_GROUNDING_MODES else "auto"

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
