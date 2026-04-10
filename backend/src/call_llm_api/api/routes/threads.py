import json
from collections.abc import AsyncIterator
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from call_llm_api.api.deps import get_agent_service, get_container
from call_llm_api.application.services.agent_service import AgentService
from call_llm_api.core.container import AppContainer
from call_llm_api.domain.errors import BadRequestError
from call_llm_api.domain.models import ChatMessage, RunRecord, ThreadRecord

router = APIRouter(tags=["threads"])


class ThreadCreateRequest(BaseModel):
  title: str | None = None
  metadata: dict[str, Any] = Field(default_factory=dict)
  messages: list[ChatMessage] = Field(default_factory=list)


class ThreadMessageCreateRequest(BaseModel):
  role: Literal["user", "assistant", "tool", "system"] = "user"
  content: str
  metadata: dict[str, Any] = Field(default_factory=dict)


class ThreadRunCreateRequest(BaseModel):
  user_message: str | None = None
  model: str | None = None
  system_prompt: str | None = None
  tools: list[str] = Field(default_factory=list)
  max_steps: int | None = None
  execution_mode: Literal["sync", "async"] = "sync"
  metadata: dict[str, Any] = Field(default_factory=dict)


class ThreadRunResponse(BaseModel):
  run: RunRecord
  thread: ThreadRecord


def _format_sse(event: str, data: dict[str, Any]) -> str:
  return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/threads", response_model=ThreadRecord)
async def create_thread(
  payload: ThreadCreateRequest,
  service: AgentService = Depends(get_agent_service),
) -> ThreadRecord:
  return await service.create_thread(
    title=payload.title,
    metadata=payload.metadata,
    messages=payload.messages,
  )


@router.get("/threads", response_model=list[ThreadRecord])
async def list_threads(service: AgentService = Depends(get_agent_service)) -> list[ThreadRecord]:
  return await service.list_threads()


@router.get("/threads/{thread_id}", response_model=ThreadRecord)
async def get_thread(thread_id: str, service: AgentService = Depends(get_agent_service)) -> ThreadRecord:
  return await service.get_thread(thread_id)


@router.post("/threads/{thread_id}/messages", response_model=ThreadRecord)
async def append_message(
  thread_id: str,
  payload: ThreadMessageCreateRequest,
  service: AgentService = Depends(get_agent_service),
) -> ThreadRecord:
  return await service.append_message(
    thread_id,
    ChatMessage(role=payload.role, content=payload.content, metadata=payload.metadata),
  )


@router.post("/threads/{thread_id}/runs", response_model=ThreadRunResponse)
async def create_thread_run(
  thread_id: str,
  payload: ThreadRunCreateRequest,
  service: AgentService = Depends(get_agent_service),
  container: AppContainer = Depends(get_container),
) -> ThreadRunResponse:
  if payload.execution_mode == "async":
    if container.task_queue is None:
      run = await service.create_background_thread_run(
        thread_id=thread_id,
        user_message=payload.user_message,
        model=payload.model,
        system_prompt=payload.system_prompt,
        metadata=payload.metadata,
        tool_names=payload.tools,
        max_steps=payload.max_steps,
      )
    else:
      thread, run = await service.prepare_thread_run(
        thread_id=thread_id,
        user_message=payload.user_message,
        model=payload.model,
        system_prompt=payload.system_prompt,
        metadata=payload.metadata,
      )
      job_id = await container.task_queue.enqueue_thread_run(
        service.build_queue_payload(
          run_id=run.id,
          tool_names=payload.tools,
          max_steps=payload.max_steps,
        )
      )
      run = await container.run_repository.save(
        run.model_copy(update={"job_id": job_id})
      )
      return ThreadRunResponse(run=run, thread=thread)

    thread = await service.get_thread(thread_id)
    return ThreadRunResponse(run=run, thread=thread)

  run = await service.create_thread_run(
    thread_id=thread_id,
    user_message=payload.user_message,
    model=payload.model,
    system_prompt=payload.system_prompt,
    metadata=payload.metadata,
    tool_names=payload.tools,
    max_steps=payload.max_steps,
  )
  thread = await service.get_thread(thread_id)
  return ThreadRunResponse(run=run, thread=thread)


@router.post("/threads/{thread_id}/runs/stream", response_model=None)
async def stream_thread_run(
  thread_id: str,
  payload: ThreadRunCreateRequest,
  service: AgentService = Depends(get_agent_service),
) -> StreamingResponse:
  if payload.tools:
    raise BadRequestError(
      "Streaming thread runs currently do not support tool calls. Use POST /api/v1/threads/{thread_id}/runs instead."
    )

  async def event_stream() -> AsyncIterator[str]:
    async for event in service.stream_thread_run(
      thread_id=thread_id,
      user_message=payload.user_message,
      model=payload.model,
      system_prompt=payload.system_prompt,
      metadata=payload.metadata,
    ):
      yield _format_sse(event["event"], event["data"])

  return StreamingResponse(event_stream(), media_type="text/event-stream")
