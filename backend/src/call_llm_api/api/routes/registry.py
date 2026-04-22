from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from call_llm_api.api.deps import get_agent_profile_service, get_model_registry_service
from call_llm_api.application.services.agent_profile_service import AgentProfileService
from call_llm_api.application.services.model_registry_service import ModelRegistryService
from call_llm_api.domain.models import (
  AgentFramework,
  AgentProfileRecord,
  AgentStrategyKind,
  ModelRegistryRecord,
)

router = APIRouter(tags=["registry"])


class ModelRegistryCreateRequest(BaseModel):
  name: str
  provider: str = "openai-compatible"
  base_url: str
  served_model_name: str
  api_type: str = "openai_compatible"
  api_key: str | None = None
  enabled: bool = True
  capabilities: dict[str, Any] = Field(default_factory=dict)
  default_params: dict[str, Any] = Field(default_factory=dict)
  metadata: dict[str, Any] = Field(default_factory=dict)
  model_id: str | None = None


class AgentProfileCreateRequest(BaseModel):
  name: str
  description: str | None = None
  strategy_kind: AgentStrategyKind = AgentStrategyKind.DIRECT
  framework: AgentFramework = AgentFramework.CUSTOM
  system_prompt: str | None = None
  tool_names: list[str] = Field(default_factory=list)
  retrieval_policy: dict[str, Any] = Field(default_factory=dict)
  generation_defaults: dict[str, Any] = Field(default_factory=dict)
  metadata: dict[str, Any] = Field(default_factory=dict)
  enabled: bool = True
  profile_id: str | None = None


@router.get("/registry/models", response_model=list[ModelRegistryRecord])
async def list_registry_models(
  service: ModelRegistryService = Depends(get_model_registry_service),
) -> list[ModelRegistryRecord]:
  return await service.list_registry_models()


@router.get("/registry/models/{model_id}", response_model=ModelRegistryRecord)
async def get_registry_model(
  model_id: str,
  service: ModelRegistryService = Depends(get_model_registry_service),
) -> ModelRegistryRecord:
  return await service.get_registry_model(model_id)


@router.post("/registry/models", response_model=ModelRegistryRecord)
async def create_registry_model(
  payload: ModelRegistryCreateRequest,
  service: ModelRegistryService = Depends(get_model_registry_service),
) -> ModelRegistryRecord:
  return await service.register_model(
    name=payload.name,
    provider=payload.provider,
    base_url=payload.base_url,
    served_model_name=payload.served_model_name,
    api_type=payload.api_type,
    api_key=payload.api_key,
    enabled=payload.enabled,
    capabilities=payload.capabilities,
    default_params=payload.default_params,
    metadata=payload.metadata,
    model_id=payload.model_id,
  )


@router.post("/registry/models/{model_id}/probe", response_model=ModelRegistryRecord)
async def probe_registry_model(
  model_id: str,
  service: ModelRegistryService = Depends(get_model_registry_service),
) -> ModelRegistryRecord:
  return await service.probe_model(model_id)


@router.get("/agent-profiles", response_model=list[AgentProfileRecord])
async def list_agent_profiles(
  service: AgentProfileService = Depends(get_agent_profile_service),
) -> list[AgentProfileRecord]:
  return await service.list_agent_profiles()


@router.get("/agent-profiles/{profile_id}", response_model=AgentProfileRecord)
async def get_agent_profile(
  profile_id: str,
  service: AgentProfileService = Depends(get_agent_profile_service),
) -> AgentProfileRecord:
  return await service.get_agent_profile(profile_id)


@router.post("/agent-profiles", response_model=AgentProfileRecord)
async def create_agent_profile(
  payload: AgentProfileCreateRequest,
  service: AgentProfileService = Depends(get_agent_profile_service),
) -> AgentProfileRecord:
  return await service.create_agent_profile(
    name=payload.name,
    description=payload.description,
    strategy_kind=payload.strategy_kind,
    framework=payload.framework,
    system_prompt=payload.system_prompt,
    tool_names=payload.tool_names,
    retrieval_policy=payload.retrieval_policy,
    generation_defaults=payload.generation_defaults,
    metadata=payload.metadata,
    enabled=payload.enabled,
    profile_id=payload.profile_id,
  )
