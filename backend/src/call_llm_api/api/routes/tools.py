from fastapi import APIRouter, Depends

from call_llm_api.api.deps import get_container
from call_llm_api.core.container import AppContainer
from call_llm_api.domain.models import ToolDefinition

router = APIRouter(tags=["tools"])


@router.get("/tools", response_model=list[ToolDefinition])
async def list_tools(container: AppContainer = Depends(get_container)) -> list[ToolDefinition]:
  return container.tool_registry.list_definitions()
