import json
from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


MessageRole = Literal["system", "user", "assistant", "tool"]


class ToolFunctionCall(BaseModel):
  name: str
  arguments: str = "{}"


class ToolCall(BaseModel):
  id: str
  type: Literal["function"] = "function"
  function: ToolFunctionCall

  def to_provider_dict(self) -> dict[str, Any]:
    return {
      "id": self.id,
      "type": self.type,
      "function": self.function.model_dump(mode="json"),
    }


class ChatMessage(BaseModel):
  role: MessageRole
  content: str | None = None
  name: str | None = None
  tool_call_id: str | None = None
  tool_calls: list[ToolCall] = Field(default_factory=list)
  metadata: dict[str, Any] = Field(default_factory=dict)

  def to_provider_dict(self) -> dict[str, Any]:
    payload: dict[str, Any] = {"role": self.role}
    if self.content is not None:
      payload["content"] = self.content
    if self.name:
      payload["name"] = self.name
    if self.tool_call_id:
      payload["tool_call_id"] = self.tool_call_id
    if self.tool_calls:
      payload["tool_calls"] = [tool_call.to_provider_dict() for tool_call in self.tool_calls]
    return payload

  @classmethod
  def from_provider_message(cls, payload: dict[str, Any]) -> "ChatMessage":
    tool_calls = [
      ToolCall.model_validate(tool_call)
      for tool_call in payload.get("tool_calls") or []
      if isinstance(tool_call, dict)
    ]
    return cls(
      role=payload.get("role", "assistant"),
      content=payload.get("content"),
      name=payload.get("name"),
      tool_call_id=payload.get("tool_call_id"),
      tool_calls=tool_calls,
    )


class RunStatus(str, Enum):
  QUEUED = "queued"
  RUNNING = "running"
  COMPLETED = "completed"
  FAILED = "failed"


class RunKind(str, Enum):
  RESPONSE = "response"
  THREAD_RUN = "thread_run"


class ToolDefinition(BaseModel):
  name: str
  description: str
  input_schema: dict[str, Any]


class ToolExecutionResult(BaseModel):
  name: str
  tool_call_id: str
  output: str
  is_error: bool = False


class ThreadRecord(BaseModel):
  id: str
  title: str | None = None
  messages: list[ChatMessage] = Field(default_factory=list)
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: datetime
  updated_at: datetime


class RunRecord(BaseModel):
  id: str
  kind: RunKind = RunKind.RESPONSE
  status: RunStatus
  provider: str
  model: str
  thread_id: str | None = None
  job_id: str | None = None
  messages: list[ChatMessage] = Field(default_factory=list)
  output_text: str | None = None
  raw_response: dict[str, Any] | None = None
  error: str | None = None
  events: list[dict[str, Any]] = Field(default_factory=list)
  metadata: dict[str, Any] = Field(default_factory=dict)
  created_at: datetime
  updated_at: datetime


def tool_result_to_message(result: ToolExecutionResult) -> ChatMessage:
  return ChatMessage(
    role="tool",
    name=result.name,
    tool_call_id=result.tool_call_id,
    content=result.output if isinstance(result.output, str) else json.dumps(result.output, ensure_ascii=False),
  )
