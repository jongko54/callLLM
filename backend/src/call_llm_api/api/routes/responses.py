import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from call_llm_api.api.deps import get_response_service
from call_llm_api.application.services.response_service import ResponseService
from call_llm_api.domain.models import ChatMessage, RunRecord

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
