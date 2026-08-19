# Readable ETF Signal Design

**Date:** 2026-08-19
**Status:** Approved (方案 A)

## Goal

Replace raw signal JSON as the primary UI with concise model actions: 买入、卖出、持有、当前持仓/无操作.

## Contract

Each strategy signal returns `summary` and `actions` in addition to the existing holdings:

- Current target minus previous target → `buy` / 买入
- Previous target minus current target → `sell` / 卖出
- Intersection → `hold` / 持有
- First signal without comparable history → `current` / 当前持仓
- No rebalance due → existing targets are `hold`

Each action includes `symbol`, `action`, `label`, `reason`, and optional `hold_days`.

The state file persists `last_actions`, `last_summary`, `last_signal_asof`, strategy name/factors, and the existing holdings. Re-running the signal on the same market date must not advance the rebalance counter.

## UI

The signal section renders one card per sealed strategy. Every action has a colored label, ETF code, reason, and holding days. Raw JSON remains available only under a collapsed “查看原始信号数据” section. Empty state says no signal and provides the action to run.

## Safety

The page labels this as a strategy research signal, not an executed order or personalized investment advice. Buy/sell describes changes in model target holdings only.

## Verification

Run a signal job through Express, verify the latest-signal payload contains readable actions, then inspect `/rotation` in Chromium and confirm labels, summary, raw-data collapse, and no console errors.
