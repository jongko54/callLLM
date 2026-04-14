from call_llm_api.application.services.agent_service import AgentService
from call_llm_api.application.services.benchmark_service import BenchmarkService
from fastapi import Depends, Request

from call_llm_api.application.services.response_service import ResponseService
from call_llm_api.core.container import AppContainer


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


def get_benchmark_service(container: AppContainer = Depends(get_container)) -> BenchmarkService:
  return BenchmarkService(
    model_registry_repository=container.model_registry_repository,
    agent_profile_repository=container.agent_profile_repository,
    benchmark_suite_repository=container.benchmark_suite_repository,
    benchmark_run_repository=container.benchmark_run_repository,
    tool_registry=container.tool_registry,
    settings=container.settings,
  )
