import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from call_llm_api.api.deps import get_profile_response_service, get_response_service
from call_llm_api.application.services.profile_response_service import ProfileResponseService
from call_llm_api.application.services.response_service import ResponseService
from call_llm_api.domain.errors import BadRequestError, ProviderRequestError
from call_llm_api.domain.models import AgentProfileRecord, ChatMessage, ModelRegistryRecord, RunRecord

router = APIRouter(tags=["responses"])


class ResponseCreateRequest(BaseModel):
  messages: list[ChatMessage]
  model: str | None = None
  system_prompt: str | None = None
  temperature: float = 0.7
  max_tokens: int | None = 600
  stream: bool = False
  metadata: dict[str, Any] = Field(default_factory=dict)


class ResponseCreateResponse(BaseModel):
  id: str
  run: RunRecord
  output_text: str


class ProfileResponseCreateRequest(BaseModel):
  messages: list[ChatMessage]
  model_id: str
  profile_id: str
  context_documents: list[str] = Field(default_factory=list)
  temperature: float | None = None
  max_tokens: int | None = None
  metadata: dict[str, Any] = Field(default_factory=dict)


class ProfileResponseCreateResponse(BaseModel):
  model: ModelRegistryRecord
  profile: AgentProfileRecord
  output_text: str
  raw_output: dict[str, Any] | None = None
  trace: list[dict[str, Any]] = Field(default_factory=list)
  usage: dict[str, Any] = Field(default_factory=dict)


def _format_sse(event: str, data: dict[str, Any]) -> str:
  return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/responses", response_model=None)
async def create_response(
  payload: ResponseCreateRequest,
  service: ResponseService = Depends(get_response_service),
) -> ResponseCreateResponse | StreamingResponse:
  if payload.stream:
    async def event_stream() -> AsyncIterator[str]:
      async for event in service.stream_response(
        messages=payload.messages,
        model=payload.model,
        system_prompt=payload.system_prompt,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        metadata=payload.metadata,
      ):
        yield _format_sse(event["event"], event["data"])

    return StreamingResponse(event_stream(), media_type="text/event-stream")

  run, output_text = await service.create_response(
    messages=payload.messages,
    model=payload.model,
    system_prompt=payload.system_prompt,
    temperature=payload.temperature,
    max_tokens=payload.max_tokens,
    metadata=payload.metadata,
  )
  return ResponseCreateResponse(id=f"resp_{run.id}", run=run, output_text=output_text)


@router.post("/profile-responses", response_model=ProfileResponseCreateResponse)
async def create_profile_response(
  payload: ProfileResponseCreateRequest,
  service: ProfileResponseService = Depends(get_profile_response_service),
) -> ProfileResponseCreateResponse:
  model, profile, result = await service.execute_profile_response(
    model_id=payload.model_id,
    profile_id=payload.profile_id,
    messages=payload.messages,
    context_documents=payload.context_documents,
    temperature=payload.temperature,
    max_tokens=payload.max_tokens,
    metadata=payload.metadata,
  )
  return ProfileResponseCreateResponse(
    model=model,
    profile=profile,
    output_text=result["output_text"],
    raw_output=result["raw_output"],
    trace=result["trace"],
    usage=result["usage"],
  )


@router.post("/profile-responses/stream", response_model=None)
async def stream_profile_response(
  payload: ProfileResponseCreateRequest,
  service: ProfileResponseService = Depends(get_profile_response_service),
) -> StreamingResponse:
  async def event_stream() -> AsyncIterator[str]:
    try:
      async for event in service.stream_profile_response(
        model_id=payload.model_id,
        profile_id=payload.profile_id,
        messages=payload.messages,
        context_documents=payload.context_documents,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        metadata=payload.metadata,
      ):
        yield _format_sse(event["event"], event["data"])
    except (BadRequestError, ProviderRequestError) as exc:
      yield _format_sse("run.failed", {"error": exc.message})

  return StreamingResponse(event_stream(), media_type="text/event-stream")
