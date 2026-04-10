from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from call_llm_api.api.deps import get_container
from call_llm_api.core.container import AppContainer
from call_llm_api.domain.models import ChatMessage

router = APIRouter(tags=["chat"])


class ChatCompletionRequest(BaseModel):
  model_config = ConfigDict(extra="allow")

  messages: list[ChatMessage]
  model: str | None = None
  temperature: float | None = 0.7
  max_tokens: int | None = 600
  stream: bool = False
  chat_template_kwargs: dict[str, Any] | None = None
  metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/chat/completions", response_model=None)
async def create_chat_completion(
  payload: ChatCompletionRequest,
  container: AppContainer = Depends(get_container),
) -> dict | StreamingResponse:
  body = payload.model_dump(mode="json", exclude_none=True)
  body["model"] = body.get("model") or container.settings.default_model

  if payload.stream:
    return StreamingResponse(
      container.llm_client.forward_chat_completion_stream(body),
      media_type="text/event-stream",
    )

  return await container.llm_client.create_chat_completion(body)
