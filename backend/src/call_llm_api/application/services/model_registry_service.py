from datetime import UTC, datetime
from uuid import uuid4

from call_llm_api.application.services.model_client_factory import (
  ModelClientFactory,
  build_openai_compatible_client_for_model,
)
from call_llm_api.core.config import Settings
from call_llm_api.domain.errors import NotFoundError, ProviderRequestError
from call_llm_api.domain.models import ModelHealthStatus, ModelRegistryRecord
from call_llm_api.infrastructure.llm.base import LLMProvider
from call_llm_api.infrastructure.persistence.base import ModelRegistryRepository


class ModelRegistryService:
  def __init__(
    self,
    *,
    model_registry_repository: ModelRegistryRepository,
    settings: Settings,
    client_factory: ModelClientFactory | None = None,
  ) -> None:
    self._model_registry_repository = model_registry_repository
    self._settings = settings
    self._client_factory = client_factory

  async def list_registry_models(self) -> list[ModelRegistryRecord]:
    return await self._model_registry_repository.list_models()

  async def get_registry_model(self, model_id: str) -> ModelRegistryRecord:
    model = await self._model_registry_repository.get(model_id)
    if model is None:
      raise NotFoundError(f"Model '{model_id}' was not found.")
    return model

  async def register_model(
    self,
    *,
    name: str,
    provider: str,
    base_url: str,
    served_model_name: str,
    api_type: str,
    api_key: str | None,
    enabled: bool,
    capabilities: dict | None,
    default_params: dict | None,
    metadata: dict | None,
    model_id: str | None = None,
  ) -> ModelRegistryRecord:
    now = datetime.now(UTC)
    existing = None
    if model_id:
      existing = await self._model_registry_repository.get(model_id)

    record = ModelRegistryRecord(
      id=model_id or uuid4().hex,
      name=name,
      provider=provider,
      base_url=base_url,
      served_model_name=served_model_name,
      api_type=api_type,
      api_key=api_key,
      enabled=enabled,
      health_status=existing.health_status if existing else ModelHealthStatus.UNKNOWN,
      capabilities=capabilities or {},
      default_params=default_params or {},
      metadata=metadata or {},
      created_at=existing.created_at if existing else now,
      updated_at=now,
    )
    return await self._model_registry_repository.save(record)

  async def probe_model(self, model_id: str) -> ModelRegistryRecord:
    model = await self.get_registry_model(model_id)
    client = self._build_client_for_model(model)
    try:
      payload = await client.list_models()
      upstream_models = [
        item.get("id")
        for item in payload.get("data", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
      ]
      health = ModelHealthStatus.HEALTHY if model.served_model_name in upstream_models else ModelHealthStatus.UNAVAILABLE
      probed = model.model_copy(
        update={
          "health_status": health,
          "metadata": {
            **model.metadata,
            "last_probe_at": datetime.now(UTC).isoformat(),
            "last_probe_models": upstream_models,
          },
          "updated_at": datetime.now(UTC),
        }
      )
      return await self._model_registry_repository.save(probed)
    except ProviderRequestError as exc:
      failed = model.model_copy(
        update={
          "health_status": ModelHealthStatus.UNAVAILABLE,
          "metadata": {
            **model.metadata,
            "last_probe_at": datetime.now(UTC).isoformat(),
            "last_probe_error": exc.message,
          },
          "updated_at": datetime.now(UTC),
        }
      )
      return await self._model_registry_repository.save(failed)
    finally:
      await client.close()

  def _build_client_for_model(self, model: ModelRegistryRecord) -> LLMProvider:
    if self._client_factory is not None:
      return self._client_factory(model)
    return build_openai_compatible_client_for_model(model=model, settings=self._settings)
