from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

from ..paths import SIGNAL_STATE_PATH, ensure_data_dirs
from .hysteresis import apply_hysteresis, stable_topk_indices


def load_state(path: Path = SIGNAL_STATE_PATH) -> dict[str, Any]:
    if not path.exists():
        return {"version": "v2", "strategies": {}}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_state(state: dict[str, Any], path: Path = SIGNAL_STATE_PATH) -> None:
    ensure_data_dirs()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


ACTION_LABELS = {
    "buy": "买入",
    "sell": "卖出",
    "hold": "持有",
    "current": "当前持仓",
}


def _signal_action(
    symbol: str,
    action: str,
    reason: str,
    hold_days: int,
) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "action": action,
        "label": ACTION_LABELS[action],
        "reason": reason,
        "hold_days": hold_days,
    }


def generate_signal_for_strategy(
    strategy_id: str,
    scores_last: np.ndarray,
    codes: list[str],
    dates: list[str],
    *,
    pos_size: int,
    delta_rank: float,
    min_hold_days: int,
    freq: int,
    universe_mode: str,
    state: dict[str, Any],
    strategy_name: str | None = None,
    factors: list[str] | None = None,
) -> dict[str, Any]:
    st = state.setdefault("strategies", {}).setdefault(
        strategy_id,
        {"holdings": [], "hold_days": {}, "last_rebalance": None, "bar_index": 0},
    )
    previous_holdings = list(st.get("holdings", []))
    code_set = set(codes)
    removed_holdings = [c for c in previous_holdings if c not in code_set]
    previous_hold_days = dict(st.get("hold_days", {}))
    had_previous_signal = bool(
        st.get("signal_initialized")
        or st.get("last_signal_asof")
        or st.get("last_rebalance")
    )
    asof = dates[-1] if dates else None
    previous_asof = st.get("last_seen_asof", st.get("last_rebalance"))
    is_new_bar = asof != previous_asof
    if is_new_bar:
        st["bar_index"] = int(st.get("bar_index", 0)) + 1
        st["last_seen_asof"] = asof

    n = len(codes)
    holdings_mask = np.array([c in previous_holdings for c in codes], dtype=bool)
    hold_days = np.array(
        [int(previous_hold_days.get(c, 0)) for c in codes],
        dtype=np.int64,
    )

    last_rb = st.get("last_rebalance_bar")
    do_rb = not had_previous_signal or (
        is_new_bar
        and (last_rb is None or (st["bar_index"] - int(last_rb)) >= freq)
    )

    if do_rb:
        top = stable_topk_indices(scores_last, pos_size)
        target = apply_hysteresis(
            scores_last,
            holdings_mask,
            hold_days,
            top,
            pos_size,
            delta_rank,
            min_hold_days,
        )
        new_holdings = [codes[i] for i in range(n) if target[i]]
        new_hd = {
            c: int(previous_hold_days.get(c, 0)) + 1 if c in previous_holdings else 1
            for c in new_holdings
        }
        st["holdings"] = new_holdings
        st["hold_days"] = new_hd
        st["last_rebalance"] = asof
        st["last_rebalance_bar"] = st["bar_index"]
        mode = "rebalance"

        if had_previous_signal:
            bought = [c for c in new_holdings if c not in previous_holdings]
            sold = [c for c in previous_holdings if c not in new_holdings]
            kept = [c for c in new_holdings if c in previous_holdings]
            actions = [
                *[
                    _signal_action(c, "buy", "新进入策略目标持仓", new_hd[c])
                    for c in bought
                ],
                *[
                    _signal_action(
                        c,
                        "sell",
                        "标的已移出可交易池" if c in removed_holdings else "退出策略目标持仓",
                        int(previous_hold_days.get(c, 0)),
                    )
                    for c in sold
                ],
                *[
                    _signal_action(c, "hold", "继续满足策略条件", new_hd[c])
                    for c in kept
                ],
            ]
            if bought or sold:
                summary = (
                    f"买入 {len(bought)} 只，卖出 {len(sold)} 只，"
                    f"继续持有 {len(kept)} 只"
                )
            elif kept:
                summary = f"无买卖操作，继续持有 {len(kept)} 只"
            else:
                summary = "无操作"
        else:
            actions = [
                _signal_action(c, "current", "首次生成，无上期信号可比较", new_hd[c])
                for c in new_holdings
            ]
            summary = f"首次生成：当前持仓 {len(new_holdings)} 只"
    else:
        active_holdings = [c for c in st["holdings"] if c not in removed_holdings]
        st["holdings"] = active_holdings
        st["hold_days"] = {
            c: int(st["hold_days"].get(c, 0)) for c in active_holdings
        }
        if is_new_bar:
            for c in active_holdings:
                st["hold_days"][c] = int(st["hold_days"][c]) + 1
        reason = "未到调仓日，继续持有" if is_new_bar else "同一交易日信号未变化"
        actions = [
            *[
                _signal_action(
                    c,
                    "sell",
                    "标的已移出可交易池",
                    int(previous_hold_days.get(c, 0)),
                )
                for c in removed_holdings
            ],
            *[
                _signal_action(c, "hold", reason, int(st["hold_days"].get(c, 0)))
                for c in active_holdings
            ],
        ]
        if removed_holdings:
            mode = "universe_change"
            summary = (
                f"卖出 {len(removed_holdings)} 只（已移出可交易池），"
                f"继续持有 {len(active_holdings)} 只"
            )
        else:
            mode = "hold"
            summary = (
                f"{'未到调仓日' if is_new_bar else '今日持仓不变'}，"
                f"继续持有 {len(active_holdings)} 只"
                if active_holdings
                else "无操作"
            )


    generated_at = datetime.now().isoformat(timespec="seconds")
    st["signal_initialized"] = True
    st["last_signal_asof"] = asof
    st["last_generated_at"] = generated_at
    st["last_actions"] = actions
    st["last_summary"] = summary
    st["name"] = strategy_name or strategy_id
    st["factors"] = list(factors or [])

    return {
        "strategy_id": strategy_id,
        "name": st["name"],
        "factors": st["factors"],
        "action": mode,
        "asof": asof,
        "summary": summary,
        "actions": actions,
        "holdings": st["holdings"],
        "hold_days": st["hold_days"],
        "universe_mode": universe_mode,
        "generated_at": generated_at,
    }

