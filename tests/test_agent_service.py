import asyncio
from collections.abc import AsyncIterator

from call_llm_api.application.services.agent_service import AgentService
from call_llm_api.core.config import Settings
from call_llm_api.infrastructure.persistence.in_memory import InMemoryRunRepository, InMemoryThreadRepository
from call_llm_api.infrastructure.tools.registry import build_builtin_tool_registry


class StubLLMClient:
  def __init__(self) -> None:
    self.stream_payloads: list[dict] = []

  async def list_models(self) -> dict:
    return {"data": []}

  async def create_chat_completion(self, payload: dict) -> dict:
    _ = payload
    return {
      "choices": [
        {
          "message": {
            "role": "assistant",
            "content": "stub completion",
          }
        }
      ]
    }

  async def close(self) -> None:
    return None

  async def forward_chat_completion_stream(self, payload: dict) -> AsyncIterator[bytes]:
    _ = payload
    if False:
      yield b""

  async def stream_chat_completion_chunks(self, payload: dict) -> AsyncIterator[dict]:
    self.stream_payloads.append(payload)
    for fragment in ["스트림 ", "응답"]:
      yield {"choices": [{"delta": {"content": fragment}}]}


def test_stream_thread_run_omits_tool_payload_when_no_tools_are_requested() -> None:
  async def run_test() -> None:
    llm_client = StubLLMClient()
    service = AgentService(
      llm_client=llm_client,
      run_repository=InMemoryRunRepository(),
      thread_repository=InMemoryThreadRepository(),
      tool_registry=build_builtin_tool_registry(),
      settings=Settings(
        provider_base_url="http://127.0.0.1:18001",
        provider_api_key="test-token",
      ),
    )

    thread = await service.create_thread(title="stream test")

    events = []
    async for event in service.stream_thread_run(
      thread_id=thread.id,
      user_message="테스트",
      model="qwen3-8b-int4",
      system_prompt="한국어로 답해.",
      metadata={},
    ):
      events.append(event)

    assert len(llm_client.stream_payloads) == 1
    payload = llm_client.stream_payloads[0]
    assert payload["model"] == "qwen3-8b-int4"
    assert "tools" not in payload
    assert "tool_choice" not in payload

    assert events[0]["event"] == "run.started"
    assert events[1]["event"] == "message.delta"
    assert events[-1]["event"] == "run.completed"
    assert events[-1]["data"]["output_text"] == "스트림 응답"

    saved_thread = await service.get_thread(thread.id)
    assert saved_thread.messages[-1].content == "스트림 응답"

  asyncio.run(run_test())
