from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "configs" / "combo_wfo_config.yaml"
DATA_DIR = ROOT / "data"
RAW_ETF_ROOT = DATA_DIR / "raw" / "ETF"
RAW_DAILY_DIR = RAW_ETF_ROOT / "daily"
RAW_FUND_SHARE_DIR = RAW_ETF_ROOT / "fund_share"
RAW_MARGIN_DIR = RAW_ETF_ROOT / "margin"
CACHE_DIR = ROOT / ".cache"
RESULTS_DIR = ROOT / "results"
LIVE_DIR = DATA_DIR / "live"
JOBS_DIR = DATA_DIR / "jobs"
SIGNAL_STATE_PATH = LIVE_DIR / "signal_state.json"


def ensure_data_dirs() -> None:
    for path in (
        RAW_DAILY_DIR,
        RAW_FUND_SHARE_DIR,
        RAW_MARGIN_DIR,
        CACHE_DIR,
        RESULTS_DIR,
        LIVE_DIR,
        JOBS_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)


