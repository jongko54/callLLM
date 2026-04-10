from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime
from uuid import uuid4

from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import ProviderRequestError
from call_llm_api.domain.models import ChatMessage, RunKind, RunRecord, RunStatus
from call_llm_api.infrastructure.llm.base import LLMProvider
from call_llm_api.infrastructure.persistence.base import RunRepository


class ResponseService:
  def __init__(
    self,
    *,
    llm_client: LLMProvider,
    run_repository: RunRepository,
    settings: Settings,
  ) -> None:
    self._llm_client = llm_client
    self._run_repository = run_repository
    self._settings = settings

  async def create_response(
    self,
    *,
    messages: Sequence[ChatMessage],
    model: str | None,
    system_prompt: str | None,
    temperature: float,
    max_tokens: int | None,
    metadata: dict,
  ) -> tuple[RunRecord, str]:
    run = await self._create_run(
      messages=messages,
      model=model,
      metadata=metadata,
      system_prompt=system_prompt,
    )
    payload = self._build_payload(
      messages=messages,
      model=model,
      system_prompt=system_prompt,
      temperature=temperature,
      max_tokens=max_tokens,
    )

    try:
      raw_response = await self._llm_client.create_chat_completion(payload)
      output_text = self._extract_text(raw_response)
      completed_run = await self._run_repository.save(
        run.model_copy(
          update={
            "status": RunStatus.COMPLETED,
            "output_text": output_text,
            "raw_response": raw_response,
            "updated_at": datetime.now(UTC),
          }
        )
      )
      return completed_run, output_text
    except ProviderRequestError as exc:
      failed_run = await self._run_repository.save(
        run.model_copy(
          update={
            "status": RunStatus.FAILED,
            "error": exc.message,
            "updated_at": datetime.now(UTC),
          }
        )
      )
      raise exc from None

  async def stream_response(
    self,
    *,
    messages: Sequence[ChatMessage],
    model: str | None,
    system_prompt: str | None,
    temperature: float,
    max_tokens: int | None,
    metadata: dict,
  ) -> AsyncIterator[dict]:
    run = await self._create_run(
      messages=messages,
      model=model,
      metadata=metadata,
      system_prompt=system_prompt,
    )
    yield {
      "event": "run.started",
      "data": {"run_id": run.id, "model": run.model, "status": run.status},
    }

    payload = self._build_payload(
      messages=messages,
      model=model,
      system_prompt=system_prompt,
      temperature=temperature,
      max_tokens=max_tokens,
    )

    fragments: list[str] = []
    try:
      async for chunk in self._llm_client.stream_chat_completion_chunks(payload):
        delta = self._extract_delta(chunk)
        if not delta:
          continue
        fragments.append(delta)
        yield {
          "event": "message.delta",
          "data": {"run_id": run.id, "delta": delta},
        }
    except ProviderRequestError as exc:
      failed_run = await self._run_repository.save(
        run.model_copy(
          update={
            "status": RunStatus.FAILED,
            "error": exc.message,
            "updated_at": datetime.now(UTC),
          }
        )
      )
      yield {
        "event": "run.failed",
        "data": {
          "run_id": failed_run.id,
          "status": failed_run.status,
          "error": failed_run.error,
        },
      }
      return

    output_text = "".join(fragments).strip()
    completed_run = await self._run_repository.save(
      run.model_copy(
        update={
          "status": RunStatus.COMPLETED,
          "output_text": output_text,
          "updated_at": datetime.now(UTC),
        }
      )
    )
    yield {
      "event": "run.completed",
      "data": {
        "run_id": completed_run.id,
        "status": completed_run.status,
        "output_text": completed_run.output_text,
      },
    }

  async def _create_run(
    self,
    *,
    messages: Sequence[ChatMessage],
    model: str | None,
    metadata: dict,
    system_prompt: str | None,
  ) -> RunRecord:
    now = datetime.now(UTC)
    initial_messages = list(messages)
    if system_prompt:
      initial_messages = [ChatMessage(role="system", content=system_prompt), *initial_messages]

    run = RunRecord(
      id=uuid4().hex,
      kind=RunKind.RESPONSE,
      status=RunStatus.RUNNING,
      provider="openai-compatible",
      model=model or self._settings.default_model,
      messages=initial_messages,
      metadata=metadata,
      created_at=now,
      updated_at=now,
    )
    return await self._run_repository.save(run)

  def _build_payload(
    self,
    *,
    messages: Sequence[ChatMessage],
    model: str | None,
    system_prompt: str | None,
    temperature: float,
    max_tokens: int | None,
  ) -> dict:
    provider_messages = [message.to_provider_dict() for message in messages]
    if system_prompt:
      provider_messages = [
        {"role": "system", "content": system_prompt},
        *provider_messages,
      ]

    payload = {
      "model": model or self._settings.default_model,
      "messages": provider_messages,
      "temperature": temperature,
    }
    if max_tokens is not None:
      payload["max_tokens"] = max_tokens
    return payload

  @staticmethod
  def _extract_text(raw_response: dict) -> str:
    choice = (raw_response.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
      return content.strip()
    if isinstance(content, list):
      parts = [part.get("text", "") for part in content if isinstance(part, dict)]
      return "".join(parts).strip()
    return ""

  @staticmethod
  def _extract_delta(chunk: dict) -> str:
    choice = (chunk.get("choices") or [{}])[0]
    delta = choice.get("delta") or {}
    content = delta.get("content")
    if isinstance(content, str):
      return content
    if isinstance(content, list):
      parts = [part.get("text", "") for part in content if isinstance(part, dict)]
      return "".join(parts)
    return ""
