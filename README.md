# callLLM

`callLLM` now includes an agent-ready backend skeleton built with FastAPI.

## What is included

- Layered backend package under `backend/src/call_llm_api`
- OpenAI-compatible provider adapter for local or hosted LLM gateways
- SQLAlchemy-backed persistence with SQLite as the local default
- Postgres-ready database configuration through `CALL_LLM_DATABASE_URL`
- Built-in tool registry with sample tools for agent runs
- Thread and run primitives for agent-oriented workflows
- Inline async execution for local development and Redis queue scaffolding for workers
- API routes for:
  - `GET /api/health`
  - `GET /api/v1/models`
  - `GET /api/v1/tools`
  - `POST /api/v1/chat/completions`
  - `POST /api/v1/responses`
  - `POST /api/v1/threads`
  - `GET /api/v1/threads`
  - `POST /api/v1/threads/{thread_id}/messages`
  - `POST /api/v1/threads/{thread_id}/runs`
  - `POST /api/v1/threads/{thread_id}/runs/stream`
  - `GET /api/v1/runs`
  - `GET /api/v1/runs/{run_id}`
- Existing chat UI served from `http://127.0.0.1:8000/ui/`

## Quick start

```bash
cd /Users/jongho/workspace/callLLM
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn call_llm_api.main:app --app-dir backend/src --reload
```

Open:

- UI: `http://127.0.0.1:8000/ui/`
- Docs: `http://127.0.0.1:8000/docs`

## UI target selection

- The chat UI now prefers the local backend proxy at `http://127.0.0.1:8000/api`.
- If the backend is not available, it falls back to a direct OpenAI-compatible endpoint such as `http://127.0.0.1:8001`.
- For the remote `app-b` Qwen deployment on `116.37.208.45`, expose it locally first with:

```bash
ssh -N -L 18001:qwen3-8b-int4.10.31.3.229.nip.io:80 -p 9454 evo@116.37.208.45
```

- Then run the local backend with `CALL_LLM_PROVIDER_BASE_URL=http://127.0.0.1:18001`, or open the static UI with `?apiBase=http://127.0.0.1:18001`.
- To force a specific target, open the UI with a query parameter such as:

```text
http://127.0.0.1:5500/?apiBase=http://127.0.0.1:1234
```

- Optional direct API key override:

```text
http://127.0.0.1:5500/?apiBase=http://127.0.0.1:1234&apiKey=YOUR_KEY
```

## Persistence and queueing

- Local default: SQLite via SQLAlchemy
- Production recommendation: Postgres by setting `CALL_LLM_DATABASE_URL`
- Local async runs: `CALL_LLM_QUEUE_BACKEND=inline`
- Redis-backed worker mode: set `CALL_LLM_QUEUE_BACKEND=redis`, then run:

```bash
python -m call_llm_api.workers.redis_worker
```

Example Postgres URL:

```bash
pip install -e ".[dev,postgres]"
CALL_LLM_DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/call_llm
```

## Recommended next steps

1. Add Alembic migrations instead of relying on auto-create schema.
2. Add auth, rate limits, and tenant-aware model routing.
3. Persist richer run events and tool traces for replay and auditing.
4. Add provider-specific adapters for OpenAI, Anthropic, and Gemini.
5. Replace demo tools with real internal tools and permissioning.

## Project shape

```text
backend/src/call_llm_api
  api/
  application/
  core/
  domain/
  infrastructure/
  workers/
instagram-post-clone/
```

## Notes

- The backend currently proxies to an OpenAI-compatible upstream server.
- The default database is a local SQLite file under `storage/`.
- Async agent runs work locally with in-process background tasks and can be moved to Redis workers later.
- The `/threads/{thread_id}/runs/stream` endpoint is for realtime text streaming without tools.
- The `POST /api/v1/responses` endpoint is the better long-term contract.
- The `POST /api/v1/chat/completions` route is included to keep the existing UI working during the transition.
