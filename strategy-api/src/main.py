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
from .paths import CONFIG_PATH, JOBS_DIR, LIVE_DIR, SIGNAL_STATE_PATH, ensure_data_dirs


def _shadow_strategies() -> list[dict[str, Any]]:
    path = CONFIG_PATH.parent / "shadow_strategies.yaml"
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return list(raw.get("shadow_strategies", []))


def _strategy_id(strategy: dict[str, Any]) -> str:
    return str(strategy.get("name") or strategy.get("id") or strategy.get("combo") or "unknown")


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _factor_signs(factors: list[str]) -> dict[str, int]:
    """优先读 registry；失败时按 low_is_good 名单兜底。"""
    low_is_good = {
        "SHARE_CHG_5D",
        "SHARE_CHG_10D",
        "SHARE_CHG_20D",
        "MARGIN_CHG_10D",
        "MARGIN_BUY_RATIO",
        "VOL_20D",
        "MAX_DD_60D",
        "AMIHUD_ILLIQUIDITY",
    }
    try:
        import importlib.util

        registry_path = Path(__file__).resolve().parent / "etf_strategy" / "core" / "factor_registry.py"
        spec = importlib.util.spec_from_file_location("_nl_factor_registry", registry_path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            get_dir = getattr(module, "get_factor_direction", None)
            if callable(get_dir):
                return {
                    factor: -1 if get_dir(factor) == "low_is_good" else 1
                    for factor in factors
                }
    except Exception:
        pass
    return {factor: -1 if factor in low_is_good else 1 for factor in factors}


def _extract_strategy_payload(
    sid: str,
    raw: dict[str, Any],
    definition: dict[str, Any],
    *,
    default_asof: Any = None,
    generated_at: Any = None,
) -> dict[str, Any]:
    """把 legacy holdings 或 canonical signal_portfolio 统一成前端 payload。"""
    holdings = [
        str(symbol)
        for symbol in (
            raw.get("signal_portfolio")
            or raw.get("holdings")
            or []
        )
    ]
    hold_days_src = raw.get("signal_hold_days") or raw.get("hold_days") or {}
    hold_days = {str(symbol): int(days) for symbol, days in hold_days_src.items()}

    actions = list(raw.get("last_actions") or [])
    if not actions:
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

    factors = [
        factor.strip()
        for factor in str(definition.get("combo") or "").split("+")
        if factor.strip()
    ]
    if not factors and isinstance(raw.get("factors"), list):
        factors = [str(f) for f in raw["factors"]]
    if not factors:
        factors = [str(sid)]

    asof = (
        raw.get("last_signal_asof")
        or raw.get("last_seen_asof")
        or raw.get("last_asof_date")
        or default_asof
    )
    summary = raw.get("last_summary") or (
        f"当前持仓 {len(holdings)} 只" if holdings else "暂无持仓"
    )

    return {
        "strategy_id": str(sid),
        "name": definition.get("name") or raw.get("name") or str(sid),
        "factors": factors,
        "combo": definition.get("combo"),
        "asof": asof,
        "summary": summary,
        "actions": actions,
        "holdings": holdings,
        "hold_days": hold_days,
        "last_rebalance": raw.get("last_rebalance"),
        "generated_at": raw.get("last_generated_at") or generated_at,
        "source": raw.get("source") or "signal_state",
    }


def _collect_shadow_strategy_states() -> list[dict[str, Any]]:
    """优先读 canonical shadow 状态文件，再回退 signal_state.json。"""
    definitions = {_strategy_id(item): item for item in _shadow_strategies()}
    payloads: list[dict[str, Any]] = []
    seen: set[str] = set()

    for path in sorted(LIVE_DIR.glob("signal_state_shadow_*.json")):
        state = _load_json(path)
        name = path.stem.replace("signal_state_shadow_", "", 1)
        definition = definitions.get(name, {"name": name})
        strategies = state.get("strategies") or {}
        if strategies:
            # canonical 状态以 combo 为 key；对外统一成策略名。
            for combo, raw in strategies.items():
                raw = dict(raw or {})
                raw.setdefault("source", f"shadow:{name}")
                if not definition.get("combo"):
                    definition = {**definition, "combo": combo}
                payload = _extract_strategy_payload(
                    name,
                    raw,
                    definition,
                    default_asof=state.get("last_asof_date"),
                    generated_at=state.get("generated_at"),
                )
                payloads.append(payload)
                seen.add(name)
                break
        else:
            # 兼容扁平 shadow 文件
            payload = _extract_strategy_payload(
                name,
                state,
                definition,
                default_asof=state.get("last_asof_date"),
                generated_at=state.get("generated_at"),
            )
            payloads.append(payload)
            seen.add(name)

    # 回退：旧 legacy signal_state.json（按策略 id）
    legacy = _load_json(SIGNAL_STATE_PATH)
    for sid, raw in (legacy.get("strategies") or {}).items():
        sid = str(sid)
        if sid in seen:
            continue
        definition = definitions.get(sid, {"name": sid})
        raw = dict(raw or {})
        raw.setdefault("source", "legacy_signal_state")
        payloads.append(
            _extract_strategy_payload(
                sid,
                raw,
                definition,
                default_asof=legacy.get("last_asof_date"),
                generated_at=legacy.get("generated_at"),
            )
        )

    # 保证封版策略都出现在列表中（即便还没跑过信号）
    for item in _shadow_strategies():
        sid = _strategy_id(item)
        if sid in {p["strategy_id"] for p in payloads}:
            continue
        payloads.append(
            {
                "strategy_id": sid,
                "name": item.get("name", sid),
                "factors": [
                    f.strip() for f in str(item.get("combo", "")).split("+") if f.strip()
                ],
                "combo": item.get("combo"),
                "asof": None,
                "summary": "尚未生成信号",
                "actions": [],
                "holdings": [],
                "hold_days": {},
                "last_rebalance": None,
                "generated_at": None,
                "source": "sealed_definition",
            }
        )

    return payloads

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
    return {
        "status": "ok",
        "service": "strategy-api",
        "runtime_default": "canonical",
        "sealed_count": len(_shadow_strategies()),
    }


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
    factors = sorted(
        {
            factor
            for strategy in strategies
            for factor in str(strategy.get("combo", "")).split("+")
            if factor
        }
    )
    signs = _factor_signs(factors)
    return {
        "runtime_default": "canonical",
        "sealed": [
            {
                "id": _strategy_id(strategy),
                "name": strategy.get("name", _strategy_id(strategy)),
                "factors": [
                    f.strip()
                    for f in str(strategy.get("combo", "")).split("+")
                    if f.strip()
                ],
                "combo": strategy.get("combo"),
                "factor_signs": strategy.get("factor_signs")
                or ",".join(
                    str(
                        signs.get(f.strip(), 1)
                    )
                    for f in str(strategy.get("combo", "")).split("+")
                    if f.strip()
                ),
            }
            for strategy in strategies
        ],
        "factor_signs": signs,
    }


@app.post("/api/jobs")
def create_job(body: JobCreate) -> dict[str, str]:
    allowed = {"update-data", "wfo", "vec", "bt", "pipeline", "signal", "precompute"}
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
    strategies = _collect_shadow_strategy_states()
    signal_dates = [str(item.get("asof")) for item in strategies if item.get("asof")]
    asof = max(signal_dates) if signal_dates else None
    note = None
    if not any(item.get("source") != "sealed_definition" for item in strategies):
        note = "no signal yet; run job type=signal (default runtime=canonical)"
    return {
        "version": "v8.0-shadow",
        "runtime_default": "canonical",
        "asof": asof,
        "strategies": strategies,
        "note": note,
    }



@app.post("/api/config/reload")
def config_reload() -> dict[str, str]:
    reload_config()
    return {"status": "reloaded"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8001, reload=True)
