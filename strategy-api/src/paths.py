from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "configs" / "config.yaml"
DATA_DIR = ROOT / "data"
RAW_DAILY_DIR = DATA_DIR / "raw" / "ETF" / "daily"
LIVE_DIR = DATA_DIR / "live"
JOBS_DIR = DATA_DIR / "jobs"
SIGNAL_STATE_PATH = LIVE_DIR / "signal_state.json"


def ensure_data_dirs() -> None:
    RAW_DAILY_DIR.mkdir(parents=True, exist_ok=True)
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
