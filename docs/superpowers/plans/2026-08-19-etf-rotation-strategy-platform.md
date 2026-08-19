# ETF Rotation Strategy Platform Implementation Plan

> **Status:** implemented (AI tools deferred)

**Goal:** Ship `strategy-api` (Python WFO→VEC→BT+signal) + Express BFF + minimal Vue page; no AI wiring.

**Architecture:** Browser → Express `/api/strategy/*` → strategy-api `:8001`

## Delivered

### strategy-api (`strategy-api/`)
- `configs/config.yaml` — ~49 pool, FREQ=5, POS=2, Exp4 hysteresis, sealed combos
- `src/data/` — AkShare updater + parquet loader (zhangsensen-compatible schema)
- `src/engine/` — factors, hysteresis, rebalance, regime, vec/bt, wfo, signal, pipeline
- `src/jobs/runner.py` — single-worker async jobs + disk artifacts
- `src/main.py` — FastAPI routes per design spec
- Port **8001**

### Express BFF
- `server/src/services/strategyApi.ts`
- `server/src/controllers/strategy.controller.ts`
- Routes under `/api/strategy/*`

### Frontend
- `frontend/src/pages/rotation/index.vue`
- Router `/` → `/rotation`

### Docs / ignore
- README updated
- `.gitignore` strategy data + `_tmp_etf_rot`

## Smoke (2026-08-19)

- Engine offline (synthetic 8-ETF parquet): VEC/BT/WFO/signal OK
- `strategy-api` HTTP: health/universe/jobs/result OK
- Express proxy: `/api/strategy/*` + create signal job OK

## Out of scope (this pass)
- AI tools for signal explanation
- Real Eastmoney full-pool download reliability
- GPU/Numba parity / Backtrader full port
