# NextLeek（AI 新时代韭菜）

A 股 / 基金 / 黄金看板 + 多 Agent 投资对话原型 + **ETF 轮动研究平台**（WFO → VEC → BT + 信号）。

## 架构

```
Browser → frontend (Vite :5173)
       → server Express (:3000) /api/*
            ├─ /market/*     → data-api (:8000)     AkShare 行情
            ├─ /etf/*        → data-api (:8000)
            ├─ /strategy/*   → strategy-api (:8001) 研究 + 信号
            ├─ /gold/*       → 第三方黄金接口
            └─ /ai/*         → LangChain 多 Agent（本轮未接策略 tool）
```

| 进程 | 目录 | 默认端口 | 说明 |
|------|------|----------|------|
| frontend | `frontend/` | 5173 | Vue 3 + Vite；`/rotation` 轮动页 |
| server | `server/` | 3000 | Express BFF |
| data-api | `data-api/` | 8000 | FastAPI + AkShare 薄行情 |
| **strategy-api** | `strategy-api/` | **8001** | **WFO/VEC/BT/pipeline/signal** |

`data-api` / `strategy-api` **不在** npm workspaces，需单独启动。

环境变量：

- `DATA_API_URL`：server → data-api，默认 `http://localhost:8000`
- `STRATEGY_API_URL`：server → strategy-api，默认 `http://localhost:8001`
- `VITE_API_BASE`：frontend → server，默认 `http://localhost:3000`
- `PORT`：server 端口
- `TUSHARE_PROVIDER`：`auto`（默认）、`pro` 或 `promax`
- `TUSHARE_TOKEN`：直连 Tushare Pro token
- `TUSHARE_PRO_URL`：直连 Pro 地址，默认 `https://api.tushare.pro`
- `TUSHARE_PROMAX_KEY`：Promax 聚合接口 key
- `TUSHARE_PROMAX_URL`：Promax 地址，默认 `https://pcd.mobcvb.cn/tushare/pro`

---

## 快速启动

### 1. 前端 + Express

```bash
npm install
npm run dev
```

打开：`http://localhost:5173/rotation`

### 2. data-api（看板行情）

```bash
cd data-api
pip install -r requirements.txt
python main.py
```

### 3. strategy-api（研究引擎，必开才能跑轮动）

```bash
cd strategy-api
pip install -r requirements.txt
# 在 strategy-api 根目录：
python -m uvicorn src.main:app --host 0.0.0.0 --port 8001 --reload
```

OpenAPI：`http://localhost:8001/docs`

首次使用先提交 `update-data` 任务拉 Tushare `fund_daily` 日线 parquet，再跑 `vec` / `bt` / `wfo` / `signal` / `pipeline`。`TUSHARE_PROVIDER=auto` 时优先直连 Pro，失败后回退 Promax。

---

## strategy-api

参考设计：`docs/superpowers/specs/2026-08-19-etf-rotation-strategy-platform-design.md`
本地对照实现：`_tmp_etf_rot/`（gitignore，不提交）。

### 原生接口（`:8001`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | `{ service: strategy-api }` |
| GET | `/api/universe` | 池子 / mode / 冻结参数摘要 |
| GET | `/api/sealed` | 封版策略因子组合 |
| POST | `/api/jobs` | `{ type, params? }` → `{ job_id }` |
| GET | `/api/jobs` | 最近任务 |
| GET | `/api/jobs/{id}` | 状态 + 进度 |
| GET | `/api/jobs/{id}/result` | 成功后的结果 JSON |
| GET | `/api/signal/latest` | 有状态信号快照 |

**Job types**：`update-data` | `wfo` | `vec` | `bt` | `pipeline` | `signal`

长任务单 worker 串行；产物在 `strategy-api/data/jobs/{id}/`（gitignore）。

### Express 代理（`:3000`）

| Express | strategy-api |
|---------|--------------|
| `GET /api/strategy/health` | `/api/health` |
| `GET /api/strategy/universe` | `/api/universe` |
| `GET /api/strategy/sealed` | `/api/sealed` |
| `POST /api/strategy/jobs` | `/api/jobs` |
| `GET /api/strategy/jobs` | `/api/jobs` |
| `GET /api/strategy/jobs/:id` | `/api/jobs/{id}` |
| `GET /api/strategy/jobs/:id/result` | `/api/jobs/{id}/result` |
| `GET /api/strategy/signal/latest` | `/api/signal/latest` |

### 数据湖

- 路径：`strategy-api/data/raw/ETF/daily/{code}.{SH\|SZ}_daily.parquet`
- 列：`trade_date, adj_open, adj_high, adj_low, adj_close, vol[, amount]`
- 源：Tushare `fund_daily`（直连 Pro / Promax 可切换），字段映射到现有 `adj_*`

### 示例

```bash
curl http://localhost:8001/api/health
curl http://localhost:8001/api/universe
curl -X POST http://localhost:8001/api/jobs -H "Content-Type: application/json" -d "{\"type\":\"vec\"}"

# 经 Express
curl http://localhost:3000/api/strategy/health
curl -X POST http://localhost:3000/api/strategy/jobs -H "Content-Type: application/json" -d "{\"type\":\"signal\"}"
```

---

## data-api（摘要）

| Express | data-api |
|---------|----------|
| `GET /api/market/indices` | `/api/indices` |
| `GET /api/market/quote` | `/api/quote` |
| `GET /api/market/history` | `/api/history` |
| `GET /api/etf/*` | `/api/etf/*` |

---

## 其他说明

- 浏览器 **不直连** 8000/8001，只打 Express（或 Vite 代理到 Express）。
- AI 本轮 **未** 接策略 tools；数值以 strategy-api 为准。
- 大文件与 `_tmp_etf_rot` 已 gitignore。
- Tushare 上游偶发断连时 `update-data` 会重试；若全部来源失败，任务直接失败，不会生成旧数据冒充最新信号。
