from __future__ import annotations

import json
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from ..paths import JOBS_DIR, LIVE_DIR, ROOT, ensure_data_dirs

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


def _project_root(params: dict[str, Any]) -> Path:
    raw = params.get("root") or params.get("cwd")
    return Path(raw).resolve() if raw else ROOT


def _detect_asof(root: Path) -> str:
    """从本地日线 parquet 推断最新可用 asof（YYYY-MM-DD）。"""
    daily_dir = root / "data" / "raw" / "ETF" / "daily"
    if not daily_dir.exists():
        raise FileNotFoundError(f"daily data missing: {daily_dir}")

    import pandas as pd

    latest: pd.Timestamp | None = None
    for path in daily_dir.glob("*.parquet"):
        try:
            df = pd.read_parquet(path, columns=None)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        col = "trade_date" if "trade_date" in df.columns else df.columns[0]
        series = pd.to_datetime(
            df[col].astype(str).str.replace("-", "").str[:8],
            format="%Y%m%d",
            errors="coerce",
        ).dropna()
        if series.empty:
            continue
        value = series.max()
        if latest is None or value > latest:
            latest = value
    if latest is None:
        raise RuntimeError("unable to detect asof from daily parquet")
    return latest.strftime("%Y-%m-%d")


def _prepare_sealed_candidates(root: Path) -> Path:
    """用 shadow_strategies 生成 canonical signal 所需 candidates parquet。"""
    import pandas as pd
    import yaml

    cfg_path = root / "configs" / "shadow_strategies.yaml"
    if not cfg_path.exists():
        raise FileNotFoundError(f"shadow strategies missing: {cfg_path}")
    raw = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    strategies = list(raw.get("shadow_strategies") or [])
    if not strategies:
        raise ValueError("shadow_strategies.yaml is empty")

    rows: list[dict[str, Any]] = []
    for idx, item in enumerate(strategies, start=1):
        combo = str(item.get("combo") or "").strip()
        if not combo:
            continue
        row: dict[str, Any] = {
            "combo": combo,
            "name": str(item.get("name") or item.get("id") or combo),
            "rank": idx,
        }
        if item.get("factor_signs") is not None:
            row["factor_signs"] = str(item.get("factor_signs"))
        if item.get("factor_icirs") is not None:
            row["factor_icirs"] = str(item.get("factor_icirs"))
        rows.append(row)
    if not rows:
        raise ValueError("no sealed combos found in shadow_strategies.yaml")

    out = LIVE_DIR / "sealed_signal_candidates.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_parquet(out, index=False)
    return out


def _prepare_canonical_signal_params(params: dict[str, Any], progress: ProgressCb) -> dict[str, Any]:
    """为前端一键信号补齐 candidates/asof/trade_date/shadow_config。"""
    out = dict(params)
    root = _project_root(out)
    out.setdefault("root", str(root))
    out.setdefault("cwd", str(root))

    if not out.get("shadow_config"):
        out["shadow_config"] = str(root / "configs" / "shadow_strategies.yaml")

    if not out.get("candidates"):
        progress("prepare sealed candidates", 8.0)
        out["candidates"] = str(_prepare_sealed_candidates(root))

    if not out.get("asof"):
        progress("detect asof", 12.0)
        out["asof"] = _detect_asof(root)

    if not out.get("trade_date"):
        # 标签用途；无显式执行日时与 asof 对齐，避免前端必填。
        out["trade_date"] = str(out["asof"]).replace("-", "")

    return out


def _dispatch_update_data(params: dict[str, Any], progress: ProgressCb) -> Any:
    """数据更新固定走 Tushare/Promax → 本地 parquet（与 runtime 无关）。"""
    from ..data.updater import update_daily, update_market_data

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
            progress=progress,
        )
    return update_daily(
        symbols=params.get("symbols"),
        start=params.get("start"),
        end=params.get("end"),
        progress=progress,
    )


def _dispatch(job_type: str, params: dict[str, Any], progress: ProgressCb) -> Any:
    """仅原版精度：update-data 写 parquet 湖；其余 job 走 etf_strategy entrypoints。"""
    if job_type == "update-data":
        return _dispatch_update_data(params, progress)

    # 显式拒绝旧简化引擎 runtime，避免静默降配。
    runtime = str(params.get("runtime", "canonical") or "canonical").strip().lower()
    if runtime in {"legacy", "smoke", "simplified"}:
        raise ValueError(
            f"runtime={runtime!r} 已移除；只支持 canonical（原版 etf_strategy）"
        )
    if runtime not in {"canonical", "full", "full-fidelity", "default", ""}:
        raise ValueError(
            f"unknown runtime={runtime!r}; only canonical is supported"
        )

    from ..etf_strategy.entrypoints import (
        precompute_non_ohlcv,
        run_bt,
        run_pipeline,
        run_signal,
        run_vec,
        run_wfo,
    )

    progress("canonical runtime", 5.0)
    root = str(_project_root(params))
    cwd = str(params.get("cwd") or root)
    config = params.get("config")

    if job_type == "wfo":
        result = run_wfo(
            config=config,
            robust=bool(params.get("robust")),
            root=root,
            cwd=cwd,
        )
    elif job_type == "vec":
        result = run_vec(
            config=config,
            combos=params.get("combos"),
            root=root,
            cwd=cwd,
        )
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
        prepared = _prepare_canonical_signal_params(params, progress)
        result = run_signal(
            candidates=prepared["candidates"],
            asof=str(prepared["asof"]),
            trade_date=str(prepared["trade_date"]),
            capital=float(prepared.get("capital", 50_000.0)),
            lot_size=int(prepared.get("lot_size", 100)),
            outdir=prepared.get("outdir"),
            shadow_config=prepared.get("shadow_config"),
            root=prepared.get("root") or root,
            cwd=prepared.get("cwd") or cwd,
        )
        if isinstance(result, dict):
            result = {
                **result,
                "runtime": "canonical",
                "asof": prepared.get("asof"),
                "trade_date": prepared.get("trade_date"),
                "candidates": prepared.get("candidates"),
            }
        else:
            result = {
                "runtime": "canonical",
                "exit_code": result,
                "asof": prepared.get("asof"),
                "trade_date": prepared.get("trade_date"),
                "candidates": prepared.get("candidates"),
            }
    elif job_type == "precompute":
        result = precompute_non_ohlcv(root=root, cwd=cwd)
    else:
        raise ValueError(f"unknown job type: {job_type}")

    progress("canonical runtime complete", 100.0)
    return result
