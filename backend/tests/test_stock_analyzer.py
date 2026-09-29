from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import polars as pl

from app.services.stock_analyzer import _build_user_prompt, _load_financials


def test_financial_dates_remain_json_serializable(monkeypatch, tmp_path: Path) -> None:
    frame = pl.DataFrame({"symbol": ["000001.SZ"], "period_end": [date(2026, 6, 30)], "roe": [12.5]})
    monkeypatch.setattr("app.services.stock_analyzer.get_financial_df", lambda _path, _table: frame)
    financials = _load_financials(tmp_path, "000001.SZ")
    assert financials["metrics"][0]["period_end"] == "2026-06-30"
    prompt = _build_user_prompt([], financials, {}, 11.0, "000001.SZ", "")
    assert json.dumps(financials) and "2026-06-30" in prompt
