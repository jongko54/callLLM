import asyncio
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
    path = "/v1/chat/completions"
    last_error: ProviderRequestError | None = None
    for attempt in range(self._settings.upstream_retry_attempts):
      try:
        response = await self._client.post(
          path,
          headers=self._headers(),
          json=payload,
        )
        return await self._json_or_raise(response)
      except httpx.RequestError as exc:
        error = self._to_provider_request_error(exc, path)
      except ProviderRequestError as exc:
        error = exc
      last_error = error

      if not self._should_retry(error, attempt):
        raise error from None
      await asyncio.sleep(self._retry_delay_seconds(error, attempt))

    raise last_error or RuntimeError("Missing upstream retry error")

  async def close(self) -> None:
    await self._client.aclose()

  async def forward_chat_completion_stream(self, payload: dict) -> AsyncIterator[bytes]:
    stream_payload = {**payload, "stream": True}
    path = "/v1/chat/completions"
    last_error: ProviderRequestError | None = None
    for attempt in range(self._settings.upstream_retry_attempts):
      try:
        async with self._client.stream(
          "POST",
          path,
          headers=self._headers(),
          json=stream_payload,
        ) as response:
          await self._raise_for_status(response)
          async for chunk in response.aiter_bytes():
            if chunk:
              yield chunk
          return
      except httpx.RequestError as exc:
        error = self._to_provider_request_error(exc, path)
      except ProviderRequestError as exc:
        error = exc
      last_error = error

      if not self._should_retry(error, attempt):
        raise error from None
      await asyncio.sleep(self._retry_delay_seconds(error, attempt))

    raise last_error or RuntimeError("Missing upstream retry error")

  async def stream_chat_completion_chunks(self, payload: dict) -> AsyncIterator[dict[str, Any]]:
    stream_payload = {**payload, "stream": True}
    path = "/v1/chat/completions"
    last_error: ProviderRequestError | None = None
    for attempt in range(self._settings.upstream_retry_attempts):
      try:
        async with self._client.stream(
          "POST",
          path,
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
          return
      except httpx.RequestError as exc:
        error = self._to_provider_request_error(exc, path)
      except ProviderRequestError as exc:
        error = exc
      last_error = error

      if not self._should_retry(error, attempt):
        raise error from None
      await asyncio.sleep(self._retry_delay_seconds(error, attempt))

    raise last_error or RuntimeError("Missing upstream retry error")

  async def _json_or_raise(self, response: httpx.Response) -> dict[str, Any]:
    await self._raise_for_status(response)
    return response.json()

  async def _raise_for_status(self, response: httpx.Response) -> None:
    if response.is_success:
      return

    detail = f"Upstream LLM server returned HTTP {response.status_code}."
    retry_after_seconds: float | None = None
    body_bytes = await response.aread()
    try:
      payload = json.loads(body_bytes.decode("utf-8"))
    except ValueError:
      payload = None

    if isinstance(payload, dict):
      error = payload.get("error")
      if isinstance(error, dict) and error.get("message"):
        detail = str(error["message"])
        retry_after = error.get("retry_after_seconds")
        if isinstance(retry_after, int | float):
          retry_after_seconds = float(retry_after)
      elif payload.get("message"):
        detail = str(payload["message"])

    raise ProviderRequestError(
      detail,
      status_code=response.status_code,
      retry_after_seconds=retry_after_seconds,
    )

  def _headers(self) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if self._settings.provider_api_key:
      headers["Authorization"] = f"Bearer {self._settings.provider_api_key}"
    return headers

  def _should_retry(self, error: ProviderRequestError, attempt: int) -> bool:
    if attempt >= self._settings.upstream_retry_attempts - 1:
      return False
    if error.status_code not in {502, 503, 504}:
      return False
    detail = error.message.lower()
    transient_markers = (
      "already in progress",
      "retry later",
      "unreachable",
      "temporarily unavailable",
      "timed out",
      "connection",
    )
    return any(marker in detail for marker in transient_markers)

  def _retry_delay_seconds(self, error: ProviderRequestError, attempt: int) -> float:
    if error.retry_after_seconds is not None and error.retry_after_seconds > 0:
      return error.retry_after_seconds
    delay = self._settings.upstream_retry_initial_delay_seconds
    if attempt <= 0:
      return delay
    return delay * (self._settings.upstream_retry_backoff_multiplier ** attempt)

  def _to_provider_request_error(self, exc: httpx.RequestError, path: str) -> ProviderRequestError:
    base_url = str(self._client.base_url).rstrip("/")
    detail = f"Upstream LLM server is unreachable at {base_url}{path}: {exc}"
    return ProviderRequestError(detail, status_code=503)
