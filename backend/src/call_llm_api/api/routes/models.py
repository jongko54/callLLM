from fastapi import APIRouter, Depends

from call_llm_api.api.deps import get_container
from call_llm_api.core.container import AppContainer

router = APIRouter(tags=["models"])


@router.get("/models")
async def list_models(container: AppContainer = Depends(get_container)) -> dict:
  return await container.llm_client.list_models()
