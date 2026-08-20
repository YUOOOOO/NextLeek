from __future__ import annotations

import json
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from ..paths import JOBS_DIR, ensure_data_dirs

ProgressCb = Callable[[str, float], None]

_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="strategy-job")
_jobs: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _job_dir(job_id: str) -> Path:
    return JOBS_DIR / job_id


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def _append_log(job_id: str, line: str) -> None:
    path = _job_dir(job_id) / "log.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(f"[{_now()}] {line}\n")


def _set_status(job_id: str, **fields: Any) -> None:
    with _lock:
        st = _jobs.setdefault(job_id, {})
        st.update(fields)
        st["updated_at"] = _now()
        snap = dict(st)
    _write_json(_job_dir(job_id) / "status.json", snap)


def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    ensure_data_dirs()
    with _lock:
        items = list(_jobs.values())
    # also load from disk if empty memory
    if not items and JOBS_DIR.exists():
        for d in sorted(JOBS_DIR.iterdir(), reverse=True):
            sp = d / "status.json"
            if sp.exists():
                try:
                    items.append(json.loads(sp.read_text(encoding="utf-8")))
                except Exception:  # noqa: BLE001
                    pass
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return items[:limit]


def get_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        if job_id in _jobs:
            return dict(_jobs[job_id])
    sp = _job_dir(job_id) / "status.json"
    if sp.exists():
        return json.loads(sp.read_text(encoding="utf-8"))
    return None


def get_result(job_id: str) -> Any | None:
    rp = _job_dir(job_id) / "result.json"
    if not rp.exists():
        return None
    return json.loads(rp.read_text(encoding="utf-8"))


def submit_job(job_type: str, params: dict[str, Any] | None = None) -> str:
    ensure_data_dirs()
    job_id = uuid.uuid4().hex[:12]
    params = params or {}
    meta = {
        "job_id": job_id,
        "type": job_type,
        "params": params,
        "status": "queued",
        "stage": "queued",
        "pct": 0.0,
        "message": "queued",
        "error": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    with _lock:
        _jobs[job_id] = meta
    _write_json(_job_dir(job_id) / "status.json", meta)
    _append_log(job_id, f"queued type={job_type}")
    _executor.submit(_run, job_id, job_type, params)
    return job_id


def _run(job_id: str, job_type: str, params: dict[str, Any]) -> None:
    _set_status(job_id, status="running", stage="start", pct=1.0, message="starting")
    _append_log(job_id, "start")

    def progress(msg: str, pct: float) -> None:
        _set_status(
            job_id,
            status="running",
            stage=msg,
            pct=float(min(max(pct, 0.0), 100.0)),
            message=msg,
        )
        _append_log(job_id, f"{pct:.1f}% {msg}")

    try:
        result = _dispatch(job_type, params, progress)
        _write_json(_job_dir(job_id) / "result.json", result)
        _set_status(
            job_id,
            status="succeeded",
            stage="done",
            pct=100.0,
            message="succeeded",
            error=None,
        )
        _append_log(job_id, "succeeded")
    except Exception as exc:  # noqa: BLE001
        tb = traceback.format_exc()
        _append_log(job_id, tb)
        _set_status(
            job_id,
            status="failed",
            stage="error",
            message=str(exc),
            error=str(exc),
        )


def _dispatch(job_type: str, params: dict[str, Any], progress: ProgressCb) -> Any:
    runtime = str(params.get("runtime", "legacy")).lower()
    if runtime in {"canonical", "full", "full-fidelity"}:
        return _dispatch_canonical(job_type, params, progress)

    from ..data.updater import update_daily, update_market_data
    from ..engine.pipeline import (
        run_backtest_job,
        run_pipeline_job,
        run_signal_job,
    )

    if job_type == "update-data":
        include_daily = bool(params.get("include_daily", True))
        include_share = bool(params.get("include_share", True))
        include_margin = bool(params.get("include_margin", True))
        if include_share or include_margin:
            return update_market_data(
                symbols=params.get("symbols"),
                start=params.get("start"),
                end=params.get("end"),
                include_daily=include_daily,
                include_share=include_share,
                include_margin=include_margin,
            )
        return update_daily(
            symbols=params.get("symbols"),
            start=params.get("start"),
            end=params.get("end"),
        )
    if job_type == "wfo":
        return run_wfo_job(progress=progress)
    if job_type == "vec":
        return run_backtest_job(
            engine="vec",
            factors=params.get("factors"),
            progress=progress,
        )
    if job_type == "bt":
        return run_backtest_job(
            engine="bt",
            factors=params.get("factors"),
            progress=progress,
        )
    if job_type == "pipeline":
        return run_pipeline_job(progress=progress)
    if job_type == "signal":
        return run_signal_job(progress=progress)
    raise ValueError(f"unknown job type: {job_type}")


def _dispatch_canonical(job_type: str, params: dict[str, Any], progress: ProgressCb) -> Any:
    from ..etf_strategy.entrypoints import (
        precompute_non_ohlcv,
        run_bt,
        run_pipeline,
        run_signal,
        run_vec,
        run_wfo,
    )

    progress("canonical runtime", 5.0)
    config = params.get("config")
    root = params.get("root")
    cwd = params.get("cwd")
    if job_type == "wfo":
        result = run_wfo(config=config, robust=bool(params.get("robust")), root=root, cwd=cwd)
    elif job_type == "vec":
        result = run_vec(config=config, combos=params.get("combos"), root=root, cwd=cwd)
    elif job_type == "bt":
        result = run_bt(
            config=config,
            combos=params.get("combos"),
            topk=params.get("topk"),
            sort_by=params.get("sort_by"),
            root=root,
            cwd=cwd,
        )
    elif job_type == "pipeline":
        result = run_pipeline(
            config=config,
            top_n=int(params.get("top_n", 200)),
            n_jobs=int(params.get("n_jobs", 16)),
            skip_wfo=bool(params.get("skip_wfo")),
            regime_gate=str(params.get("regime_gate", "auto")),
            with_mining=bool(params.get("with_mining")),
            skip_mining=bool(params.get("skip_mining")),
            root=root,
            cwd=cwd,
        )
    elif job_type == "signal":
        required = ("candidates", "asof", "trade_date")
        missing = [key for key in required if not params.get(key)]
        if missing:
            raise ValueError(f"canonical signal requires: {', '.join(missing)}")
        result = run_signal(
            candidates=params["candidates"],
            asof=str(params["asof"]),
            trade_date=str(params["trade_date"]),
            capital=float(params.get("capital", 50_000.0)),
            lot_size=int(params.get("lot_size", 100)),
            outdir=params.get("outdir"),
            shadow_config=params.get("shadow_config"),
            root=root,
            cwd=cwd,
        )
    elif job_type == "precompute":
        result = precompute_non_ohlcv(root=root, cwd=cwd)
    else:
        raise ValueError(f"unknown canonical job type: {job_type}")
    progress("canonical runtime complete", 100.0)
    return result
