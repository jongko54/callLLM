import asyncio

from call_llm_api.application.benchmark_runners import BenchmarkRunner, BenchmarkRunnerRegistry
from call_llm_api.application.services.agent_profile_service import AgentProfileService
from call_llm_api.application.services.benchmark_service import BenchmarkService
from call_llm_api.application.services.model_registry_service import ModelRegistryService
from call_llm_api.application.services.profile_response_service import ProfileResponseService
from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import BadRequestError
from call_llm_api.domain.models import ChatMessage
from call_llm_api.domain.models import AgentFramework
from call_llm_api.infrastructure.grounding import LocationGrounder
from call_llm_api.infrastructure.persistence.in_memory import (
  InMemoryAgentProfileRepository,
  InMemoryBenchmarkRunRepository,
  InMemoryBenchmarkSuiteRepository,
  InMemoryModelRegistryRepository,
)
from call_llm_api.infrastructure.tools.registry import build_builtin_tool_registry


class StubBenchmarkLLMClient:
  def __init__(self) -> None:
    self.payloads: list[dict] = []

  async def list_models(self) -> dict:
    return {"data": [{"id": "stub-model"}]}

  async def create_chat_completion(self, payload: dict) -> dict:
    self.payloads.append(payload)
    message_roles = [message.get("role") for message in payload.get("messages", []) if isinstance(message, dict)]

    if payload.get("tools") and "tool" not in message_roles:
      return {
        "choices": [
          {
            "message": {
              "role": "assistant",
              "content": "",
              "tool_calls": [
                {
                  "id": "call_1",
                  "type": "function",
                  "function": {
                    "name": "echo_text",
                    "arguments": '{"text":"from tool"}',
                  },
                }
              ],
            }
          }
        ]
      }

    if "tool" in message_roles:
      return {
        "choices": [
          {
            "message": {
              "role": "assistant",
              "content": "Final answer from tool",
            }
          }
        ],
        "usage": {
          "prompt_tokens": 11,
          "completion_tokens": 4,
        },
      }

    return {
      "choices": [
        {
          "message": {
            "role": "assistant",
            "content": "Expected benchmark answer",
          }
        }
      ],
      "usage": {
        "prompt_tokens": 7,
        "completion_tokens": 3,
      },
    }

  async def stream_chat_completion_chunks(self, payload: dict):
    self.payloads.append(payload)
    yield {
      "choices": [
        {
          "delta": {
            "content": "안녕",
          }
        }
      ]
    }
    yield {
      "choices": [
        {
          "delta": {
            "content": "하세요.",
          }
        }
      ]
    }

  async def close(self) -> None:
    return None


class BenchmarkServiceHarness:
  def __init__(
    self,
    stub_client: StubBenchmarkLLMClient,
    runner_registry: BenchmarkRunnerRegistry | None = None,
    location_grounder: LocationGrounder | None = None,
  ) -> None:
    settings = Settings(
      provider_base_url="http://127.0.0.1:18001",
      provider_api_key="test-token",
    )
    client_factory = lambda model: stub_client
    tool_registry = build_builtin_tool_registry()
    model_registry_repository = InMemoryModelRegistryRepository()
    agent_profile_repository = InMemoryAgentProfileRepository()

    self.model_registry_service = ModelRegistryService(
      model_registry_repository=model_registry_repository,
      settings=settings,
      client_factory=client_factory,
    )
    self.agent_profile_service = AgentProfileService(
      agent_profile_repository=agent_profile_repository,
    )
    self.benchmark_service = BenchmarkService(
      model_registry_service=self.model_registry_service,
      agent_profile_service=self.agent_profile_service,
      benchmark_suite_repository=InMemoryBenchmarkSuiteRepository(),
      benchmark_run_repository=InMemoryBenchmarkRunRepository(),
      tool_registry=tool_registry,
      settings=settings,
      runner_registry=runner_registry,
      client_factory=client_factory,
    )
    self.profile_response_service = ProfileResponseService(
      model_registry_service=self.model_registry_service,
      agent_profile_service=self.agent_profile_service,
      tool_registry=tool_registry,
      settings=settings,
      location_grounder=location_grounder or StubLocationGrounder([]),
      runner_registry=runner_registry,
      client_factory=client_factory,
    )

  def __getattr__(self, name):
    for service in (
      self.model_registry_service,
      self.agent_profile_service,
      self.benchmark_service,
      self.profile_response_service,
    ):
      if hasattr(service, name):
        return getattr(service, name)
    raise AttributeError(name)


class MissingLangChainRunner(BenchmarkRunner):
  framework = AgentFramework.LANGCHAIN

  async def run_case(self, context):
    _ = context
    raise BadRequestError(
      "Framework 'langchain' is not available. Missing modules: langchain_openai. Install them with `pip install -e \".[frameworks]\"`."
    )


class ExplodingCustomRunner(BenchmarkRunner):
  framework = AgentFramework.CUSTOM

  async def run_case(self, context):
    _ = context
    raise ValueError("runner exploded")


class StubLocationGrounder(LocationGrounder):
  def __init__(self, documents: list[str]) -> None:
    self.documents = documents
    self.messages: list[list[ChatMessage]] = []
    self.grounded_response: dict | None = None

  async def build_context_documents(self, messages):
    self.messages.append(list(messages))
    return list(self.documents)

  async def maybe_build_grounded_response(self, messages):
    self.messages.append(list(messages))
    return self.grounded_response


def test_execute_direct_benchmark_run_records_successful_result() -> None:
  async def run_test() -> None:
    service = BenchmarkServiceHarness(StubBenchmarkLLMClient())

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"tool_calling": True},
      default_params={"temperature": 0.1},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Direct",
      description="baseline",
      strategy_kind="direct",
      framework="custom",
      system_prompt="Answer clearly.",
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )
    suite = await service.create_benchmark_suite(
      name="Smoke Suite",
      version="1",
      description="smoke",
      tags=["smoke"],
      status="active",
      metadata={},
    )
    await service.add_benchmark_case(
      suite_id=suite.id,
      name="Simple case",
      slug="simple-case",
      input_messages=[],
      expected_output={"contains": "benchmark answer"},
      rubric={},
      metadata={},
      enabled=True,
    )
    run = await service.create_benchmark_run(
      suite_id=suite.id,
      model_id=model.id,
      agent_profile_id=profile.id,
      params={},
    )

    completed_run = await service.execute_benchmark_run(run.id)
    results = await service.list_benchmark_run_results(run.id)

    assert completed_run.status.value == "completed"
    assert completed_run.summary["completed_cases"] == 1
    assert len(results) == 1
    assert results[0].output_text == "Expected benchmark answer"
    assert results[0].score["contains_expected"] is True
    assert results[0].trace[0]["event"] == "request.built"
    assert results[0].trace[0]["request_preview"]["model"] == "stub-model"

  asyncio.run(run_test())


def test_execute_tool_benchmark_run_records_tool_trace() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    service = BenchmarkServiceHarness(stub_client)

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"tool_calling": True},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Tool Agent",
      description="tool use",
      strategy_kind="tool",
      framework="custom",
      system_prompt="Use tools when useful.",
      tool_names=["echo_text"],
      retrieval_policy={},
      generation_defaults={"max_steps": 3},
      metadata={},
      enabled=True,
    )
    suite = await service.create_benchmark_suite(
      name="Tool Suite",
      version="1",
      description=None,
      tags=[],
      status="active",
      metadata={},
    )
    await service.add_benchmark_case(
      suite_id=suite.id,
      name="Tool case",
      slug="tool-case",
      input_messages=[],
      expected_output={"contains": "final answer"},
      rubric={},
      metadata={},
      enabled=True,
    )
    run = await service.create_benchmark_run(
      suite_id=suite.id,
      model_id=model.id,
      agent_profile_id=profile.id,
      params={},
    )

    completed_run = await service.execute_benchmark_run(run.id)
    results = await service.list_benchmark_run_results(run.id)

    assert completed_run.status.value == "completed"
    assert len(results) == 1
    assert results[0].output_text == "Final answer from tool"
    assert any(event["event"] == "request.built" for event in results[0].trace)
    assert any(event["event"] == "tool.completed" for event in results[0].trace)
    assert any("tools" in payload for payload in stub_client.payloads)

  asyncio.run(run_test())


def test_execute_profile_response_includes_rag_context_and_temperature() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    service = BenchmarkServiceHarness(stub_client)

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"chat_completions": True, "tool_calling": True},
      default_params={
        "temperature": 0.1,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
      },
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="RAG Context",
      description="rag",
      strategy_kind="rag",
      framework="custom",
      system_prompt="Answer with grounding.",
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )

    resolved_model, resolved_profile, result = await service.execute_profile_response(
      model_id=model.id,
      profile_id=profile.id,
      messages=[],
      context_documents=["Alpha document", "Beta note"],
      temperature=0.4,
      metadata={"source": "test"},
    )

    assert resolved_model.id == model.id
    assert resolved_profile.id == profile.id
    assert result["output_text"] == "Expected benchmark answer"
    assert stub_client.payloads[-1]["temperature"] == 0.4
    assert stub_client.payloads[-1]["chat_template_kwargs"]["enable_thinking"] is False
    assert "Grounded context" in stub_client.payloads[-1]["messages"][0]["content"]
    assert "Alpha document" in stub_client.payloads[-1]["messages"][0]["content"]

  asyncio.run(run_test())


def test_execute_profile_response_includes_grounded_context_for_direct_response_mode() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    stub_grounder = StubLocationGrounder(
      [
        "Location lookup: 홍파동, 교남동, 종로구, 서울특별시",
        "Nearby subway stations: 서대문(574m), 독립문(761m), 경복궁(930m)",
      ]
    )
    service = BenchmarkServiceHarness(stub_client, location_grounder=stub_grounder)

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"chat_completions": True},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Direct",
      description="baseline",
      strategy_kind="direct",
      framework="custom",
      system_prompt=None,
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )

    await service.execute_profile_response(
      model_id=model.id,
      profile_id=profile.id,
      messages=[ChatMessage(role="user", content="서울특별시 종로구 홍파동 주변역이 뭐야?")],
      context_documents=[],
      temperature=0.7,
      metadata={"source": "test"},
    )

    system_message = stub_client.payloads[-1]["messages"][0]
    assert system_message["role"] == "system"
    assert "Avoid markdown tables" in system_message["content"]
    assert "Grounded context" in system_message["content"]
    assert "서대문(574m)" in system_message["content"]
    assert len(stub_grounder.messages) == 1

  asyncio.run(run_test())


def test_execute_profile_response_uses_grounded_response_for_response_page() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    stub_grounder = StubLocationGrounder([])
    stub_grounder.grounded_response = {
      "output_text": "홍파동은 서대문역과 독립문역 생활권에 가깝습니다.",
      "trace": [{"event": "grounded.location_response"}],
    }
    service = BenchmarkServiceHarness(stub_client, location_grounder=stub_grounder)

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"chat_completions": True},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Direct",
      description="baseline",
      strategy_kind="direct",
      framework="custom",
      system_prompt=None,
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )

    _, _, result = await service.execute_profile_response(
      model_id=model.id,
      profile_id=profile.id,
      messages=[ChatMessage(role="user", content="서울특별시 종로구 홍파동 주변역이 뭐야?")],
      context_documents=[],
      temperature=0.7,
      metadata={"source": "response-page"},
    )

    assert result["output_text"] == "홍파동은 서대문역과 독립문역 생활권에 가깝습니다."
    assert result["trace"][0]["event"] == "grounded.location_response"
    assert result["raw_output"] == {"grounded": True}
    assert result["usage"] == {}
    assert stub_client.payloads == []

  asyncio.run(run_test())


def test_execute_profile_response_uses_identity_override_for_response_page() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    service = BenchmarkServiceHarness(stub_client, location_grounder=StubLocationGrounder([]))

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"chat_completions": True},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Direct",
      description="baseline",
      strategy_kind="direct",
      framework="custom",
      system_prompt=None,
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )

    _, _, result = await service.execute_profile_response(
      model_id=model.id,
      profile_id=profile.id,
      messages=[ChatMessage(role="user", content="안녕하세요. 너는 누구야?")],
      context_documents=[],
      temperature=0.7,
      metadata={"source": "response-page"},
    )

    assert "callLLM에서 동작하는 AI 어시스턴트" in result["output_text"]
    assert result["trace"][0]["event"] == "grounded.identity_response"
    assert stub_client.payloads == []

  asyncio.run(run_test())


def test_execute_profile_response_raw_mode_skips_grounding_override() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    stub_grounder = StubLocationGrounder([])
    stub_grounder.grounded_response = {
      "output_text": "This should not be used",
      "trace": [{"event": "grounded.location_response"}],
    }
    service = BenchmarkServiceHarness(stub_client, location_grounder=stub_grounder)

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"chat_completions": True},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Direct",
      description="baseline",
      strategy_kind="direct",
      framework="custom",
      system_prompt=None,
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )

    _, _, result = await service.execute_profile_response(
      model_id=model.id,
      profile_id=profile.id,
      messages=[ChatMessage(role="user", content="서울특별시 종로구 홍파동 주변역이 뭐야?")],
      context_documents=[],
      temperature=0.7,
      metadata={"source": "response-page", "grounding_mode": "raw"},
    )

    assert result["output_text"] == "Expected benchmark answer"
    assert stub_client.payloads != []

  asyncio.run(run_test())


def test_stream_profile_response_yields_deltas_for_custom_direct_profile() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    service = BenchmarkServiceHarness(stub_client)

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"chat_completions": True},
      default_params={"extra_body": {"chat_template_kwargs": {"enable_thinking": False}}},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Direct",
      description="baseline",
      strategy_kind="direct",
      framework="custom",
      system_prompt=None,
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )

    events = []
    async for event in service.stream_profile_response(
      model_id=model.id,
      profile_id=profile.id,
      messages=[],
      context_documents=[],
      temperature=0.7,
      metadata={"source": "test"},
    ):
      events.append(event)

    assert [event["event"] for event in events] == ["run.started", "message.delta", "message.delta", "run.completed"]
    assert events[-1]["data"]["output_text"] == "안녕하세요."
    assert stub_client.payloads[-1]["chat_template_kwargs"]["enable_thinking"] is False

  asyncio.run(run_test())


def test_execute_profile_response_runs_tool_profile() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    service = BenchmarkServiceHarness(stub_client)

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"chat_completions": True, "tool_calling": True},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Tool Agent",
      description="tool use",
      strategy_kind="tool",
      framework="custom",
      system_prompt="Use tools when useful.",
      tool_names=["echo_text"],
      retrieval_policy={},
      generation_defaults={"max_steps": 3},
      metadata={},
      enabled=True,
    )

    _, _, result = await service.execute_profile_response(
      model_id=model.id,
      profile_id=profile.id,
      messages=[],
      context_documents=[],
      temperature=0.2,
      metadata={"source": "test"},
    )

    assert result["output_text"] == "Final answer from tool"
    assert any("tools" in payload for payload in stub_client.payloads)
    assert any(event["event"] == "tool.completed" for event in result["trace"])

  asyncio.run(run_test())


def test_execute_profile_response_rejects_tool_profile_without_tool_calling_support() -> None:
  async def run_test() -> None:
    stub_client = StubBenchmarkLLMClient()
    service = BenchmarkServiceHarness(stub_client)

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={"chat_completions": True},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Tool Agent",
      description="tool use",
      strategy_kind="tool",
      framework="custom",
      system_prompt="Use tools when useful.",
      tool_names=["echo_text"],
      retrieval_policy={},
      generation_defaults={"max_steps": 3},
      metadata={},
      enabled=True,
    )

    try:
      await service.execute_profile_response(
        model_id=model.id,
        profile_id=profile.id,
        messages=[],
        context_documents=[],
        temperature=0.2,
        metadata={"source": "test"},
      )
      assert False, "BadRequestError was expected"
    except BadRequestError as exc:
      assert "not configured for tool calling" in exc.message

  asyncio.run(run_test())


def test_execute_framework_benchmark_run_records_missing_dependency_failure() -> None:
  async def run_test() -> None:
    service = BenchmarkServiceHarness(
      StubBenchmarkLLMClient(),
      runner_registry=BenchmarkRunnerRegistry([MissingLangChainRunner()]),
    )

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="LangChain Direct",
      description="framework smoke",
      strategy_kind="direct",
      framework="langchain",
      system_prompt=None,
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )
    suite = await service.create_benchmark_suite(
      name="Framework Suite",
      version="1",
      description=None,
      tags=[],
      status="active",
      metadata={},
    )
    await service.add_benchmark_case(
      suite_id=suite.id,
      name="Framework case",
      slug="framework-case",
      input_messages=[],
      expected_output={},
      rubric={},
      metadata={},
      enabled=True,
    )
    run = await service.create_benchmark_run(
      suite_id=suite.id,
      model_id=model.id,
      agent_profile_id=profile.id,
      params={},
    )

    completed_run = await service.execute_benchmark_run(run.id)
    results = await service.list_benchmark_run_results(run.id)

    assert completed_run.status.value == "completed"
    assert completed_run.summary["failed_cases"] == 1
    assert len(results) == 1
    assert results[0].status.value == "failed"
    assert "Framework 'langchain' is not available" in results[0].error
    assert "pip install -e" in results[0].error

  asyncio.run(run_test())


def test_execute_runner_exception_is_captured_as_failed_case() -> None:
  async def run_test() -> None:
    service = BenchmarkServiceHarness(
      StubBenchmarkLLMClient(),
      runner_registry=BenchmarkRunnerRegistry([ExplodingCustomRunner()]),
    )

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Direct",
      description="baseline",
      strategy_kind="direct",
      framework="custom",
      system_prompt=None,
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )
    suite = await service.create_benchmark_suite(
      name="Exploding Suite",
      version="1",
      description=None,
      tags=[],
      status="active",
      metadata={},
    )
    await service.add_benchmark_case(
      suite_id=suite.id,
      name="Exploding case",
      slug="exploding-case",
      input_messages=[],
      expected_output={},
      rubric={},
      metadata={},
      enabled=True,
    )
    run = await service.create_benchmark_run(
      suite_id=suite.id,
      model_id=model.id,
      agent_profile_id=profile.id,
      params={},
    )

    completed_run = await service.execute_benchmark_run(run.id)
    results = await service.list_benchmark_run_results(run.id)

    assert completed_run.status.value == "completed"
    assert completed_run.summary["failed_cases"] == 1
    assert len(results) == 1
    assert results[0].status.value == "failed"
    assert results[0].error == "ValueError: runner exploded"
    assert results[0].trace[0]["event"] == "runner.exception"

  asyncio.run(run_test())


def test_list_benchmark_history_returns_grouped_run_snapshots() -> None:
  async def run_test() -> None:
    service = BenchmarkServiceHarness(StubBenchmarkLLMClient())

    model = await service.register_model(
      name="Stub Model",
      provider="vllm",
      base_url="http://127.0.0.1:18001",
      served_model_name="stub-model",
      api_type="openai_compatible",
      api_key="test-token",
      enabled=True,
      capabilities={},
      default_params={},
      metadata={},
    )
    profile = await service.create_agent_profile(
      name="Direct",
      description="baseline",
      strategy_kind="direct",
      framework="custom",
      system_prompt="Answer clearly.",
      tool_names=[],
      retrieval_policy={},
      generation_defaults={},
      metadata={},
      enabled=True,
    )
    suite = await service.create_benchmark_suite(
      name="History Suite",
      version="1",
      description="history",
      tags=["history"],
      status="active",
      metadata={"selected_app_id": "compare-studio", "selected_library_id": "vllm-runtime"},
    )
    case = await service.add_benchmark_case(
      suite_id=suite.id,
      name="History case",
      slug="history-case",
      input_messages=[{"role": "user", "content": "Compare direct responses."}],
      expected_output={"contains": "benchmark answer"},
      rubric={},
      metadata={},
      enabled=True,
    )
    run = await service.create_benchmark_run(
      suite_id=suite.id,
      model_id=model.id,
      agent_profile_id=profile.id,
      params={"temperature": 0.2},
    )
    await service.execute_benchmark_run(run.id)

    history = await service.list_benchmark_history(limit=4)

    assert len(history) == 1
    assert history[0].suite.id == suite.id
    assert history[0].cases[0].id == case.id
    assert history[0].runs[0].run.id == run.id
    assert history[0].runs[0].model.id == model.id
    assert history[0].runs[0].profile.id == profile.id
    assert history[0].runs[0].results[0].output_text == "Expected benchmark answer"

  asyncio.run(run_test())
