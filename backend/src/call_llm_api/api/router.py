from fastapi import APIRouter

from call_llm_api.api.routes import benchmarks, chat, health, models, registry, responses, runs, threads, tools

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(models.router, prefix="/v1")
api_router.include_router(registry.router, prefix="/v1")
api_router.include_router(benchmarks.router, prefix="/v1")
api_router.include_router(chat.router, prefix="/v1")
api_router.include_router(responses.router, prefix="/v1")
api_router.include_router(runs.router, prefix="/v1")
api_router.include_router(threads.router, prefix="/v1")
api_router.include_router(tools.router, prefix="/v1")
