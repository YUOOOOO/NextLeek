from datetime import date

import polars as pl

from app.services.portfolio_backtest import run_portfolio


def _frame() -> pl.DataFrame:
    rows = []
    for i, day in enumerate(
        [
            date(2024, 1, 2),
            date(2024, 1, 3),
            date(2024, 1, 4),
            date(2024, 1, 5),
            date(2024, 1, 8),
            date(2024, 1, 9),
        ]
    ):
        rows.append(
            {
                "date": day,
                "symbol": "000001.SZ",
                "name": "平安银行",
                "open": 10.0 + i,
                "close": 10.2 + i,
                "__dsl_factor__": i == 0,
            }
        )
        rows.append(
            {
                "date": day,
                "symbol": "000002.SZ",
                "name": "万科A",
                "open": 8.0 + i * 0.1,
                "close": 8.1 + i * 0.1,
                "__dsl_factor__": False,
            }
        )
    return pl.DataFrame(rows)


def test_run_portfolio_uses_dates_capital_and_fees():
    result = run_portfolio(
        _frame(),
        start=date(2024, 1, 2),
        end=date(2024, 1, 9),
        initial_capital=100_000,
        commission_pct=0.0002,
        stamp_tax_pct=0.001,
        slippage_bps=5,
        max_positions=1,
        holding_days=2,
        entry_fill="open_t+1",
        exit_fill="open_t+1",
    )
    assert result["ok"] is True
    assert result["start"] == "2024-01-02"
    assert result["end"] == "2024-01-09"
    assert result["initial_capital"] == 100_000
    assert result["trade_count"] >= 1
    assert result["equity_curve"]
    trade = result["trades"][0]
    assert trade["symbol"] == "000001.SZ"
    assert trade["entry_date"] == "2024-01-03"
    assert trade["shares"] % 100 == 0
    assert result["final_equity"] != 100_000


def test_run_portfolio_rejects_empty_range():
    result = run_portfolio(
        _frame(),
        start=date(2025, 1, 1),
        end=date(2025, 1, 2),
        initial_capital=100_000,
    )
    assert result["ok"] is False
    assert "行情" in result["warning"]
