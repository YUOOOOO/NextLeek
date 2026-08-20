from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import load_config, reload_config, tradeable_symbols
from .jobs.runner import get_job, get_result, list_jobs, submit_job
from .paths import CONFIG_PATH, JOBS_DIR, SIGNAL_STATE_PATH, ensure_data_dirs


def _shadow_strategies() -> list[dict[str, Any]]:
    path = CONFIG_PATH.parent / "shadow_strategies.yaml"
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return list(raw.get("shadow_strategies", []))


def _signal_state() -> dict[str, Any]:
    if not SIGNAL_STATE_PATH.exists():
        return {}
    return json.loads(SIGNAL_STATE_PATH.read_text(encoding="utf-8"))


def _strategy_id(strategy: dict[str, Any]) -> str:
    return str(strategy.get("name") or strategy.get("id") or strategy.get("combo") or "unknown")


def _factor_signs(factors: list[str]) -> dict[str, int]:
    try:
        from .etf_strategy.core.factor_registry import get_factor_direction
    except ImportError:
        return {factor: 1 for factor in factors}
    return {
        factor: -1 if get_factor_direction(factor) == "low_is_good" else 1
        for factor in factors
    }

app = FastAPI(title="NextLeek Strategy API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobCreate(BaseModel):
    type: str = Field(..., description="update-data|wfo|vec|bt|pipeline|signal")
    params: Optional[dict[str, Any]] = None


@app.on_event("startup")
def _startup() -> None:
    ensure_data_dirs()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "strategy-api"}


@app.get("/api/universe")
def universe() -> dict[str, Any]:
    cfg = load_config()
    return {
        "mode": cfg.get("universe", {}).get("mode", "A_SHARE_ONLY"),
        "qdii_tickers": cfg.get("universe", {}).get("qdii_tickers", []),
        "symbols": cfg.get("data", {}).get("symbols", []),
        "tradeable": tradeable_symbols(cfg),
        "active_factors": cfg.get("active_factors", []),
        "backtest": {
            "freq": cfg.get("backtest", {}).get("freq"),
            "pos_size": cfg.get("backtest", {}).get("pos_size"),
            "lookback_window": cfg.get("backtest", {}).get("lookback_window"),
            "hysteresis": cfg.get("backtest", {}).get("hysteresis", {}),
        },
    }


@app.get("/api/sealed")
def sealed() -> dict[str, Any]:
    strategies = _shadow_strategies()
    factors = sorted({
        factor
        for strategy in strategies
        for factor in str(strategy.get("combo", "")).split("+")
        if factor
    })
    return {
        "sealed": [
            {
                "id": _strategy_id(strategy),
                "name": strategy.get("name", _strategy_id(strategy)),
                "factors": [f.strip() for f in str(strategy.get("combo", "")).split("+") if f.strip()],
                "combo": strategy.get("combo"),
            }
            for strategy in strategies
        ],
        "factor_signs": _factor_signs(factors),
    }


@app.post("/api/jobs")
def create_job(body: JobCreate) -> dict[str, str]:
    allowed = {"update-data", "wfo", "vec", "bt", "pipeline", "signal"}
    if body.type not in allowed:
        raise HTTPException(status_code=400, detail=f"type must be one of {sorted(allowed)}")
    job_id = submit_job(body.type, body.params or {})
    return {"job_id": job_id}


@app.get("/api/jobs")
def jobs(limit: int = 50) -> dict[str, Any]:
    return {"items": list_jobs(limit=limit)}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    st = get_job(job_id)
    if not st:
        raise HTTPException(status_code=404, detail="job not found")
    return st


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: str) -> Any:
    st = get_job(job_id)
    if not st:
        raise HTTPException(status_code=404, detail="job not found")
    if st.get("status") != "succeeded":
        raise HTTPException(status_code=409, detail=f"job status is {st.get('status')}")
    result = get_result(job_id)
    if result is None:
        raise HTTPException(status_code=404, detail="result missing")
    return result


@app.get("/api/artifacts/{job_id}/{name:path}")
def artifact(job_id: str, name: str) -> FileResponse:
    job_dir = (JOBS_DIR / job_id).resolve()
    candidate = (job_dir / name).resolve()
    if job_dir not in candidate.parents or not candidate.is_file():
        raise HTTPException(status_code=404, detail="artifact not found")
    return FileResponse(candidate)


@app.get("/api/signal/latest")
def signal_latest() -> dict[str, Any]:
    ensure_data_dirs()
    state = _signal_state()
    if not state:
        return {"strategies": [], "note": "no signal_state yet; run job type=signal"}

    definitions = {
        _strategy_id(strategy): strategy
        for strategy in _shadow_strategies()
    }
    strategies = []
    signal_dates = [
        str(raw.get("last_signal_asof") or raw.get("last_seen_asof"))
        for raw in (state.get("strategies") or {}).values()
        if raw.get("last_signal_asof") or raw.get("last_seen_asof")
    ]
    asof = max(signal_dates) if signal_dates else state.get("last_asof_date")
    for sid, raw in (state.get("strategies") or {}).items():
        st = raw or {}
        definition = definitions.get(str(sid), {})
        holdings = [str(symbol) for symbol in st.get("signal_portfolio", st.get("holdings", []))]
        hold_days = {
            str(symbol): int(days)
            for symbol, days in (st.get("signal_hold_days", st.get("hold_days", {})) or {}).items()
        }
        actions = [
            {
                "symbol": symbol,
                "action": "current",
                "label": "当前持仓",
                "reason": "最新信号持仓",
                "hold_days": hold_days.get(symbol, 0),
            }
            for symbol in holdings
        ]
        strategies.append(
            {
                "strategy_id": str(sid),
                "name": definition.get("name", str(sid)),
                "factors": [
                    factor.strip()
                    for factor in str(definition.get("combo", str(sid))).split("+")
                    if factor.strip()
                ],
                "asof": asof,
                "summary": f"当前持仓 {len(holdings)} 只",
                "actions": actions,
                "holdings": holdings,
                "hold_days": hold_days,
                "last_rebalance": st.get("last_rebalance"),
                "generated_at": state.get("generated_at"),
            }
        )
    return {
        "version": state.get("version"),
        "freq": state.get("freq"),
        "asof": asof,
        "universe_mode": state.get("universe_mode"),
        "strategies": strategies,
    }



@app.post("/api/config/reload")
def config_reload() -> dict[str, str]:
    reload_config()
    return {"status": "reloaded"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8001, reload=True)
