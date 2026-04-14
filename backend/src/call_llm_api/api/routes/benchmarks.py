from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from call_llm_api.api.deps import get_benchmark_service
from call_llm_api.application.services.benchmark_service import BenchmarkService
from call_llm_api.domain.models import (
  BenchmarkCaseRecord,
  BenchmarkCaseResultRecord,
  BenchmarkHistoryEntryRecord,
  BenchmarkRunRecord,
  BenchmarkSuiteStatus,
  BenchmarkSuiteRecord,
  ChatMessage,
)

router = APIRouter(tags=["benchmarks"])


class BenchmarkSuiteCreateRequest(BaseModel):
  name: str
  version: str = "1"
  description: str | None = None
  tags: list[str] = Field(default_factory=list)
  status: BenchmarkSuiteStatus = BenchmarkSuiteStatus.DRAFT
  metadata: dict[str, Any] = Field(default_factory=dict)
  suite_id: str | None = None


class BenchmarkCaseCreateRequest(BaseModel):
  name: str
  slug: str | None = None
  input_messages: list[ChatMessage] = Field(default_factory=list)
  expected_output: dict[str, Any] = Field(default_factory=dict)
  rubric: dict[str, Any] = Field(default_factory=dict)
  metadata: dict[str, Any] = Field(default_factory=dict)
  enabled: bool = True
  case_id: str | None = None


class BenchmarkRunCreateRequest(BaseModel):
  suite_id: str
  model_id: str
  agent_profile_id: str
  params: dict[str, Any] = Field(default_factory=dict)


class BenchmarkRunExecutionResponse(BaseModel):
  run: BenchmarkRunRecord
  results: list[BenchmarkCaseResultRecord]


@router.get("/benchmark-suites", response_model=list[BenchmarkSuiteRecord])
async def list_benchmark_suites(
  service: BenchmarkService = Depends(get_benchmark_service),
) -> list[BenchmarkSuiteRecord]:
  return await service.list_benchmark_suites()


@router.get("/benchmark-suites/{suite_id}", response_model=BenchmarkSuiteRecord)
async def get_benchmark_suite(
  suite_id: str,
  service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkSuiteRecord:
  return await service.get_benchmark_suite(suite_id)


@router.post("/benchmark-suites", response_model=BenchmarkSuiteRecord)
async def create_benchmark_suite(
  payload: BenchmarkSuiteCreateRequest,
  service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkSuiteRecord:
  return await service.create_benchmark_suite(
    name=payload.name,
    version=payload.version,
    description=payload.description,
    tags=payload.tags,
    status=payload.status,
    metadata=payload.metadata,
    suite_id=payload.suite_id,
  )


@router.get("/benchmark-suites/{suite_id}/cases", response_model=list[BenchmarkCaseRecord])
async def list_benchmark_cases(
  suite_id: str,
  service: BenchmarkService = Depends(get_benchmark_service),
) -> list[BenchmarkCaseRecord]:
  return await service.list_benchmark_cases(suite_id)


@router.post("/benchmark-suites/{suite_id}/cases", response_model=BenchmarkCaseRecord)
async def create_benchmark_case(
  suite_id: str,
  payload: BenchmarkCaseCreateRequest,
  service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkCaseRecord:
  return await service.add_benchmark_case(
    suite_id=suite_id,
    name=payload.name,
    slug=payload.slug,
    input_messages=payload.input_messages,
    expected_output=payload.expected_output,
    rubric=payload.rubric,
    metadata=payload.metadata,
    enabled=payload.enabled,
    case_id=payload.case_id,
  )


@router.get("/benchmark-runs", response_model=list[BenchmarkRunRecord])
async def list_benchmark_runs(
  service: BenchmarkService = Depends(get_benchmark_service),
) -> list[BenchmarkRunRecord]:
  return await service.list_benchmark_runs()


@router.get("/benchmark-history", response_model=list[BenchmarkHistoryEntryRecord])
async def list_benchmark_history(
  limit: int = Query(default=6, ge=1, le=20),
  service: BenchmarkService = Depends(get_benchmark_service),
) -> list[BenchmarkHistoryEntryRecord]:
  return await service.list_benchmark_history(limit=limit)


@router.get("/benchmark-runs/{run_id}", response_model=BenchmarkRunRecord)
async def get_benchmark_run(
  run_id: str,
  service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkRunRecord:
  return await service.get_benchmark_run(run_id)


@router.post("/benchmark-runs", response_model=BenchmarkRunRecord)
async def create_benchmark_run(
  payload: BenchmarkRunCreateRequest,
  service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkRunRecord:
  return await service.create_benchmark_run(
    suite_id=payload.suite_id,
    model_id=payload.model_id,
    agent_profile_id=payload.agent_profile_id,
    params=payload.params,
  )


@router.get("/benchmark-runs/{run_id}/results", response_model=list[BenchmarkCaseResultRecord])
async def list_benchmark_run_results(
  run_id: str,
  service: BenchmarkService = Depends(get_benchmark_service),
) -> list[BenchmarkCaseResultRecord]:
  return await service.list_benchmark_run_results(run_id)


@router.post("/benchmark-runs/{run_id}/execute", response_model=BenchmarkRunExecutionResponse)
async def execute_benchmark_run(
  run_id: str,
  service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkRunExecutionResponse:
  run = await service.execute_benchmark_run(run_id)
  results = await service.list_benchmark_run_results(run_id)
  return BenchmarkRunExecutionResponse(run=run, results=results)
