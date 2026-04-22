from call_llm_api.application.services.agent_profile_service import AgentProfileService
from call_llm_api.application.services.agent_service import AgentService
from call_llm_api.application.services.benchmark_service import BenchmarkService
from call_llm_api.application.services.model_registry_service import ModelRegistryService
from call_llm_api.application.services.profile_response_service import ProfileResponseService
from fastapi import Depends, Request

from call_llm_api.application.services.response_service import ResponseService
from call_llm_api.core.container import AppContainer
from call_llm_api.infrastructure.grounding import OpenStreetMapLocationGrounder


def get_container(request: Request) -> AppContainer:
  return request.app.state.container


def get_response_service(container: AppContainer = Depends(get_container)) -> ResponseService:
  return ResponseService(
    llm_client=container.llm_client,
    run_repository=container.run_repository,
    settings=container.settings,
  )


def get_agent_service(container: AppContainer = Depends(get_container)) -> AgentService:
  return AgentService(
    llm_client=container.llm_client,
    run_repository=container.run_repository,
    thread_repository=container.thread_repository,
    tool_registry=container.tool_registry,
    settings=container.settings,
  )


def get_model_registry_service(container: AppContainer = Depends(get_container)) -> ModelRegistryService:
  return ModelRegistryService(
    model_registry_repository=container.model_registry_repository,
    settings=container.settings,
  )


def get_agent_profile_service(container: AppContainer = Depends(get_container)) -> AgentProfileService:
  return AgentProfileService(
    agent_profile_repository=container.agent_profile_repository,
  )


def get_profile_response_service(
  container: AppContainer = Depends(get_container),
  model_registry_service: ModelRegistryService = Depends(get_model_registry_service),
  agent_profile_service: AgentProfileService = Depends(get_agent_profile_service),
) -> ProfileResponseService:
  return ProfileResponseService(
    model_registry_service=model_registry_service,
    agent_profile_service=agent_profile_service,
    tool_registry=container.tool_registry,
    settings=container.settings,
    location_grounder=OpenStreetMapLocationGrounder(),
  )


def get_benchmark_service(
  container: AppContainer = Depends(get_container),
  model_registry_service: ModelRegistryService = Depends(get_model_registry_service),
  agent_profile_service: AgentProfileService = Depends(get_agent_profile_service),
) -> BenchmarkService:
  return BenchmarkService(
    model_registry_service=model_registry_service,
    agent_profile_service=agent_profile_service,
    benchmark_suite_repository=container.benchmark_suite_repository,
    benchmark_run_repository=container.benchmark_run_repository,
    tool_registry=container.tool_registry,
    settings=container.settings,
  )
