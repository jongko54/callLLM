from datetime import UTC, datetime
from uuid import uuid4

from call_llm_api.domain.errors import BadRequestError, NotFoundError
from call_llm_api.domain.models import (
  AgentFramework,
  AgentProfileRecord,
  AgentStrategyKind,
  ModelRegistryRecord,
)
from call_llm_api.infrastructure.persistence.base import AgentProfileRepository


class AgentProfileService:
  def __init__(
    self,
    *,
    agent_profile_repository: AgentProfileRepository,
  ) -> None:
    self._agent_profile_repository = agent_profile_repository

  async def list_agent_profiles(self) -> list[AgentProfileRecord]:
    return await self._agent_profile_repository.list_profiles()

  async def get_agent_profile(self, profile_id: str) -> AgentProfileRecord:
    profile = await self._agent_profile_repository.get(profile_id)
    if profile is None:
      raise NotFoundError(f"Agent profile '{profile_id}' was not found.")
    return profile

  async def create_agent_profile(
    self,
    *,
    name: str,
    description: str | None,
    strategy_kind: AgentStrategyKind | str,
    framework: AgentFramework | str,
    system_prompt: str | None,
    tool_names: list[str] | None,
    retrieval_policy: dict | None,
    generation_defaults: dict | None,
    metadata: dict | None,
    enabled: bool,
    profile_id: str | None = None,
  ) -> AgentProfileRecord:
    now = datetime.now(UTC)
    existing = None
    if profile_id:
      existing = await self._agent_profile_repository.get(profile_id)

    profile = AgentProfileRecord(
      id=profile_id or uuid4().hex,
      name=name,
      description=description,
      strategy_kind=strategy_kind,
      framework=framework,
      system_prompt=system_prompt,
      tool_names=tool_names or [],
      retrieval_policy=retrieval_policy or {},
      generation_defaults=generation_defaults or {},
      metadata=metadata or {},
      enabled=enabled,
      created_at=existing.created_at if existing else now,
      updated_at=now,
    )
    return await self._agent_profile_repository.save(profile)

  @staticmethod
  def ensure_model_supports_profile(model: ModelRegistryRecord, profile: AgentProfileRecord) -> None:
    requires_tool_calling = (
      profile.strategy_kind == AgentStrategyKind.TOOL
      or bool(profile.tool_names)
      or bool(profile.metadata.get("requires_tool_calling"))
    )
    if requires_tool_calling and model.capabilities.get("tool_calling") is not True:
      raise BadRequestError(
        f"Model '{model.name}' is not configured for tool calling. "
        "Enable auto tool calling on the upstream model server or choose a direct/RAG profile."
      )
