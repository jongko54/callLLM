import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import uuid4

from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import BadRequestError, NotFoundError, ProviderRequestError, ToolExecutionError
from call_llm_api.domain.models import (
  ChatMessage,
  RunKind,
  RunRecord,
  RunStatus,
  ThreadRecord,
  tool_result_to_message,
)
from call_llm_api.infrastructure.llm.base import LLMProvider
from call_llm_api.infrastructure.persistence.base import RunRepository, ThreadRepository
from call_llm_api.infrastructure.tools.registry import ToolRegistry


class AgentService:
  def __init__(
    self,
    *,
    llm_client: LLMProvider,
    run_repository: RunRepository,
    thread_repository: ThreadRepository,
    tool_registry: ToolRegistry,
    settings: Settings,
  ) -> None:
    self._llm_client = llm_client
    self._run_repository = run_repository
    self._thread_repository = thread_repository
    self._tool_registry = tool_registry
    self._settings = settings

  async def create_thread(
    self,
    *,
    title: str | None = None,
    metadata: dict | None = None,
    messages: list[ChatMessage] | None = None,
  ) -> ThreadRecord:
    now = datetime.now(UTC)
    thread = ThreadRecord(
      id=uuid4().hex,
      title=title,
      metadata=metadata or {},
      messages=messages or [],
      created_at=now,
      updated_at=now,
    )
    return await self._thread_repository.save(thread)

  async def list_threads(self) -> list[ThreadRecord]:
    return await self._thread_repository.list_threads()

  async def get_thread(self, thread_id: str) -> ThreadRecord:
    thread = await self._thread_repository.get(thread_id)
    if thread is None:
      raise NotFoundError(f"Thread '{thread_id}' was not found.")
    return thread

  async def append_message(self, thread_id: str, message: ChatMessage) -> ThreadRecord:
    thread = await self.get_thread(thread_id)
    updated_thread = thread.model_copy(
      update={
        "messages": [*thread.messages, message],
        "updated_at": datetime.now(UTC),
      }
    )
    return await self._thread_repository.save(updated_thread)

  async def prepare_thread_run(
    self,
    *,
    thread_id: str,
    user_message: str | None,
    model: str | None,
    system_prompt: str | None,
    metadata: dict | None,
  ) -> tuple[ThreadRecord, RunRecord]:
    thread = await self.get_thread(thread_id)
    if user_message:
      thread = await self.append_message(thread_id, ChatMessage(role="user", content=user_message))

    now = datetime.now(UTC)
    run = RunRecord(
      id=uuid4().hex,
      kind=RunKind.THREAD_RUN,
      status=RunStatus.QUEUED,
      provider="openai-compatible",
      model=model or self._settings.default_model,
      thread_id=thread.id,
      messages=thread.messages,
      metadata={
        **(metadata or {}),
        "system_prompt": system_prompt or "",
      },
      created_at=now,
      updated_at=now,
    )
    saved_run = await self._run_repository.save(run)
    return thread, saved_run

  async def execute_thread_run(
    self,
    *,
    run_id: str,
    tool_names: list[str] | None,
    max_steps: int | None,
  ) -> RunRecord:
    run = await self._run_repository.get(run_id)
    if run is None:
      raise NotFoundError(f"Run '{run_id}' was not found.")
    if not run.thread_id:
      raise BadRequestError("Thread run is missing thread context.")

    thread = await self.get_thread(run.thread_id)
    run = await self._run_repository.save(
      run.model_copy(update={"status": RunStatus.RUNNING, "updated_at": datetime.now(UTC)})
    )

    events = list(run.events)
    system_prompt = str(run.metadata.get("system_prompt") or "").strip() or None
    steps = max_steps or self._settings.agent_max_steps

    try:
      for step_index in range(steps):
        payload = self._build_agent_payload(
          thread=thread,
          model=run.model,
          system_prompt=system_prompt,
          tool_names=tool_names,
        )
        raw_response = await self._llm_client.create_chat_completion(payload)
        assistant_message = ChatMessage.from_provider_message(
          ((raw_response.get("choices") or [{}])[0].get("message") or {})
        )

        thread = await self._thread_repository.save(
          thread.model_copy(
            update={
              "messages": [*thread.messages, assistant_message],
              "updated_at": datetime.now(UTC),
            }
          )
        )
        events.append(
          {
            "event": "assistant.message",
            "step": step_index,
            "content": assistant_message.content,
            "tool_calls": [tool_call.model_dump(mode="json") for tool_call in assistant_message.tool_calls],
          }
        )

        if not assistant_message.tool_calls:
          return await self._run_repository.save(
            run.model_copy(
              update={
                "status": RunStatus.COMPLETED,
                "messages": thread.messages,
                "output_text": assistant_message.content or "",
                "raw_response": raw_response,
                "events": events,
                "updated_at": datetime.now(UTC),
              }
            )
          )

        for tool_call in assistant_message.tool_calls:
          tool_result = await self._tool_registry.execute_tool_call(tool_call)
          tool_message = tool_result_to_message(tool_result)
          thread = await self._thread_repository.save(
            thread.model_copy(
              update={
                "messages": [*thread.messages, tool_message],
                "updated_at": datetime.now(UTC),
              }
            )
          )
          events.append(
            {
              "event": "tool.completed",
              "step": step_index,
              "tool_name": tool_result.name,
              "tool_call_id": tool_result.tool_call_id,
              "output": tool_result.output,
            }
          )

      return await self._run_repository.save(
        run.model_copy(
          update={
            "status": RunStatus.FAILED,
            "messages": thread.messages,
            "error": f"Agent reached max steps ({steps}) without completing.",
            "events": events,
            "updated_at": datetime.now(UTC),
          }
        )
      )
    except (ProviderRequestError, ToolExecutionError, BadRequestError) as exc:
      return await self._run_repository.save(
        run.model_copy(
          update={
            "status": RunStatus.FAILED,
            "messages": thread.messages,
            "error": getattr(exc, "message", str(exc)),
            "events": events,
            "updated_at": datetime.now(UTC),
          }
        )
      )

  async def create_thread_run(
    self,
    *,
    thread_id: str,
    user_message: str | None,
    model: str | None,
    system_prompt: str | None,
    metadata: dict | None,
    tool_names: list[str] | None,
    max_steps: int | None,
  ) -> RunRecord:
    _, run = await self.prepare_thread_run(
      thread_id=thread_id,
      user_message=user_message,
      model=model,
      system_prompt=system_prompt,
      metadata=metadata,
    )
    return await self.execute_thread_run(run_id=run.id, tool_names=tool_names, max_steps=max_steps)

  async def stream_thread_run(
    self,
    *,
    thread_id: str,
    user_message: str | None,
    model: str | None,
    system_prompt: str | None,
    metadata: dict | None,
  ) -> AsyncIterator[dict]:
    thread, run = await self.prepare_thread_run(
      thread_id=thread_id,
      user_message=user_message,
      model=model,
      system_prompt=system_prompt,
      metadata=metadata,
    )

    run = await self._run_repository.save(
      run.model_copy(update={"status": RunStatus.RUNNING, "updated_at": datetime.now(UTC)})
    )

    yield {
      "event": "run.started",
      "data": {
        "run_id": run.id,
        "thread_id": thread.id,
        "status": run.status,
      },
    }

    payload = self._build_agent_payload(
      thread=thread,
      model=run.model,
      system_prompt=system_prompt,
      tool_names=[],
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
          "data": {
            "run_id": run.id,
            "thread_id": thread.id,
            "delta": delta,
          },
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
          "thread_id": thread.id,
          "status": failed_run.status,
          "error": failed_run.error,
        },
      }
      return

    output_text = "".join(fragments).strip()
    assistant_message = ChatMessage(role="assistant", content=output_text)
    thread = await self._thread_repository.save(
      thread.model_copy(
        update={
          "messages": [*thread.messages, assistant_message],
          "updated_at": datetime.now(UTC),
        }
      )
    )
    completed_run = await self._run_repository.save(
      run.model_copy(
        update={
          "status": RunStatus.COMPLETED,
          "messages": thread.messages,
          "output_text": output_text,
          "updated_at": datetime.now(UTC),
        }
      )
    )
    yield {
      "event": "run.completed",
      "data": {
        "run_id": completed_run.id,
        "thread_id": thread.id,
        "status": completed_run.status,
        "output_text": completed_run.output_text,
      },
    }

  async def create_background_thread_run(
    self,
    *,
    thread_id: str,
    user_message: str | None,
    model: str | None,
    system_prompt: str | None,
    metadata: dict | None,
    tool_names: list[str] | None,
    max_steps: int | None,
    job_id: str | None = None,
  ) -> RunRecord:
    _, run = await self.prepare_thread_run(
      thread_id=thread_id,
      user_message=user_message,
      model=model,
      system_prompt=system_prompt,
      metadata=metadata,
    )

    if job_id:
      run = await self._run_repository.save(
        run.model_copy(update={"job_id": job_id, "updated_at": datetime.now(UTC)})
      )

    asyncio.create_task(self.execute_thread_run(run_id=run.id, tool_names=tool_names, max_steps=max_steps))
    return run

  def build_queue_payload(
    self,
    *,
    run_id: str,
    tool_names: list[str] | None,
    max_steps: int | None,
  ) -> dict:
    return {
      "run_id": run_id,
      "tool_names": tool_names or [],
      "max_steps": max_steps,
    }

  def _build_agent_payload(
    self,
    *,
    thread: ThreadRecord,
    model: str,
    system_prompt: str | None,
    tool_names: list[str] | None,
  ) -> dict:
    messages: list[dict] = []
    if system_prompt:
      messages.append(ChatMessage(role="system", content=system_prompt).to_provider_dict())
    messages.extend(message.to_provider_dict() for message in thread.messages)

    payload = {
      "model": model,
      "messages": messages,
      "temperature": 0.7,
    }
    provider_tools = self._tool_registry.as_provider_tools(tool_names)
    if provider_tools:
      payload["tools"] = provider_tools
      payload["tool_choice"] = "auto"
    return payload

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
