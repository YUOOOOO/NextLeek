"""Importable call surfaces for canonical ETF rotation entrypoints.

The functions execute the upstream modules in-process while preserving their
CLI argument parsing, output artifacts, and progress logging. ``root`` selects
the strategy project root (the directory containing ``configs``/``results``).
"""

from __future__ import annotations

import contextlib
import importlib
import os
import sys
from pathlib import Path
from typing import Any, Iterable


def _project_root(root: str | os.PathLike[str] | None) -> Path:
    return Path(root).resolve() if root is not None else Path(__file__).resolve().parents[2]


@contextlib.contextmanager
def _execution(root: str | os.PathLike[str] | None, cwd: str | os.PathLike[str] | None):
    project_root = _project_root(root)
    previous_root = os.environ.get("ETF_STRATEGY_ROOT")
    previous_cwd = Path.cwd()
    package_src = str(Path(__file__).resolve().parents[1])
    added_src = package_src not in sys.path
    if added_src:
        sys.path.insert(0, package_src)
    os.environ["ETF_STRATEGY_ROOT"] = str(project_root)
    try:
        if cwd is not None:
            os.chdir(Path(cwd).resolve())
        yield project_root
    finally:
        if added_src:
            sys.path.remove(package_src)
        os.chdir(previous_cwd)
        if previous_root is None:
            os.environ.pop("ETF_STRATEGY_ROOT", None)
        else:
            os.environ["ETF_STRATEGY_ROOT"] = previous_root


def _call(module_name: str, argv: Iterable[str] = (), *, root=None, cwd=None) -> Any:
    with _execution(root, cwd):
        old_argv = sys.argv
        sys.argv = [module_name, *list(argv)]
        try:
            module = importlib.import_module(module_name)
            module = importlib.reload(module)
            return module.main()
        finally:
            sys.argv = old_argv


def run_wfo(*, config: str | os.PathLike[str] | None = None, robust: bool = False,
            root=None, cwd=None) -> Any:
    """Run canonical combo WFO, selecting the robust full-space variant when requested."""
    previous_config = os.environ.get("WFO_CONFIG_PATH")
    if config is not None:
        os.environ["WFO_CONFIG_PATH"] = str(Path(config).resolve())
    try:
        module = "etf_strategy.run_robust_combo_wfo" if robust else "etf_strategy.run_combo_wfo"
        return _call(module, root=root, cwd=cwd)
    finally:
        if previous_config is None:
            os.environ.pop("WFO_CONFIG_PATH", None)
        else:
            os.environ["WFO_CONFIG_PATH"] = previous_config


def run_vec(*, config: str | os.PathLike[str] | None = None,
            combos: str | os.PathLike[str] | None = None, root=None, cwd=None) -> Any:
    argv = []
    if config is not None:
        argv += ["--config", str(config)]
    if combos is not None:
        argv += ["--combos", str(combos)]
    return _call("etf_strategy.scripts.run_full_space_vec_backtest", argv, root=root, cwd=cwd)


def run_bt(*, config: str | os.PathLike[str] | None = None,
           combos: str | os.PathLike[str] | None = None, topk: int | None = None,
           sort_by: str | None = None, root=None, cwd=None) -> Any:
    argv = []
    if config is not None:
        argv += ["--config", str(config)]
    if combos is not None:
        argv += ["--combos", str(combos)]
    if topk is not None:
        argv += ["--topk", str(topk)]
    if sort_by is not None:
        argv += ["--sort-by", sort_by]
    return _call("etf_strategy.scripts.batch_bt_backtest", argv, root=root, cwd=cwd)


def run_pipeline(*, config: str | os.PathLike[str] | None = None, top_n: int = 200,
                 n_jobs: int = 16, skip_wfo: bool = False, regime_gate: str = "auto",
                 with_mining: bool = False, skip_mining: bool = False, root=None, cwd=None) -> Any:
    argv = ["--top-n", str(top_n), "--n-jobs", str(n_jobs), "--regime-gate", regime_gate]
    if config is not None:
        argv += ["--config", str(config)]
    if skip_wfo:
        argv.append("--skip-wfo")
    if with_mining:
        argv.append("--with-mining")
    if skip_mining:
        argv.append("--skip-mining")
    return _call("etf_strategy.scripts.run_full_pipeline", argv, root=root, cwd=cwd)


def run_signal(*, candidates: str | os.PathLike[str], asof: str, trade_date: str,
               capital: float = 50_000.0, lot_size: int = 100,
               outdir: str | os.PathLike[str] | None = None,
               shadow_config: str | os.PathLike[str] | None = None, root=None, cwd=None) -> Any:
    argv = ["--candidates", str(candidates), "--asof", asof,
            "--trade-date", trade_date, "--capital", str(capital),
            "--lot-size", str(lot_size)]
    if outdir is not None:
        argv += ["--outdir", str(outdir)]
    if shadow_config is not None:
        argv += ["--shadow-config", str(shadow_config)]
    return _call("etf_strategy.scripts.generate_today_signal", argv, root=root, cwd=cwd)


def precompute_non_ohlcv(*, root=None, cwd=None) -> Any:
    return _call("etf_strategy.scripts.precompute_non_ohlcv_factors", root=root, cwd=cwd)


__all__ = ["run_wfo", "run_vec", "run_bt", "run_pipeline", "run_signal", "precompute_non_ohlcv"]
