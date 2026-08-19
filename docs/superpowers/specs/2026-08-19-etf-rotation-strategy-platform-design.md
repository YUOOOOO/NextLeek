# NextLeek ETF 轮动研究平台设计

**日期**: 2026-08-19  
**状态**: 待用户审阅  
**范围**: 在 NextLeek 内落地 zhangsensen 级 ETF 轮动研究能力（WFO → VEC → BT + 每日信号）  
**已决**: 架构 B；WFO/VEC/BT **不后置**，参考 `_tmp_etf_rot` / [zhangsensen/etf-rotation-strategy](https://github.com/zhangsensen/etf-rotation-strategy) 直接实现

---

## 1. 目标与非目标

### 1.1 目标

1. 在 NextLeek 仓库内提供 **可部署的 ETF 轮动研究 + 信号** 能力。
2. **三层引擎齐全**：WFO（组合筛选）→ VEC（向量化回测）→ BT（事件驱动审计），与参考源码同构，不在 Node 重写数值内核。
3. 前端/AI 通过 **稳定 HTTP API** 消费：池子、封版策略、异步任务进度、回测产物、今日信号。
4. 数据默认走 **AkShare**（与现有 `data-api` 一致），写入与参考工程兼容的日线 parquet 契约，避免绑死 QMT。

### 1.2 非目标（明确不做）

- 用 Node.js / TypeScript 复刻 Numba 迟滞内核、WFO 组合爆炸、Backtrader 审计。
- 一比一搬迁 QMT bridge、GPU/CuPy、完整 1.2M 代数因子挖掘流水线（可后续加，首版不阻塞）。
- 实盘下单 / 券商接入。
- 用 AI Agent **生成**买卖指令（AI 只解释已算出的信号与回测）。
- 把 `_tmp_etf_rot` 整仓 commit 进 git（参考源码仅本地/只读依赖，正式代码进 `strategy-api/`）。

---

## 2. 架构（方案 B）

```
Browser (Vue :5173)
        │
        ▼
Express BFF (:3000)
  /api/market|etf/*  ──► data-api (:8000)     AkShare 行情
  /api/ai/*          ──► LangGraph agents     解读 signal/job 结果
  /api/strategy/*    ──► strategy-api (:8001) 研究 + 信号
                              │
                              ├─ jobs: update-data | wfo | vec | bt | pipeline | signal
                              ├─ engine: 因子 / 迟滞 / regime / cost / execution
                              ├─ store: parquet + job artifacts + signal_state
                              └─ (可选) 调 data-api 补行情，或自带 AkShare 拉数写盘
```

| 进程 | 端口 | 职责 |
|------|------|------|
| `frontend` | 5173 | 池子 / 任务 / 净值 / 信号 UI |
| `server` (Express) | 3000 | BFF：代理、鉴权预留、任务状态聚合、AI tools |
| `data-api` | 8000 | 轻量行情：indices / quote / history / etf/* |
| **`strategy-api`（新建）** | **8001** | **WFO/VEC/BT/pipeline/signal + 数据落盘** |

**硬边界**

- 浏览器 **只** 打 Express（或经 Vite 代理到 Express），不直连 8001。
- 数值正确性以 **strategy-api / Python** 为准；Express 不做二次计算。
- 长任务 **必须异步 job**；禁止同步 HTTP 跑完整 WFO/pipeline。

---

## 3. 参考源码映射

本地参考：`D:/YU/NextLeek/_tmp_etf_rot`（gitignore，不提交）。

| 参考模块 | NextLeek 落点 |
|----------|----------------|
| `src/etf_strategy/core/*`（hysteresis, frozen_params, factors, cost, execution） | `strategy-api/src/engine/` |
| `run_combo_wfo.py` / `batch_vec_backtest.py` / `batch_bt_backtest.py` / `run_full_pipeline.py` | `strategy-api/src/jobs/` + CLI 入口 |
| `generate_today_signal.py` + `data/live/signal_state.json` | `strategy-api` signal job + `data/live/` |
| `configs/combo_wfo_config.yaml` | `strategy-api/configs/` |
| `raw/ETF/daily/*.parquet` 契约 | `strategy-api/data/raw/ETF/daily/` |
| QMT `update_daily_from_qmt_bridge.py` | **替换为** AkShare/Tushare updater（同 parquet schema） |

**生产参数基线（v8.0 语义，可配置覆盖）**

| 参数 | 默认 | 说明 |
|------|------|------|
| `FREQ` | 5 | 每 5 个交易日调仓 |
| `POS_SIZE` | 2 | 同时持有 2 只 |
| `COMMISSION` | 0.0002 | 2bp |
| `LOOKBACK` | 252 | 回看约 1 年 |
| `delta_rank` | 0.10 | 迟滞：rank 差距门槛 |
| `min_hold_days` | 9 | 迟滞：最少持有交易日 |
| universe | ~49 写死池；`A_SHARE_ONLY` 可关 QDII 交易 | 改池改 YAML，非动态 Top20 |

三层含义（实现时保持同构）：

1. **WFO**：滚动窗口筛因子组合；IC 门控后按 Return/Sharpe/MaxDD 综合分排序（**禁止只按 IC 排名**）。
2. **VEC**：Numba（或等价向量化）快速精确回测，float 份额可接受。
3. **BT**：事件驱动 + 整手/资金约束，作为 ground truth；与 VEC 对齐是验收项。

---

## 4. 数据契约

### 4.1 日线 parquet（最低 OHLCV）

路径：`strategy-api/data/raw/ETF/daily/{code}.{SH|SZ}_daily_*.parquet`

必需列：

- `trade_date`：`YYYYMMDD` 字符串或可转之
- `adj_open`, `adj_high`, `adj_low`, `adj_close`
- `vol` 或 `volume`
- 可选 `amount`

任何来源（AkShare 优先，Tushare 备选）只要 **写出该 schema** 即可喂引擎。

### 4.2 更新策略

1. `POST /jobs` type=`update-data`：按配置池增量拉 AkShare `fund_etf_hist_em`（及必要 spot），写/合并 parquet。
2. 前复权：AkShare 字段映射到 `adj_*`；若源为不复权，文档标明并在配置 `adjust` 中显式记录（**不得静默当复权**）。
3. non-OHLCV 因子（两融、份额等）：首版若缺源，因子注册表标记 `optional`；WFO 默认 **OHLCV 活跃子集** 可跑通全流程；有源后再打开 sealed v8 全因子。

### 4.3 与 data-api 关系

- **data-api**：在线薄接口，给看板 K 线/列表。
- **strategy-api**：研究用本地湖；可不经 data-api 直连 AkShare，避免大回测打爆 8000。
- 符号规范化与 data-api 对齐：`510300` / `510300.SH` / `sh510300` → 统一内部 code。

---

## 5. strategy-api 设计

### 5.1 目录（建议）

```
strategy-api/
  pyproject.toml          # uv
  configs/
    combo_wfo_config.yaml
    universe.yaml
  src/
    main.py               # FastAPI app
    api/
      health.py
      universe.py
      sealed.py
      jobs.py
      signal.py
      artifacts.py
    engine/               # 自参考源码移植/改编，非 git submodule 整仓
    jobs/
      runner.py           # 进程内队列或子进程
      update_data.py
      wfo.py
      vec.py
      bt.py
      pipeline.py
      signal.py
    data_io/              # parquet loader/writer, schema validate
  data/                   # gitignore 大文件
    raw/ETF/daily/
    live/signal_state.json
    jobs/{job_id}/
  tests/
```

### 5.2 HTTP API（strategy-api 原生；Express 原样前缀挂载）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | `{ status, service: strategy-api }` |
| GET | `/api/universe` | 池子 + universe_mode |
| GET | `/api/sealed` | 封版策略列表与冻结参数 |
| POST | `/api/jobs` | body: `{ type, params? }` → `{ job_id }` |
| GET | `/api/jobs` | 最近任务列表 |
| GET | `/api/jobs/{id}` | 状态：`queued|running|succeeded|failed` + progress + error |
| GET | `/api/jobs/{id}/result` | 指标、路径、摘要 JSON |
| GET | `/api/signal/latest` | 今日/最近信号（多策略） |
| GET | `/api/artifacts/{job_id}/{name}` | 受控下载 equity/trades 等 |

**Job types（首版全部实现，不拆到「以后再说」）**

| type | 行为 |
|------|------|
| `update-data` | 拉数写 parquet |
| `wfo` | 组合筛选，产出候选表 |
| `vec` | 对 WFO top-N 或指定 combo 向量化回测 |
| `bt` | 事件驱动审计 |
| `pipeline` | update(可选) → precompute → WFO → VEC → BT → 摘要 |
| `signal` | 有状态生成今日持仓/调仓 |

### 5.3 Job 运行模型

- 内存或磁盘队列；**同时默认 1 个重任务**（WFO/pipeline），避免本机打满。
- 每个 job 目录：`status.json`, `log.txt`, `result.json`, 可选 parquet/csv。
- 进度字段：`stage`, `pct`, `message`（供 WebSocket 可后续加；首版 HTTP 轮询即可）。
- 失败：保留 log + 非零 error；不删除中间产物便于排错。

### 5.4 引擎移植原则

1. **优先移植可运行的最小闭环**：data_loader → factors(OHLCV) → hysteresis → vec → bt → signal。
2. 再接通 WFO 组合枚举与 IC 门控（参考 `run_combo_wfo.py`），**同一套 frozen_params** 入口校验。
3. 共享 `shift_timing_signal` / `generate_rebalance_schedule`，保证 WFO/VEC/BT/signal 无未来函数。
4. 许可：参考仓库 MIT 时保留版权与 NOTICE；不整目录复制无关 archive/experimental。
5. 依赖：`uv` 管理；Numba / pandas / numpy / pyarrow；BT 层可用 backtrader 或精简事件引擎，但 **整手+佣金** 语义要对齐参考测试精神。

---

## 6. Express BFF

### 6.1 新增

- `STRATEGY_API_URL`（默认 `http://localhost:8001`）
- `server/src/services/strategyApi.ts`：`proxy` 封装（对齐现有 `dataApi.ts`）
- `server/src/controllers/strategy.controller.ts`
- 路由挂载：`/api/strategy/*` → strategy-api `/api/*`

### 6.2 AI

- 新增 tools：`getLatestRotationSignal`, `getStrategyJobResult`（只读）。
- System/策略说明：AI **不得**编造未返回的持仓；无信号时明确说「无数据/任务未跑」。

### 6.3 错误映射

- strategy-api 502/超时 → Express 502 + 可读 `error`
- job 不存在 → 404

---

## 7. 前端（首版最小）

在基金/ETF 相关路由下（或独立 `/home/fund/rotation`）：

1. **Universe**：展示池子与模式  
2. **Jobs**：按钮触发 `update-data` / `pipeline` / `signal`；列表轮询状态  
3. **Result**：关键指标（收益、Sharpe、MaxDD、交易次数）+ 简单净值序列图（lightweight-charts 已有）  
4. **Signal**：最新持仓、调仓建议、生成时间  

不要求首版复刻 Nuxt 全套仪表盘视觉。

---

## 8. 配置与密钥

- `strategy-api/.env.example`：`HOST`, `PORT=8001`, `DATA_DIR`, `AKSHARE` 代理相关、可选 `TUSHARE_TOKEN`
- 根 README 更新：四进程启动说明（frontend / server / data-api / strategy-api）
- 大目录 gitignore：`strategy-api/data/raw/**`, `strategy-api/data/jobs/**`, Numba cache

---

## 9. 验收标准

### 9.1 功能

- [ ] `update-data` 能为配置池写出合法 parquet，loader 无 schema 错误  
- [ ] `wfo` 产出候选 combo 表（非空或明确「数据不足」）  
- [ ] `vec` / `bt` 对同一 combo 可跑通，返回收益类指标  
- [ ] `pipeline` 端到端异步完成并写 `result.json`  
- [ ] `signal` 写出 `signal_state.json` 与 `GET /api/signal/latest`  
- [ ] Express `/api/strategy/*` 代理可用  
- [ ] 前端三块：任务 / 结果摘要 / 最新信号  

### 9.2 正确性（对齐参考精神，不要求 bit 级一致）

- [ ] 调仓信号经 `shift` / 日程工具，无「当日收盘已知未来」  
- [ ] frozen 参数在 WFO/VEC/BT/signal 入口一致  
- [ ] 迟滞：单次最多 1 换、delta_rank、min_hold_days 生效（单测覆盖）  
- [ ] VEC 与 BT 同 combo 同区间：收益同号；交易次数量级接近（记录 gap，不硬编码参考仓库绝对收益）  

### 9.3 工程

- [ ] `strategy-api` 可用 `uv run` 启动  
- [ ] 关键路径 pytest（hysteresis、schema、job 状态机）  
- [ ] `_tmp_etf_rot` 不进入 git status 提交集  

---

## 10. 实现顺序（全部在首个实施计划内，不「WFO 以后再说」）

1. **Scaffold** `strategy-api` + health + job runner 骨架  
2. **Data** AkShare → parquet writer + DataLoader  
3. **Engine 移植** frozen_params、rebalance utils、hysteresis、OHLCV 因子子集  
4. **VEC + BT** 单 combo 回测 API/job  
5. **WFO** 组合筛选 job（可先缩小 combo 空间做 CI 快速档，配置保留全量档）  
6. **Pipeline + Signal** 串联与状态文件  
7. **Express 代理 + AI tools**  
8. **前端最小页**  
9. **README / gitignore / 手工冒烟**  

> CI 快速档：减小 `combo_sizes` / 日期区间，保证分钟级可测；全量研究档仅本地/手动。

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| AkShare 不稳定 / 与 QMT 复权不一致 | 重试；文档声明；指标不与 zhangsensen 实盘数字对赌 |
| 全量 WFO 过慢 | job 异步 + 配置「smoke / full」两档 |
| 整仓复制导致许可/体积/无关文件 | 只移植 engine 与 configs；NOTICE |
| data-api 与 strategy-api 双份拉数 | 研究默认 strategy 自拉；看板走 data-api |
| 本机内存 | 默认单重任务；BT worker 可配置 |

---

## 12. 已决问题记录

| 问题 | 决定 |
|------|------|
| Node 是否重写 WFO/VEC/BT？ | **否**，Python only |
| 架构 | **B**：独立 `strategy-api:8001` + Express BFF |
| WFO 是否后置？ | **否**，与 VEC/BT/signal 同属首期实施范围 |
| 数据源 | AkShare 主；parquet 契约对齐参考；QMT 不依赖 |
| AI 角色 | 解释信号与回测，不发明交易 |

---

## 13. 审阅后下一步

用户批准本 spec 后：

1. 用 `writing-plans` 产出分步实施计划  
2. 再按计划改代码（本文件批准前 **不写业务实现**）
