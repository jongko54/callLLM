from collections.abc import Callable

from call_llm_api.core.config import Settings
from call_llm_api.domain.models import ModelRegistryRecord
from call_llm_api.infrastructure.llm.base import LLMProvider
from call_llm_api.infrastructure.llm.openai_compatible import OpenAICompatibleClient

ModelClientFactory = Callable[[ModelRegistryRecord], LLMProvider]


def build_openai_compatible_client_for_model(
  *,
  model: ModelRegistryRecord,
  settings: Settings,
) -> OpenAICompatibleClient:
  effective_settings = settings.model_copy(
    update={
      "provider_base_url": model.base_url,
      "provider_api_key": model.api_key or settings.provider_api_key,
      "default_model": model.served_model_name,
    }
  )
  return OpenAICompatibleClient(effective_settings)
