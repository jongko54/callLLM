from __future__ import annotations

import importlib
import importlib.util
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, TypedDict
from uuid import uuid4

from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import BadRequestError
from call_llm_api.domain.models import (
  AgentFramework,
  AgentProfileRecord,
  AgentStrategyKind,
  BenchmarkCaseRecord,
  BenchmarkRunRecord,
  ChatMessage,
  ModelRegistryRecord,
  ToolCall,
  ToolFunctionCall,
  tool_result_to_message,
)
from call_llm_api.infrastructure.llm.openai_compatible import OpenAICompatibleClient
from call_llm_api.infrastructure.tools.registry import ToolRegistry

FRAMEWORK_INSTALL_HINT = 'pip install -e ".[frameworks]"'
DEFAULT_GENERATION_TEMPERATURE = 0.7
FRAMEWORK_PACKAGE_REQUIREMENTS: dict[AgentFramework, tuple[str, ...]] = {
  AgentFramework.CUSTOM: (),
  AgentFramework.LANGCHAIN: ("langchain_openai",),
  AgentFramework.LANGGRAPH: ("langgraph", "langchain_openai"),
  AgentFramework.LLAMAINDEX: ("llama_index.core", "llama_index.llms.openai_like"),
}


@dataclass(slots=True)
class BenchmarkRunnerContext:
  client: OpenAICompatibleClient
  model: ModelRegistryRecord
  profile: AgentProfileRecord
  case: BenchmarkCaseRecord
  run: BenchmarkRunRecord
  tool_registry: ToolRegistry
  settings: Settings


@dataclass(slots=True)
class BenchmarkRunnerResult:
  output_text: str
  raw_output: dict[str, Any] | None
  trace: list[dict[str, Any]] = field(default_factory=list)
  usage: dict[str, Any] = field(default_factory=dict)


class BenchmarkRunner:
  framework: AgentFramework

  async def run_case(self, context: BenchmarkRunnerContext) -> BenchmarkRunnerResult:
    raise NotImplementedError


class BenchmarkRunnerRegistry:
  def __init__(self, runners: Sequence[BenchmarkRunner]) -> None:
    self._runners = {runner.framework: runner for runner in runners}

  def get(self, framework: AgentFramework | str) -> BenchmarkRunner:
    normalized = framework if isinstance(framework, AgentFramework) else AgentFramework(framework)
    runner = self._runners.get(normalized)
    if runner is None:
      raise BadRequestError(f"Benchmark framework '{normalized.value}' is not registered.")
    return runner


class CustomBenchmarkRunner(BenchmarkRunner):
  framework = AgentFramework.CUSTOM

  async def run_case(self, context: BenchmarkRunnerContext) -> BenchmarkRunnerResult:
    if context.profile.strategy_kind == AgentStrategyKind.TOOL:
      return await self._run_tool_strategy(context)

    payload = build_provider_payload(context)
    trace = [
      {
        "event": "request.built",
        "framework": self.framework.value,
        "strategy": context.profile.strategy_kind.value,
        "message_count": len(payload["messages"]),
        "request_preview": build_request_preview(payload),
      }
    ]
    raw_output = await context.client.create_chat_completion(payload)
    return BenchmarkRunnerResult(
      output_text=extract_text_from_provider_response(raw_output),
      raw_output=raw_output,
      trace=trace,
      usage=extract_usage(raw_output),
    )

  async def _run_tool_strategy(self, context: BenchmarkRunnerContext) -> BenchmarkRunnerResult:
    messages = list(context.case.input_messages)
    trace: list[dict[str, Any]] = []
    max_steps = int(
      context.run.params.get("max_steps")
      or context.profile.generation_defaults.get("max_steps")
      or context.settings.agent_max_steps
    )

    for step in range(max_steps):
      payload = build_provider_payload(context, messages=messages, tool_names=context.profile.tool_names)
      trace.append(
        {
          "event": "request.built",
          "framework": self.framework.value,
          "strategy": context.profile.strategy_kind.value,
          "step": step,
          "message_count": len(payload["messages"]),
          "request_preview": build_request_preview(payload),
        }
      )
      raw_output = await context.client.create_chat_completion(payload)
      assistant_message = ChatMessage.from_provider_message(
        ((raw_output.get("choices") or [{}])[0].get("message") or {})
      )
      messages.append(assistant_message)
      trace.append(
        {
          "event": "assistant.message",
          "framework": self.framework.value,
          "step": step,
          "content": assistant_message.content,
          "tool_calls": [tool_call.model_dump(mode="json") for tool_call in assistant_message.tool_calls],
        }
      )

      if not assistant_message.tool_calls:
        return BenchmarkRunnerResult(
          output_text=assistant_message.content or "",
          raw_output=raw_output,
          trace=trace,
          usage=extract_usage(raw_output),
        )

      for tool_call in assistant_message.tool_calls:
        tool_result = await context.tool_registry.execute_tool_call(tool_call)
        messages.append(tool_result_to_message(tool_result))
        trace.append(
          {
            "event": "tool.completed",
            "framework": self.framework.value,
            "step": step,
            "tool_name": tool_result.name,
            "output": tool_result.output,
          }
        )

    raise BadRequestError(f"Benchmark tool agent reached max steps ({max_steps}) without completing.")


class LangChainBenchmarkRunner(BenchmarkRunner):
  framework = AgentFramework.LANGCHAIN

  async def run_case(self, context: BenchmarkRunnerContext) -> BenchmarkRunnerResult:
    ChatOpenAI = require_framework_dependency(self.framework, "langchain_openai", "ChatOpenAI")
    params = resolve_generation_params(context)
    llm = ChatOpenAI(
      model=context.model.served_model_name,
      api_key=context.model.api_key or context.settings.provider_api_key,
      base_url=build_openai_api_base(context.model.base_url),
      temperature=params.get("temperature", DEFAULT_GENERATION_TEMPERATURE),
      max_tokens=params.get("max_tokens"),
    )
    messages = build_provider_messages(context.case.input_messages, build_system_prompt(context.profile, context.case))
    request_payload_preview = build_request_preview(
      {
        "model": context.model.served_model_name,
        "messages": messages,
        "temperature": params.get("temperature", DEFAULT_GENERATION_TEMPERATURE),
        "max_tokens": params.get("max_tokens"),
      }
    )

    if context.profile.strategy_kind == AgentStrategyKind.TOOL and context.profile.tool_names:
      return await self._run_tool_strategy(context, llm=llm, messages=messages)

    response = await llm.ainvoke(messages)
    assistant_message = langchain_message_to_provider_dict(response)
    return BenchmarkRunnerResult(
      output_text=stringify_message_content(assistant_message.get("content")),
      raw_output={
        "framework": self.framework.value,
        "message": assistant_message,
        "usage": extract_langchain_usage(response),
        "response_metadata": dict(getattr(response, "response_metadata", {}) or {}),
      },
      trace=[
        {
          "event": "request.built",
          "framework": self.framework.value,
          "strategy": context.profile.strategy_kind.value,
          "message_count": len(messages),
          "request_preview": request_payload_preview,
        },
        {
          "event": "assistant.message",
          "framework": self.framework.value,
          "strategy": context.profile.strategy_kind.value,
          "content": stringify_message_content(assistant_message.get("content")),
          "tool_calls": assistant_message.get("tool_calls", []),
        }
      ],
      usage=extract_langchain_usage(response),
    )

  async def _run_tool_strategy(
    self,
    context: BenchmarkRunnerContext,
    *,
    llm: Any,
    messages: list[dict[str, Any]],
  ) -> BenchmarkRunnerResult:
    bound_model = llm.bind_tools(context.tool_registry.as_provider_tools(context.profile.tool_names))
    trace: list[dict[str, Any]] = []
    max_steps = int(
      context.run.params.get("max_steps")
      or context.profile.generation_defaults.get("max_steps")
      or context.settings.agent_max_steps
    )

    for step in range(max_steps):
      trace.append(
        {
          "event": "request.built",
          "framework": self.framework.value,
          "strategy": context.profile.strategy_kind.value,
          "step": step,
          "message_count": len(messages),
          "request_preview": build_request_preview(
            {
              "model": context.model.served_model_name,
              "messages": messages,
              "temperature": resolve_generation_params(context).get("temperature", DEFAULT_GENERATION_TEMPERATURE),
              "max_tokens": resolve_generation_params(context).get("max_tokens"),
              "tools": context.tool_registry.as_provider_tools(context.profile.tool_names),
              "tool_choice": "auto",
            }
          ),
        }
      )
      response = await bound_model.ainvoke(messages)
      assistant_message = langchain_message_to_provider_dict(response)
      messages.append(assistant_message)
      trace.append(
        {
          "event": "assistant.message",
          "framework": self.framework.value,
          "step": step,
          "content": stringify_message_content(assistant_message.get("content")),
          "tool_calls": assistant_message.get("tool_calls", []),
        }
      )
      tool_calls = provider_message_to_tool_calls(assistant_message)
      if not tool_calls:
        return BenchmarkRunnerResult(
          output_text=stringify_message_content(assistant_message.get("content")),
          raw_output={
            "framework": self.framework.value,
            "message": assistant_message,
            "usage": extract_langchain_usage(response),
            "response_metadata": dict(getattr(response, "response_metadata", {}) or {}),
          },
          trace=trace,
          usage=extract_langchain_usage(response),
        )

      for tool_call in tool_calls:
        tool_result = await context.tool_registry.execute_tool_call(tool_call)
        tool_message = tool_result_to_message(tool_result).to_provider_dict()
        messages.append(tool_message)
        trace.append(
          {
            "event": "tool.completed",
            "framework": self.framework.value,
            "step": step,
            "tool_name": tool_result.name,
            "output": tool_result.output,
          }
        )

    raise BadRequestError(f"LangChain tool runner reached max steps ({max_steps}) without completing.")


class LangGraphBenchmarkRunner(BenchmarkRunner):
  framework = AgentFramework.LANGGRAPH

  async def run_case(self, context: BenchmarkRunnerContext) -> BenchmarkRunnerResult:
    StateGraph = require_framework_dependency(self.framework, "langgraph.graph", "StateGraph")
    START = require_framework_dependency(self.framework, "langgraph.graph", "START")
    END = require_framework_dependency(self.framework, "langgraph.graph", "END")
    ChatOpenAI = require_framework_dependency(self.framework, "langchain_openai", "ChatOpenAI")

    params = resolve_generation_params(context)
    llm = ChatOpenAI(
      model=context.model.served_model_name,
      api_key=context.model.api_key or context.settings.provider_api_key,
      base_url=build_openai_api_base(context.model.base_url),
      temperature=params.get("temperature", DEFAULT_GENERATION_TEMPERATURE),
      max_tokens=params.get("max_tokens"),
    )
    if context.profile.strategy_kind == AgentStrategyKind.TOOL and context.profile.tool_names:
      llm = llm.bind_tools(context.tool_registry.as_provider_tools(context.profile.tool_names))

    max_steps = int(
      context.run.params.get("max_steps")
      or context.profile.generation_defaults.get("max_steps")
      or context.settings.agent_max_steps
    )

    class GraphState(TypedDict):
      messages: list[Any]
      trace: list[dict[str, Any]]
      llm_calls: int

    async def call_model(state: dict[str, Any]) -> dict[str, Any]:
      trace = list(state.get("trace", []))
      trace.append(
        {
          "event": "request.built",
          "framework": self.framework.value,
          "strategy": context.profile.strategy_kind.value,
          "step": state.get("llm_calls", 0),
          "message_count": len(state["messages"]),
          "request_preview": build_request_preview(
            {
              "model": context.model.served_model_name,
              "messages": state["messages"],
              "temperature": params.get("temperature", DEFAULT_GENERATION_TEMPERATURE),
              "max_tokens": params.get("max_tokens"),
              "tools": context.tool_registry.as_provider_tools(context.profile.tool_names)
              if context.profile.strategy_kind == AgentStrategyKind.TOOL and context.profile.tool_names
              else None,
              "tool_choice": "auto"
              if context.profile.strategy_kind == AgentStrategyKind.TOOL and context.profile.tool_names
              else None,
            }
          ),
        }
      )
      response = await llm.ainvoke(state["messages"])
      assistant_message = langchain_message_to_provider_dict(response)
      trace.append(
        {
          "event": "assistant.message",
          "framework": self.framework.value,
          "step": state.get("llm_calls", 0),
          "content": stringify_message_content(assistant_message.get("content")),
          "tool_calls": assistant_message.get("tool_calls", []),
        }
      )
      return {
        "messages": [*state["messages"], assistant_message],
        "trace": trace,
        "llm_calls": state.get("llm_calls", 0) + 1,
      }

    async def run_tools(state: dict[str, Any]) -> dict[str, Any]:
      last_message = state["messages"][-1]
      tool_calls = provider_message_to_tool_calls(last_message)
      trace = list(state.get("trace", []))
      tool_messages: list[dict[str, Any]] = []
      for tool_call in tool_calls:
        tool_result = await context.tool_registry.execute_tool_call(tool_call)
        tool_messages.append(tool_result_to_message(tool_result).to_provider_dict())
        trace.append(
          {
            "event": "tool.completed",
            "framework": self.framework.value,
            "step": state.get("llm_calls", 0) - 1,
            "tool_name": tool_result.name,
            "output": tool_result.output,
          }
        )
      return {
        "messages": [*state["messages"], *tool_messages],
        "trace": trace,
        "llm_calls": state.get("llm_calls", 0),
      }

    def route_after_model(state: dict[str, Any]) -> str:
      last_message = state["messages"][-1]
      if context.profile.strategy_kind != AgentStrategyKind.TOOL:
        return "stop"
      if provider_message_to_tool_calls(last_message) and state.get("llm_calls", 0) < max_steps:
        return "run_tools"
      return "stop"

    graph = StateGraph(GraphState)
    graph.add_node("call_model", call_model)
    graph.add_node("run_tools", run_tools)
    graph.add_edge(START, "call_model")
    graph.add_conditional_edges(
      "call_model",
      route_after_model,
      {
        "run_tools": "run_tools",
        "stop": END,
      },
    )
    graph.add_edge("run_tools", "call_model")
    compiled = graph.compile()
    result = await compiled.ainvoke(
      {
        "messages": build_provider_messages(
          context.case.input_messages,
          build_system_prompt(context.profile, context.case),
        ),
        "trace": [],
        "llm_calls": 0,
      }
    )

    final_message = result["messages"][-1]
    unresolved_tool_calls = provider_message_to_tool_calls(final_message)
    if unresolved_tool_calls:
      raise BadRequestError(f"LangGraph tool runner reached max steps ({max_steps}) without completing.")

    final_message_dict = provider_message_to_dict(final_message)
    trace = list(result.get("trace", []))
    return BenchmarkRunnerResult(
      output_text=stringify_message_content(final_message_dict.get("content")),
      raw_output={
        "framework": self.framework.value,
        "message": final_message_dict,
        "graph_trace": trace,
      },
      trace=trace,
      usage={},
    )


class LlamaIndexBenchmarkRunner(BenchmarkRunner):
  framework = AgentFramework.LLAMAINDEX

  async def run_case(self, context: BenchmarkRunnerContext) -> BenchmarkRunnerResult:
    OpenAILike = require_framework_dependency(self.framework, "llama_index.llms.openai_like", "OpenAILike")
    params = resolve_generation_params(context)
    llm = OpenAILike(
      model=context.model.served_model_name,
      api_base=build_openai_api_base(context.model.base_url),
      api_key=context.model.api_key or context.settings.provider_api_key or "local-dev-token",
      is_chat_model=True,
      is_function_calling_model=context.profile.strategy_kind == AgentStrategyKind.TOOL,
      context_window=int(
        context.profile.generation_defaults.get("context_window")
        or context.model.capabilities.get("context_window")
        or 128000
      ),
      temperature=params.get("temperature", DEFAULT_GENERATION_TEMPERATURE),
      max_tokens=params.get("max_tokens"),
    )
    prompt = flatten_messages_to_prompt(
      context.case.input_messages,
      build_system_prompt(context.profile, context.case),
    )

    if context.profile.strategy_kind == AgentStrategyKind.TOOL and context.profile.tool_names:
      FunctionTool = require_framework_dependency(self.framework, "llama_index.core.tools", "FunctionTool")
      tools = [build_llamaindex_tool(context, FunctionTool, name) for name in context.profile.tool_names]
      response = await llm.apredict_and_call(tools=tools, user_msg=prompt, verbose=False)
      output_text = stringify_message_content(
        getattr(response, "response", None)
        or getattr(response, "text", None)
        or getattr(response, "message", None)
        or str(response)
      )
      return BenchmarkRunnerResult(
        output_text=output_text,
        raw_output={
          "framework": self.framework.value,
          "response": stringify_message_content(
            getattr(response, "response", None)
            or getattr(response, "text", None)
            or getattr(response, "message", None)
            or str(response)
          ),
        },
        trace=[
          {
            "event": "request.built",
            "framework": self.framework.value,
            "strategy": context.profile.strategy_kind.value,
            "request_preview": build_prompt_request_preview(
              model=context.model.served_model_name,
              prompt=prompt,
              temperature=params.get("temperature", DEFAULT_GENERATION_TEMPERATURE),
              max_tokens=params.get("max_tokens"),
              tool_names=context.profile.tool_names,
            ),
          },
          {
            "event": "agent.completed",
            "framework": self.framework.value,
            "strategy": context.profile.strategy_kind.value,
          }
        ],
        usage={},
      )

    response = await llm.acomplete(prompt)
    output_text = stringify_message_content(getattr(response, "text", None) or str(response))
    return BenchmarkRunnerResult(
      output_text=output_text,
      raw_output={
        "framework": self.framework.value,
        "text": output_text,
      },
      trace=[
        {
          "event": "request.built",
          "framework": self.framework.value,
          "strategy": context.profile.strategy_kind.value,
          "request_preview": build_prompt_request_preview(
            model=context.model.served_model_name,
            prompt=prompt,
            temperature=params.get("temperature", DEFAULT_GENERATION_TEMPERATURE),
            max_tokens=params.get("max_tokens"),
          ),
        },
        {
          "event": "completion.received",
          "framework": self.framework.value,
          "strategy": context.profile.strategy_kind.value,
        }
      ],
      usage={},
    )


def build_default_benchmark_runner_registry() -> BenchmarkRunnerRegistry:
  return BenchmarkRunnerRegistry(
    [
      CustomBenchmarkRunner(),
      LangChainBenchmarkRunner(),
      LangGraphBenchmarkRunner(),
      LlamaIndexBenchmarkRunner(),
    ]
  )


def get_framework_runtime_statuses() -> dict[AgentFramework, dict[str, Any]]:
  statuses: dict[AgentFramework, dict[str, Any]] = {}
  for framework, modules in FRAMEWORK_PACKAGE_REQUIREMENTS.items():
    missing_modules = [module_name for module_name in modules if not _module_exists(module_name)]
    statuses[framework] = {
      "framework": framework.value,
      "available": len(missing_modules) == 0,
      "missing_modules": missing_modules,
      "install_hint": None if len(missing_modules) == 0 else FRAMEWORK_INSTALL_HINT,
    }
  return statuses


def resolve_generation_params(context: BenchmarkRunnerContext) -> dict[str, Any]:
  return {
    **context.model.default_params,
    **context.profile.generation_defaults,
    **context.run.params,
  }


def build_system_prompt(profile: AgentProfileRecord, case: BenchmarkCaseRecord) -> str | None:
  sections: list[str] = []
  if profile.system_prompt:
    sections.append(profile.system_prompt)

  if profile.strategy_kind == AgentStrategyKind.RAG:
    context_documents = case.metadata.get("context_documents") or []
    if isinstance(context_documents, str):
      context_documents = [context_documents]
    if context_documents:
      context_block = "\n".join(f"- {document}" for document in context_documents if isinstance(document, str))
      if context_block:
        sections.append(f"Retrieved context:\n{context_block}")

  return "\n\n".join(section for section in sections if section).strip() or None


def build_provider_payload(
  context: BenchmarkRunnerContext,
  *,
  messages: Sequence[ChatMessage] | None = None,
  tool_names: list[str] | None = None,
) -> dict[str, Any]:
  params = resolve_generation_params(context)
  provider_messages = build_provider_messages(
    messages if messages is not None else context.case.input_messages,
    build_system_prompt(context.profile, context.case),
  )
  payload = {
    "model": context.model.served_model_name,
    "messages": provider_messages,
    "temperature": params.get("temperature", DEFAULT_GENERATION_TEMPERATURE),
  }
  if params.get("max_tokens") is not None:
    payload["max_tokens"] = params["max_tokens"]
  if isinstance(params.get("extra_body"), dict):
    payload["extra_body"] = params["extra_body"]
  if tool_names:
    payload["tools"] = context.tool_registry.as_provider_tools(tool_names)
    payload["tool_choice"] = "auto"
  return payload


def build_provider_messages(messages: Sequence[ChatMessage], system_prompt: str | None) -> list[dict[str, Any]]:
  provider_messages = [message.to_provider_dict() for message in messages]
  if system_prompt:
    provider_messages = [{"role": "system", "content": system_prompt}, *provider_messages]
  return provider_messages


def build_request_preview(payload: dict[str, Any]) -> dict[str, Any]:
  messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
  normalized_messages = [message for message in messages if isinstance(message, dict)]
  tools = payload.get("tools") if isinstance(payload.get("tools"), list) else []
  return {
    "model": payload.get("model"),
    "temperature": payload.get("temperature"),
    "max_tokens": payload.get("max_tokens"),
    "extra_body": payload.get("extra_body") if isinstance(payload.get("extra_body"), dict) else None,
    "tool_choice": payload.get("tool_choice"),
    "tool_names": [
      tool.get("function", {}).get("name")
      for tool in tools
      if isinstance(tool, dict) and isinstance(tool.get("function"), dict)
    ],
    "message_count": len(normalized_messages),
    "messages": [
      {
        "role": message.get("role"),
        "content_preview": stringify_message_content(message.get("content"))[:240],
      }
      for message in normalized_messages[:8]
    ],
  }


def build_prompt_request_preview(
  *,
  model: str,
  prompt: str,
  temperature: float | None,
  max_tokens: int | None,
  tool_names: list[str] | None = None,
) -> dict[str, Any]:
  return {
    "model": model,
    "temperature": temperature,
    "max_tokens": max_tokens,
    "extra_body": None,
    "tool_names": tool_names or [],
    "prompt_preview": prompt[:500],
  }


def flatten_messages_to_prompt(messages: Sequence[ChatMessage], system_prompt: str | None) -> str:
  blocks: list[str] = []
  if system_prompt:
    blocks.append(f"[system]\n{system_prompt}")

  for message in messages:
    role = message.role
    content = stringify_message_content(message.content)
    if role == "tool" and message.name:
      header = f"[tool:{message.name}]"
    else:
      header = f"[{role}]"
    blocks.append(f"{header}\n{content}")

  return "\n\n".join(block for block in blocks if block).strip()


def extract_text_from_provider_response(raw_response: dict[str, Any]) -> str:
  choice = (raw_response.get("choices") or [{}])[0]
  message = choice.get("message") or {}
  return stringify_message_content(message.get("content"))


def extract_usage(raw_response: dict[str, Any] | None) -> dict[str, Any]:
  if not isinstance(raw_response, dict):
    return {}
  usage = raw_response.get("usage")
  return dict(usage) if isinstance(usage, dict) else {}


def build_openai_api_base(base_url: str) -> str:
  trimmed = base_url.rstrip("/")
  if trimmed.endswith("/v1"):
    return trimmed
  return f"{trimmed}/v1"


def require_framework_dependency(framework: AgentFramework, module_name: str, attribute_name: str) -> Any:
  if not _module_exists(module_name):
    raise BadRequestError(_format_framework_dependency_error(framework))
  module = importlib.import_module(module_name)
  return getattr(module, attribute_name)


def _format_framework_dependency_error(framework: AgentFramework) -> str:
  status = get_framework_runtime_statuses().get(framework, {})
  missing_modules = ", ".join(status.get("missing_modules", []))
  return (
    f"Framework '{framework.value}' is not available. "
    f"Missing modules: {missing_modules or 'unknown'}. "
    f"Install them with `{status.get('install_hint') or FRAMEWORK_INSTALL_HINT}`."
  )


def _module_exists(module_name: str) -> bool:
  try:
    return importlib.util.find_spec(module_name) is not None
  except (ModuleNotFoundError, ValueError):
    return False


def provider_message_to_tool_calls(message: Any) -> list[ToolCall]:
  payload = provider_message_to_dict(message)
  tool_calls = payload.get("tool_calls") or []
  normalized: list[ToolCall] = []
  for tool_call in tool_calls:
    if not isinstance(tool_call, dict):
      continue
    function = tool_call.get("function") or {}
    arguments = function.get("arguments") or "{}"
    if not isinstance(arguments, str):
      arguments = json.dumps(arguments, ensure_ascii=False)
    normalized.append(
      ToolCall(
        id=str(tool_call.get("id") or uuid4().hex),
        function=ToolFunctionCall(
          name=str(function.get("name") or ""),
          arguments=arguments,
        ),
      )
    )
  return normalized


def provider_message_to_dict(message: Any) -> dict[str, Any]:
  if isinstance(message, dict):
    payload = dict(message)
    tool_calls = payload.get("tool_calls")
    if isinstance(tool_calls, list):
      payload["tool_calls"] = [
        tool_call if isinstance(tool_call, dict) else {}
        for tool_call in tool_calls
      ]
    return payload

  tool_calls = getattr(message, "tool_calls", None)
  if isinstance(tool_calls, list):
    normalized_tool_calls = [
      {
        "id": str(tool_call.get("id") or uuid4().hex),
        "type": "function",
        "function": {
          "name": str(tool_call.get("name") or tool_call.get("function", {}).get("name") or ""),
          "arguments": (
            tool_call.get("args")
            if isinstance(tool_call.get("args"), str)
            else json.dumps(tool_call.get("args") or tool_call.get("arguments") or {}, ensure_ascii=False)
          ),
        },
      }
      for tool_call in tool_calls
      if isinstance(tool_call, dict)
    ]
  else:
    normalized_tool_calls = []

  payload: dict[str, Any] = {
    "role": str(getattr(message, "type", "assistant")).replace("human", "user"),
    "content": getattr(message, "content", ""),
  }
  if getattr(message, "name", None):
    payload["name"] = getattr(message, "name")
  if getattr(message, "tool_call_id", None):
    payload["tool_call_id"] = getattr(message, "tool_call_id")
  if normalized_tool_calls:
    payload["tool_calls"] = normalized_tool_calls
  return payload


def langchain_message_to_provider_dict(message: Any) -> dict[str, Any]:
  payload = provider_message_to_dict(message)
  if payload.get("role") == "ai":
    payload["role"] = "assistant"
  return payload


def extract_langchain_usage(message: Any) -> dict[str, Any]:
  usage_metadata = getattr(message, "usage_metadata", None)
  if isinstance(usage_metadata, dict) and usage_metadata:
    return {
      "prompt_tokens": usage_metadata.get("input_tokens"),
      "completion_tokens": usage_metadata.get("output_tokens"),
      "total_tokens": usage_metadata.get("total_tokens"),
    }

  response_metadata = getattr(message, "response_metadata", None)
  if isinstance(response_metadata, dict):
    token_usage = response_metadata.get("token_usage")
    if isinstance(token_usage, dict):
      return dict(token_usage)

  return {}


def stringify_message_content(value: Any) -> str:
  if value is None:
    return ""
  if isinstance(value, str):
    return value.strip()
  if isinstance(value, list):
    parts: list[str] = []
    for item in value:
      if isinstance(item, dict):
        if isinstance(item.get("text"), str):
          parts.append(item["text"])
        elif isinstance(item.get("content"), str):
          parts.append(item["content"])
        else:
          parts.append(json.dumps(item, ensure_ascii=False))
      else:
        parts.append(str(item))
    return "".join(parts).strip()
  if isinstance(value, dict):
    return json.dumps(value, ensure_ascii=False)
  return str(value).strip()


def build_llamaindex_tool(context: BenchmarkRunnerContext, function_tool_cls: Any, tool_name: str) -> Any:
  definitions = {definition.name: definition for definition in context.tool_registry.list_definitions(context.profile.tool_names)}
  definition = definitions.get(tool_name)
  if definition is None:
    raise BadRequestError(f"Tool '{tool_name}' is not registered.")

  async def tool_callable(**kwargs: Any) -> str:
    arguments = json.dumps(kwargs, ensure_ascii=False)
    tool_call = ToolCall(
      id=uuid4().hex,
      function=ToolFunctionCall(name=tool_name, arguments=arguments),
    )
    result = await context.tool_registry.execute_tool_call(tool_call)
    return result.output

  return function_tool_cls.from_defaults(
    async_fn=tool_callable,
    name=definition.name,
    description=definition.description,
  )
