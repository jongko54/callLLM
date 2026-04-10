from typing import Any, Protocol


class TaskQueue(Protocol):
  async def enqueue_thread_run(self, payload: dict[str, Any]) -> str: ...

  async def close(self) -> None: ...
