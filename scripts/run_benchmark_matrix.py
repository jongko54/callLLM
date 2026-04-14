#!/usr/bin/env python3

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime

from call_llm_api.application.services.benchmark_service import BenchmarkService
from call_llm_api.core.runtime import build_container, close_container
from call_llm_api.domain.models import ChatMessage


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(description="Run an ad-hoc benchmark matrix across models and agent profiles.")
  parser.add_argument("--model-id", action="append", dest="model_ids", required=True, help="Registry model id to run.")
  parser.add_argument("--profile-id", action="append", dest="profile_ids", required=True, help="Agent profile id to run.")
  parser.add_argument("--prompt", required=True, help="User prompt to benchmark.")
  parser.add_argument("--expected-contains", default="", help="Optional phrase that should appear in the answer.")
  parser.add_argument(
    "--context-document",
    action="append",
    dest="context_documents",
    default=[],
    help="Optional RAG context document. Repeat for multiple values.",
  )
  parser.add_argument("--temperature", type=float, default=0.2, help="Temperature to pass to benchmark runs.")
  parser.add_argument("--max-steps", type=int, default=4, help="Max tool/graph steps to allow.")
  parser.add_argument("--suite-name", default="", help="Optional suite display name.")
  return parser


async def main() -> None:
  args = build_parser().parse_args()
  container = await build_container()
  service = BenchmarkService(
    model_registry_repository=container.model_registry_repository,
    agent_profile_repository=container.agent_profile_repository,
    benchmark_suite_repository=container.benchmark_suite_repository,
    benchmark_run_repository=container.benchmark_run_repository,
    tool_registry=container.tool_registry,
    settings=container.settings,
  )

  suite_name = args.suite_name or f"CLI Benchmark {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
  suite = await service.create_benchmark_suite(
    name=suite_name,
    version="1",
    description="CLI ad-hoc benchmark matrix run.",
    tags=["cli", "matrix"],
    status="draft",
    metadata={"source": "scripts/run_benchmark_matrix.py"},
  )
  await service.add_benchmark_case(
    suite_id=suite.id,
    name="CLI benchmark prompt",
    slug=None,
    input_messages=[ChatMessage(role="user", content=args.prompt)],
    expected_output={"contains": args.expected_contains} if args.expected_contains else {},
    rubric={"mode": "contains-check"},
    metadata={"context_documents": args.context_documents},
    enabled=True,
  )

  results: list[dict] = []
  try:
    for model_id in args.model_ids:
      model = await service.get_registry_model(model_id)
      for profile_id in args.profile_ids:
        profile = await service.get_agent_profile(profile_id)
        run = await service.create_benchmark_run(
          suite_id=suite.id,
          model_id=model_id,
          agent_profile_id=profile_id,
          params={
            "temperature": args.temperature,
            "max_steps": args.max_steps,
          },
        )
        completed_run = await service.execute_benchmark_run(run.id)
        case_results = await service.list_benchmark_run_results(run.id)
        first_result = case_results[0] if case_results else None
        results.append(
          {
            "model_id": model_id,
            "model_name": model.name,
            "profile_id": profile_id,
            "profile_name": profile.name,
            "framework": profile.framework.value,
            "strategy": profile.strategy_kind.value,
            "run_status": completed_run.status.value,
            "summary": completed_run.summary,
            "result_status": first_result.status.value if first_result else None,
            "latency_ms": first_result.latency_ms if first_result else None,
            "output_text": first_result.output_text if first_result else None,
            "error": first_result.error if first_result else completed_run.error,
          }
        )
  finally:
    await close_container(container)

  print(json.dumps({"suite_id": suite.id, "results": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
  asyncio.run(main())
