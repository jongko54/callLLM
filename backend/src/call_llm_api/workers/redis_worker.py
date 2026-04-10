import asyncio

from call_llm_api.application.services.agent_service import AgentService
from call_llm_api.core.config import get_settings
from call_llm_api.core.runtime import build_container, close_container
from call_llm_api.infrastructure.queue.redis_queue import RedisTaskQueue


async def run_worker() -> None:
  settings = get_settings()
  if settings.queue_backend != "redis":
    raise RuntimeError("Set CALL_LLM_QUEUE_BACKEND=redis before starting the Redis worker.")

  container = await build_container(settings)
  if not isinstance(container.task_queue, RedisTaskQueue):
    raise RuntimeError("Redis queue backend is not configured correctly.")

  service = AgentService(
    llm_client=container.llm_client,
    run_repository=container.run_repository,
    thread_repository=container.thread_repository,
    tool_registry=container.tool_registry,
    settings=container.settings,
  )

  try:
    while True:
      payload = await container.task_queue.dequeue_thread_run(timeout_seconds=1)
      if payload is None:
        await asyncio.sleep(0.25)
        continue

      await service.execute_thread_run(
        run_id=str(payload["run_id"]),
        tool_names=list(payload.get("tool_names") or []),
        max_steps=payload.get("max_steps"),
      )
  finally:
    await close_container(container)


def main() -> None:
  asyncio.run(run_worker())


if __name__ == "__main__":
  main()
