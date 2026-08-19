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
    from ..data.updater import update_daily
    from ..engine.pipeline import (
        run_backtest_job,
        run_pipeline_job,
        run_signal_job,
        run_wfo_job,
    )

    if job_type == "update-data":
        return update_daily(
            symbols=params.get("symbols"),
            start=params.get("start"),
            end=params.get("end"),
            progress=progress,
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
