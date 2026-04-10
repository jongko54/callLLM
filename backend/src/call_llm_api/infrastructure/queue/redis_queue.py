import json
from uuid import uuid4

from redis.asyncio import Redis

from call_llm_api.core.config import Settings


class RedisTaskQueue:
  def __init__(self, settings: Settings) -> None:
    self._settings = settings
    self._client = Redis.from_url(settings.redis_url, decode_responses=True)

  async def enqueue_thread_run(self, payload: dict) -> str:
    job_id = uuid4().hex
    envelope = {"job_id": job_id, **payload}
    await self._client.rpush(self._settings.redis_queue_name, json.dumps(envelope, ensure_ascii=False))
    return job_id

  async def dequeue_thread_run(self, *, timeout_seconds: int = 0) -> dict | None:
    item = await self._client.blpop(self._settings.redis_queue_name, timeout=timeout_seconds)
    if item is None:
      return None
    _, payload = item
    return json.loads(payload)

  async def close(self) -> None:
    await self._client.aclose()
