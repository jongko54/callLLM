from fastapi import APIRouter, Depends

from call_llm_api.api.deps import get_container
from call_llm_api.core.container import AppContainer
from call_llm_api.domain.errors import NotFoundError
from call_llm_api.domain.models import RunRecord

router = APIRouter(tags=["runs"])


@router.get("/runs", response_model=list[RunRecord])
async def list_runs(container: AppContainer = Depends(get_container)) -> list[RunRecord]:
  return await container.run_repository.list_runs()


@router.get("/runs/{run_id}", response_model=RunRecord)
async def get_run(run_id: str, container: AppContainer = Depends(get_container)) -> RunRecord:
  run = await container.run_repository.get(run_id)
  if run is None:
    raise NotFoundError(f"Run '{run_id}' was not found.")
  return run
