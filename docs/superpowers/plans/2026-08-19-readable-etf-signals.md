# Readable ETF Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert raw ETF strategy signal JSON into explicit buy/sell/hold cards while preserving the raw payload as optional detail.

**Architecture:** Python remains the numerical and signal-state source of truth. It compares previous and current target holdings, persists readable actions, and exposes them through the existing Express proxy. Vue only renders the returned contract.

**Tech Stack:** Python 3 / FastAPI / JSON state; Vue 3 / TypeScript / Vite.

---

### Task 1: Add readable signal actions

**Files:**
- Modify: `strategy-api/src/engine/signal.py`
- Modify: `strategy-api/src/engine/pipeline.py`

- [x] Snapshot previous holdings before applying hysteresis.
- [x] Return and persist `summary` plus ordered `actions`.
- [x] Distinguish buy, sell, hold, and first-run current holdings.
- [x] Prevent repeated runs on the same `asof` date from advancing the rebalance counter.
- [x] Persist strategy display name and factor list.

### Task 2: Expose the readable latest-signal contract

**Files:**
- Modify: `strategy-api/src/main.py`

- [x] Return action metadata from `/api/signal/latest`.
- [x] Preserve existing holdings and hold-day fields for compatibility.
- [x] Return strategy name/factors and top-level latest `asof`.

### Task 3: Render signal cards

**Files:**
- Modify: `frontend/src/pages/rotation/index.vue`

- [x] Add typed readable action and strategy payloads.
- [x] Render strategy summary and buy/sell/hold/current badges.
- [x] Show empty signal state clearly.
- [x] Move raw signal/result/sealed JSON into collapsed details.
- [x] Add a short research-signal disclaimer.

### Task 4: Smoke verification

- [x] Restart strategy-api.
- [x] Submit a signal job through `http://127.0.0.1:3000/api/strategy/jobs`.
- [x] Verify `/api/strategy/signal/latest` includes `summary` and `actions`.
- [x] Open `http://127.0.0.1:5173/rotation` in Chromium and confirm the rendered labels and no console errors.

No unit tests are added or run because the repository instructions require explicit user request before adding tests. The user explicitly requested commit and push after verification.
