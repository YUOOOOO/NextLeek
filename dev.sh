#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

mkdir -p data

if command -v uv >/dev/null 2>&1; then
  (cd backend && uv sync --extra dev && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 3018) &
else
  python3 -m pip install -e "./backend[dev]"
  (cd backend && python3 -m uvicorn app.main:app --reload --host 127.0.0.1 --port 3018) &
fi
BACKEND_PID=$!

if command -v pnpm >/dev/null 2>&1; then
  (cd frontend && pnpm install && pnpm dev) &
else
  (cd frontend && npm install && npm run dev) &
fi
FRONTEND_PID=$!

trap 'kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true' EXIT INT TERM
wait
