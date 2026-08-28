# 轮动页约定

页面：`frontend/src/pages/rotation/index.vue`  
信号接口：`GET /api/signal/latest`（`strategy-api/src/main.py`）  
历史：`data/live/history/signals/YYYYMMDD.json`，顶栏「前一日 / 后一日」翻页。

改这块 UI **先读本文**，不要再让用户口头提醒同一条规则。

## 区块顺序（从上到下）

1. 顶栏状态（信号日 / 可交易 / 换仓节奏 / **当前任务**）
2. 今日操作（更新行情、生成今日信号、今日持仓）
3. **最近任务**（带最后操作时间）
4. **研究重筛**
5. **回测 / 任务结果**（VEC、BT、WFO 等）

不要把回测卡插回研究重筛上面，也不要复制一份「最近任务」。

## 当前任务

只看**任务执行态**，不看信号日是不是今天。

| 情况 | 显示 |
|------|------|
| 没有排队/运行中的任务 | **无** |
| `queued` / `running`，或页面 `busy` | **进行中** |
| 最近一条 `succeeded` | **已完成** |
| 最近一条 `failed` | **未完成** |

副文案是任务类型（更新行情、生成今日信号、VEC…）。  
信号日是否过期只体现在「信号日」那一格和今日持仓，不要写进「当前任务」。

## 最近任务

- 已完成的可以点开，加载 `/api/strategy/jobs/{id}/result`
- 显示最后操作时间：优先 `updated_at`，否则 `created_at`，格式 `YYYY-MM-DD HH:mm`

## 回测结果

VEC/BT 的 `result.json` 已有 `total_return / sharpe / max_drawdown / equity_curve`。页面必须画出：

- 总收益、夏普、最大回撤等指标
- **起始 / 结束：具体日期 + 净值点数**（千分位，不要只 round 成整数）
- 净值曲线两端同样是日期和点数
- 因子芯片；WFO 则出候选表

回测是历史成绩，不是今天该买哪只。刷新时若还没有结果，自动带最近一次成功的 bt → vec → wfo → pipeline。

## 今日持仓

每条持仓要有：

- 本轮起始日 `since_date`
- **已持天数 `hold_days`**：从进场日数到**今天**的交易日/工作日，**不是**信号生成当时冻住的 0
- 持有期收益 `hold_return`：进场复权收盘 → 本地最新复权收盘
- **评分 `score`**：当日截面综合分，与 `shadow_snapshots.jsonl` 的 `picks/scores` 按位对齐；每策略**持仓 2 只**
- **评分前 10**：`rank_top`，轮动页默认列出截面前 10 名（持仓行打「持仓」标）；新信号写入 jsonl，历史日已用因子缓存回填

实现：`strategy-api/src/main.py` 的 `_holding_period_stats`。本地 parquet 只到信号日时，收益可能仍是 0，天数仍要按 20 号到今天补上（例如 2026-08-20 → 2026-08-27 去掉周末 = 5 天）。

信号引擎的 `signal_hold_days` 只在下次跑 `signal` 时累加，展示层不要直接信那个冻结值。

## 按日存档与翻页

- 每次拉最新信号会写入 `history/signals/{asof}.json`
- jsonl 里已有的交易日（如 19/20/25/26）首次访问时补档
- `GET /api/signal/latest?date=YYYYMMDD` 只读该日快照，不再按今天重算持有期
- 返回 `history.prev / next / index / total`；翻历史时 15 秒刷新仍停留在该日

## 日常自动

定时：**每个交易日 15:30（北京时间）**，`update-data` → `signal`。A 股 15:00 收盘后再拉。页面 15 秒刷新**不拉行情**。行情写入 parquet 湖，并另存 `history/market/YYYYMMDD/` 供回测对照。

- 后端：`strategy-api/src/jobs/scheduler.py`，strategy-api 进程活着就会跑。
- 周末顺延到周一；服务在 15:30 之后启动会补跑当天。
- 环境变量：`DAILY_SCHEDULE_HOUR` / `DAILY_SCHEDULE_MINUTE` / `DAILY_SCHEDULE_ENABLED`。
- 打开页面：过了 15:30 且当天还没成功才补跑；15 秒刷新不重跑。
- 当天已有成功/进行中的同类任务则跳过。手动按钮仍可补跑。

## 日常 vs 研究

- 日常：更新行情 → 生成今日信号。用已封版 `v8_composite_1`，不跑 WFO/VEC/BT。
- 研究：WFO 自动枚举，或手动勾 2–8 个因子再跑 VEC/BT。只有「封版到生产」才换配方。
- 轮动页不需要 `data-api`。

## 因子胶囊

锁定因子、回测结果里的因子胶囊可点开弹窗，内容和因子池页一致：分组、方向、数据源、原理。

## 相关代码

- 前端：`frontend/src/pages/rotation/index.vue`
- 信号 payload：`strategy-api/src/main.py` `_extract_strategy_payload`
- 行情：`docs/tushare-promax.md`
