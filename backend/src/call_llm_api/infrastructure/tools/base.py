from typing import Any, Protocol

from call_llm_api.domain.models import ToolDefinition


class ToolHandler(Protocol):
  name: str
  description: str
  input_schema: dict[str, Any]

  async def execute(self, arguments: dict[str, Any]) -> str | dict[str, Any]: ...

  def to_definition(self) -> ToolDefinition: ...
