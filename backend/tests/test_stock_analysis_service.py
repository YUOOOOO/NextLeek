from __future__ import annotations

from datetime import date, timedelta

import polars as pl

from app.services.stock_analysis import StockAnalysisService
from app.services.stock_tracker import StockTracker


class _Repo:
    def __init__(self, frame: pl.DataFrame) -> None:
        self.frame = frame

    def resolve_asset_type(self, _symbol: str) -> str:
        return "stock"

    def get_daily_asset(self, _asset_type: str, _symbol: str, _start: date, _end: date) -> pl.DataFrame:
        return self.frame


def _daily_frame() -> pl.DataFrame:
    start = date(2026, 7, 1)
    closes = [10 + index * 0.05 for index in range(80)]
    return pl.DataFrame(
        {
            "date": [start + timedelta(days=index) for index in range(80)],
            "symbol": ["000001.SZ"] * 80,
            "name": ["测试股票"] * 80,
            "open": [value - 0.03 for value in closes],
            "high": [value + 0.15 for value in closes],
            "low": [value - 0.15 for value in closes],
            "close": closes,
            "volume": [1_000_000 + index * 1000 for index in range(80)],
            "turnover_rate": [2.0] * 80,
            "atr_14": [0.2] * 80,
            "rsi_14": [55.0] * 80,
            "ma_5": closes,
            "ma_10": closes,
            "ma_20": closes,
            "ma_60": closes,
        }
    )


def test_analysis_populates_levels_and_action_points_without_strategy() -> None:
    analysis = StockAnalysisService(_Repo(_daily_frame())).analyze("000001.SZ")

    assert analysis is not None
    assert analysis.buy_points
    assert {point.type for point in analysis.sell_points} == {"止损", "止盈"}
    assert analysis.key_levels.support
    assert analysis.key_levels.resistance
    assert analysis.key_levels.stop_loss is not None
    assert analysis.key_levels.take_profit is not None
    assert analysis.key_levels.ma["MA20"] > 0


def test_tracking_uses_latest_close_when_realtime_price_is_unavailable(tmp_path) -> None:
    tracker = StockTracker(tmp_path)
    tracker.add("000001.SZ", "测试股票", entry_price=12.0, stop_loss=11.0)

    analysis = StockAnalysisService(_Repo(_daily_frame())).analyze(
        "000001.SZ", track_record=tracker.get("000001.SZ")
    )

    assert analysis is not None
    assert analysis.tracking is True
    assert analysis.pnl_pct is not None
    assert analysis.distance_to_stop is not None
    assert analysis.distance_to_stop > 0


def test_tracker_price_update_persists_and_records_alert(tmp_path) -> None:
    tracker = StockTracker(tmp_path)
    tracker.add("000001.SZ", "测试股票", entry_price=10.0, stop_loss=9.5)

    alert = tracker.update_price("000001.SZ", 9.4)

    assert alert is not None
    reloaded = StockTracker(tmp_path).get("000001.SZ")
    assert reloaded is not None
    assert reloaded.current_price == 9.4
    assert reloaded.alert_history[0]["type"] == "stop_loss"
