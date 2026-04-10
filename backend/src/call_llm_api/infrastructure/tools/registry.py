import json
from typing import Iterable

from call_llm_api.domain.errors import ToolExecutionError
from call_llm_api.domain.models import ToolCall, ToolDefinition, ToolExecutionResult
from call_llm_api.infrastructure.tools.base import ToolHandler
from call_llm_api.infrastructure.tools.builtin import EchoTextTool, GetCurrentTimeTool


class ToolRegistry:
  def __init__(self, tools: Iterable[ToolHandler]) -> None:
    self._tools = {tool.name: tool for tool in tools}

  def list_definitions(self, tool_names: list[str] | None = None) -> list[ToolDefinition]:
    tools = self._resolve_tools(tool_names)
    return [tool.to_definition() for tool in tools]

  def as_provider_tools(self, tool_names: list[str] | None = None) -> list[dict]:
    return [
      {
        "type": "function",
        "function": {
          "name": definition.name,
          "description": definition.description,
          "parameters": definition.input_schema,
        },
      }
      for definition in self.list_definitions(tool_names)
    ]

  async def execute_tool_call(self, tool_call: ToolCall) -> ToolExecutionResult:
    handler = self._tools.get(tool_call.function.name)
    if handler is None:
      raise ToolExecutionError(f"Tool '{tool_call.function.name}' is not registered.")

    try:
      arguments = json.loads(tool_call.function.arguments or "{}")
    except json.JSONDecodeError as exc:
      raise ToolExecutionError(
        f"Tool '{tool_call.function.name}' received invalid JSON arguments."
      ) from exc

    result = await handler.execute(arguments)
    output = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
    return ToolExecutionResult(
      name=handler.name,
      tool_call_id=tool_call.id,
      output=output,
    )

  def _resolve_tools(self, tool_names: list[str] | None) -> list[ToolHandler]:
    if tool_names is None:
      return list(self._tools.values())

    if len(tool_names) == 0:
      return []

    resolved: list[ToolHandler] = []
    for tool_name in tool_names:
      handler = self._tools.get(tool_name)
      if handler is None:
        raise ToolExecutionError(f"Tool '{tool_name}' is not registered.")
      resolved.append(handler)
    return resolved


def build_builtin_tool_registry() -> ToolRegistry:
  return ToolRegistry([EchoTextTool(), GetCurrentTimeTool()])
