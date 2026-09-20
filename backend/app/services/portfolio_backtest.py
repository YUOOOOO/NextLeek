"""公式策略组合回测 — 对齐 tsp 的日期/本金/费用/持仓口径，不引入 vectorbt。"""
from __future__ import annotations

from datetime import date, datetime
from math import sqrt
from typing import Any, Literal

import polars as pl

Fill = Literal["close_t", "open_t+1"]


def _as_date(value: object) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _finite(value: object) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number <= 0:
        return None
    return number


def run_portfolio(
    frame: pl.DataFrame,
    *,
    start: date,
    end: date,
    initial_capital: float = 1_000_000.0,
    commission_pct: float = 0.0002,
    stamp_tax_pct: float = 0.001,
    slippage_bps: float = 5.0,
    max_positions: int = 10,
    max_exposure_pct: float = 1.0,
    holding_days: int = 5,
    entry_fill: Fill = "open_t+1",
    exit_fill: Fill = "open_t+1",
    signal_col: str = "__dsl_factor__",
) -> dict[str, Any]:
    if start > end:
        return {"ok": False, "warning": "起始日期不能晚于结束日期"}
    if signal_col not in frame.columns:
        return {"ok": False, "warning": "公式未能产出信号"}
    needed = {"date", "symbol", "open", "close"}
    if missing := needed - set(frame.columns):
        return {"ok": False, "warning": f"行情缺列: {', '.join(sorted(missing))}"}

    window = frame.filter((pl.col("date") >= start) & (pl.col("date") <= end)).sort(["date", "symbol"])
    if window.is_empty():
        return {"ok": False, "warning": "回测区间没有行情"}

    cols = ["date", "symbol", "open", "close", signal_col]
    if "name" in window.columns:
        cols.append("name")
    px_open: dict[date, dict[str, float]] = {}
    px_close: dict[date, dict[str, float]] = {}
    names: dict[str, str] = {}
    signals: dict[date, list[str]] = {}
    for row in window.select(cols).iter_rows(named=True):
        day = _as_date(row["date"])
        symbol = str(row["symbol"])
        open_px = _finite(row["open"])
        close_px = _finite(row["close"])
        if open_px:
            px_open.setdefault(day, {})[symbol] = open_px
        if close_px:
            px_close.setdefault(day, {})[symbol] = close_px
        name = row.get("name")
        if isinstance(name, str) and name:
            names[symbol] = name
        flag = row.get(signal_col)
        if flag is True or flag == 1 or (isinstance(flag, (int, float)) and flag > 0):
            bucket = signals.setdefault(day, [])
            if symbol not in bucket:
                bucket.append(symbol)

    dates = sorted(px_close)
    if not dates:
        return {"ok": False, "warning": "回测区间没有收盘价"}

    buy_cost = commission_pct + slippage_bps / 10_000.0
    sell_cost = commission_pct + stamp_tax_pct + slippage_bps / 10_000.0
    cash = float(initial_capital)
    positions: dict[str, dict[str, Any]] = {}
    pending_buys: dict[int, list[str]] = {}
    trades: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []
    hold = max(int(holding_days), 1)
    max_pos = max(int(max_positions), 1)
    exposure = min(max(float(max_exposure_pct), 0.01), 1.0)

    def fill_price(day: date, symbol: str, fill: Fill) -> float | None:
        book = px_open if fill == "open_t+1" else px_close
        return book.get(day, {}).get(symbol)

    def mark(day: date) -> float:
        total = cash
        closes = px_close.get(day, {})
        for symbol, pos in positions.items():
            total += pos["shares"] * (closes.get(symbol) or pos["entry_price"])
        return total

    def close_position(day: date, symbol: str, price: float) -> None:
        nonlocal cash
        pos = positions.pop(symbol, None)
        if pos is None:
            return
        proceeds = pos["shares"] * price * (1.0 - sell_cost)
        cash += proceeds
        pnl = proceeds - pos["cost"]
        trades.append(
            {
                "symbol": symbol,
                "name": names.get(symbol, symbol),
                "entry_date": pos["entry_date"].isoformat(),
                "exit_date": day.isoformat(),
                "entry_price": round(pos["entry_price"], 4),
                "exit_price": round(price, 4),
                "shares": pos["shares"],
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl / pos["cost"], 6) if pos["cost"] else 0.0,
                "hold_days": int(pos["hold_left_at_exit"]),
            }
        )

    def open_position(day: date, symbol: str, price: float, equity: float) -> None:
        nonlocal cash
        if symbol in positions or len(positions) >= max_pos:
            return
        slot = equity * exposure / max_pos
        budget = min(slot, cash)
        shares = int(budget / (price * (1.0 + buy_cost)) / 100) * 100
        if shares <= 0:
            return
        cost = shares * price * (1.0 + buy_cost)
        if cost > cash:
            return
        cash -= cost
        positions[symbol] = {
            "shares": shares,
            "entry_date": day,
            "entry_price": price,
            "cost": cost,
            "bars": 0,
            "hold_left_at_exit": hold,
        }

    for index, day in enumerate(dates):
        if exit_fill == "open_t+1":
            for symbol in [sym for sym, pos in positions.items() if pos["bars"] >= hold]:
                price = fill_price(day, symbol, "open_t+1")
                if price:
                    positions[symbol]["hold_left_at_exit"] = positions[symbol]["bars"]
                    close_position(day, symbol, price)
        for symbol in pending_buys.pop(index, []):
            price = fill_price(day, symbol, entry_fill)
            if price:
                open_position(day, symbol, price, mark(day))
        if entry_fill == "close_t":
            equity_now = mark(day)
            for symbol in signals.get(day, []):
                price = fill_price(day, symbol, "close_t")
                if price:
                    open_position(day, symbol, price, equity_now)
        if exit_fill == "close_t":
            for symbol in [sym for sym, pos in positions.items() if pos["bars"] >= hold]:
                price = fill_price(day, symbol, "close_t")
                if price:
                    positions[symbol]["hold_left_at_exit"] = positions[symbol]["bars"]
                    close_position(day, symbol, price)
        if entry_fill == "open_t+1":
            pending_buys.setdefault(index + 1, [])
            for symbol in signals.get(day, []):
                if symbol in positions or symbol in pending_buys[index + 1]:
                    continue
                pending_buys[index + 1].append(symbol)
        for pos in positions.values():
            pos["bars"] += 1
        equity_curve.append({"date": day.isoformat(), "value": round(mark(day), 2)})

    if dates:
        last = dates[-1]
        last_close = px_close.get(last, {})
        for symbol in list(positions):
            price = last_close.get(symbol) or positions[symbol]["entry_price"]
            positions[symbol]["hold_left_at_exit"] = positions[symbol]["bars"]
            close_position(last, symbol, price)

    values = [row["value"] for row in equity_curve]
    final_equity = values[-1] if values else initial_capital
    total_return = final_equity / initial_capital - 1.0 if initial_capital else 0.0
    n_days = max(len(values) - 1, 1)
    annual_return = (1.0 + total_return) ** (242 / n_days) - 1.0 if values else 0.0
    daily = []
    for prev, curr in zip(values, values[1:]):
        if prev:
            daily.append(curr / prev - 1.0)
    mean = sum(daily) / len(daily) if daily else 0.0
    var = sum((item - mean) ** 2 for item in daily) / (len(daily) - 1) if len(daily) > 1 else 0.0
    sharpe = (mean / sqrt(var) * sqrt(242)) if var > 0 else 0.0
    peak = values[0] if values else initial_capital
    max_dd = 0.0
    for value in values:
        peak = max(peak, value)
        if peak:
            max_dd = min(max_dd, value / peak - 1.0)
    wins = [row for row in trades if row["pnl"] > 0]
    return {
        "ok": True,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "initial_capital": initial_capital,
        "final_equity": round(final_equity, 2),
        "total_return": round(total_return, 6),
        "annual_return": round(annual_return, 6),
        "max_drawdown": round(max_dd, 6),
        "sharpe": round(sharpe, 4),
        "win_rate": round(len(wins) / len(trades), 4) if trades else 0.0,
        "trade_count": len(trades),
        "holding_days": hold,
        "max_positions": max_pos,
        "entry_fill": entry_fill,
        "exit_fill": exit_fill,
        "commission_pct": commission_pct,
        "stamp_tax_pct": stamp_tax_pct,
        "slippage_bps": slippage_bps,
        "equity_curve": equity_curve,
        "trades": trades[-80:],
    }
