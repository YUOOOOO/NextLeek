from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import load_config, reload_config, tradeable_symbols
from .jobs.runner import get_job, get_result, list_jobs, submit_job
from .paths import SIGNAL_STATE_PATH, ensure_data_dirs
from .engine.signal import load_state

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
    cfg = load_config()
    return {
        "sealed": cfg.get("sealed", []),
        "factor_signs": cfg.get("factor_signs", {}),
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


@app.get("/api/signal/latest")
def signal_latest() -> dict[str, Any]:
    ensure_data_dirs()
    if not SIGNAL_STATE_PATH.exists():
        return {"strategies": [], "note": "no signal_state yet; run job type=signal"}

    state = load_state()
    active_strategy_ids = {s["id"] for s in load_config().get("sealed", [])}
    strategies = []
    signal_dates = []
    for sid, st in (state.get("strategies") or {}).items():
        if sid not in active_strategy_ids:
            continue
        holdings = list(st.get("holdings", []))
        hold_days = dict(st.get("hold_days", {}))
        actions = st.get("last_actions")
        if actions is None:
            actions = [
                {
                    "symbol": symbol,
                    "action": "current",
                    "label": "当前持仓",
                    "reason": "历史信号，无上期动作记录",
                    "hold_days": int(hold_days.get(symbol, 0)),
                }
                for symbol in holdings
            ]
        asof = st.get("last_signal_asof") or st.get("last_rebalance")
        if asof:
            signal_dates.append(asof)
        strategies.append(
            {
                "strategy_id": sid,
                "name": st.get("name", sid),
                "factors": st.get("factors", []),
                "asof": asof,
                "summary": st.get("last_summary")
                or f"当前持仓 {len(holdings)} 只",
                "actions": actions,
                "holdings": holdings,
                "hold_days": hold_days,
                "last_rebalance": st.get("last_rebalance"),
                "generated_at": st.get("last_generated_at"),
            }
        )
    return {
        "version": state.get("version"),
        "freq": state.get("freq"),
        "asof": max(signal_dates) if signal_dates else None,
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
