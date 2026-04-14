import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import ProviderRequestError


class OpenAICompatibleClient:
  def __init__(self, settings: Settings) -> None:
    self._settings = settings
    self._client = httpx.AsyncClient(
      base_url=self._settings.provider_base_url.rstrip("/"),
      timeout=self._settings.request_timeout_seconds,
    )

  async def list_models(self) -> dict[str, Any]:
    try:
      response = await self._client.get("/v1/models", headers=self._headers())
    except httpx.RequestError as exc:
      raise self._to_provider_request_error(exc, "/v1/models") from exc
    return await self._json_or_raise(response)

  async def create_chat_completion(self, payload: dict) -> dict[str, Any]:
    try:
      response = await self._client.post(
        "/v1/chat/completions",
        headers=self._headers(),
        json=payload,
      )
    except httpx.RequestError as exc:
      raise self._to_provider_request_error(exc, "/v1/chat/completions") from exc
    return await self._json_or_raise(response)

  async def close(self) -> None:
    await self._client.aclose()

  async def forward_chat_completion_stream(self, payload: dict) -> AsyncIterator[bytes]:
    stream_payload = {**payload, "stream": True}
    try:
      async with self._client.stream(
        "POST",
        "/v1/chat/completions",
        headers=self._headers(),
        json=stream_payload,
      ) as response:
        await self._raise_for_status(response)
        async for chunk in response.aiter_bytes():
          if chunk:
            yield chunk
    except httpx.RequestError as exc:
      raise self._to_provider_request_error(exc, "/v1/chat/completions") from exc

  async def stream_chat_completion_chunks(self, payload: dict) -> AsyncIterator[dict[str, Any]]:
    stream_payload = {**payload, "stream": True}
    try:
      async with self._client.stream(
        "POST",
        "/v1/chat/completions",
        headers=self._headers(),
        json=stream_payload,
      ) as response:
        await self._raise_for_status(response)
        async for line in response.aiter_lines():
          if not line.startswith("data:"):
            continue
          data = line.removeprefix("data:").strip()
          if not data:
            continue
          if data == "[DONE]":
            break
          try:
            yield json.loads(data)
          except json.JSONDecodeError as exc:
            raise ProviderRequestError(f"Invalid SSE chunk from upstream provider: {exc}") from exc
    except httpx.RequestError as exc:
      raise self._to_provider_request_error(exc, "/v1/chat/completions") from exc

  async def _json_or_raise(self, response: httpx.Response) -> dict[str, Any]:
    await self._raise_for_status(response)
    return response.json()

  async def _raise_for_status(self, response: httpx.Response) -> None:
    if response.is_success:
      return

    detail = f"Upstream LLM server returned HTTP {response.status_code}."
    body_bytes = await response.aread()
    try:
      payload = json.loads(body_bytes.decode("utf-8"))
    except ValueError:
      payload = None

    if isinstance(payload, dict):
      error = payload.get("error")
      if isinstance(error, dict) and error.get("message"):
        detail = str(error["message"])
      elif payload.get("message"):
        detail = str(payload["message"])

    raise ProviderRequestError(detail, status_code=response.status_code)

  def _headers(self) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if self._settings.provider_api_key:
      headers["Authorization"] = f"Bearer {self._settings.provider_api_key}"
    return headers

  def _to_provider_request_error(self, exc: httpx.RequestError, path: str) -> ProviderRequestError:
    base_url = str(self._client.base_url).rstrip("/")
    detail = f"Upstream LLM server is unreachable at {base_url}{path}: {exc}"
    return ProviderRequestError(detail, status_code=503)
