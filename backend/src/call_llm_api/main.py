from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from call_llm_api.api import api_router
from call_llm_api.core.config import get_settings
from call_llm_api.core.runtime import build_container, close_container
from call_llm_api.domain.errors import BadRequestError, NotFoundError, ProviderRequestError, ToolExecutionError


@asynccontextmanager
async def lifespan(app: FastAPI):
  app.state.container = await build_container(get_settings())
  try:
    yield
  finally:
    await close_container(app.state.container)


settings = get_settings()
app = FastAPI(
  title=settings.app_name,
  version="0.1.0",
  lifespan=lifespan,
)

app.add_middleware(
  CORSMiddleware,
  allow_origins=settings.allowed_origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)


@app.exception_handler(ProviderRequestError)
async def provider_request_error_handler(_, exc: ProviderRequestError) -> JSONResponse:
  return JSONResponse(status_code=exc.status_code, content={"error": {"message": exc.message}})


@app.exception_handler(NotFoundError)
async def not_found_error_handler(_, exc: NotFoundError) -> JSONResponse:
  return JSONResponse(status_code=404, content={"error": {"message": exc.message}})


@app.exception_handler(BadRequestError)
async def bad_request_error_handler(_, exc: BadRequestError) -> JSONResponse:
  return JSONResponse(status_code=400, content={"error": {"message": exc.message}})


@app.exception_handler(ToolExecutionError)
async def tool_execution_error_handler(_, exc: ToolExecutionError) -> JSONResponse:
  return JSONResponse(status_code=400, content={"error": {"message": exc.message}})


@app.get("/", include_in_schema=False)
async def root_redirect() -> RedirectResponse:
  return RedirectResponse(url=f"{settings.frontend_mount_path}/")


@app.get("/ui", include_in_schema=False)
async def ui_redirect() -> RedirectResponse:
  return RedirectResponse(url=f"{settings.frontend_mount_path}/")


@app.get("/ui/index.html", include_in_schema=False)
async def ui_index() -> FileResponse:
  return FileResponse(settings.frontend_dir / "index.html")


app.mount(
  settings.frontend_mount_path,
  StaticFiles(directory=settings.frontend_dir, html=True),
  name="frontend",
)
