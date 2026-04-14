import asyncio

import httpx

from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import ProviderRequestError
from call_llm_api.infrastructure.llm.openai_compatible import OpenAICompatibleClient


def test_create_chat_completion_maps_connect_error_to_provider_error() -> None:
  async def run_test() -> None:
    client = OpenAICompatibleClient(
      Settings(
        provider_base_url="http://127.0.0.1:18001",
        provider_api_key="test-token",
      )
    )

    async def handler(request: httpx.Request) -> httpx.Response:
      raise httpx.ConnectError("All connection attempts failed", request=request)

    await client.close()
    client._client = httpx.AsyncClient(  # noqa: SLF001 - test-only transport override
      base_url="http://127.0.0.1:18001",
      transport=httpx.MockTransport(handler),
    )

    try:
      await client.create_chat_completion({"model": "stub-model", "messages": []})
      assert False, "ProviderRequestError was expected"
    except ProviderRequestError as exc:
      assert exc.status_code == 503
      assert "Upstream LLM server is unreachable" in exc.message
      assert "/v1/chat/completions" in exc.message
    finally:
      await client.close()

  asyncio.run(run_test())
