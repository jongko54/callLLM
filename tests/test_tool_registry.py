from call_llm_api.infrastructure.tools.registry import build_builtin_tool_registry


def test_as_provider_tools_returns_all_builtins_when_tool_names_is_none() -> None:
  registry = build_builtin_tool_registry()

  provider_tools = registry.as_provider_tools(None)

  assert {tool["function"]["name"] for tool in provider_tools} == {
    "echo_text",
    "get_current_time",
  }


def test_as_provider_tools_returns_no_tools_for_empty_list() -> None:
  registry = build_builtin_tool_registry()

  provider_tools = registry.as_provider_tools([])

  assert provider_tools == []
