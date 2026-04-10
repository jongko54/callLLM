from datetime import UTC, datetime
from typing import Any

from call_llm_api.domain.models import ToolDefinition


class EchoTextTool:
  name = "echo_text"
  description = "Echo back text. Useful for tool-calling integration tests."
  input_schema = {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "description": "The text to echo back.",
      }
    },
    "required": ["text"],
    "additionalProperties": False,
  }

  async def execute(self, arguments: dict[str, Any]) -> dict[str, str]:
    return {"echo": str(arguments.get("text", ""))}

  def to_definition(self) -> ToolDefinition:
    return ToolDefinition(
      name=self.name,
      description=self.description,
      input_schema=self.input_schema,
    )


class GetCurrentTimeTool:
  name = "get_current_time"
  description = "Return the current UTC time in ISO 8601 format."
  input_schema = {
    "type": "object",
    "properties": {},
    "additionalProperties": False,
  }

  async def execute(self, arguments: dict[str, Any]) -> dict[str, str]:
    _ = arguments
    return {"utc_now": datetime.now(UTC).isoformat()}

  def to_definition(self) -> ToolDefinition:
    return ToolDefinition(
      name=self.name,
      description=self.description,
      input_schema=self.input_schema,
    )
