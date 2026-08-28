# 行情怎么拉、怎么存

## 不是刷新一次拉一次

轮动页每 15 秒只问任务/信号状态，**不会**因此打 Tushare。

真正拉数的时机：

1. **定时**：每个交易日 **15:30（北京时间）**，`strategy-api` 后台线程排队 `update-data` → `signal`（`jobs/scheduler.py`）
2. **补跑**：服务在 15:30 之后才起来，或打开页面时过了 15:30 且当天还没成功
3. **手动**：今日操作里的「更新行情」

周末不跑，顺延到周一。`strategy-api` 进程要一直开着，定时才生效。

## 存在哪，回测读哪

主存储是增量 **parquet 湖**（合并写入，不整文件覆盖）：

- `data/raw/ETF/daily/{code}_daily.parquet` — 日线
- `data/raw/ETF/fund_share/` — 份额
- `data/raw/ETF/margin/` — 融资

回测 / 信号 / 持有期收益都读这套湖。每天 15:30 只是在文件末尾补上新交易日。

## 按日冻结（给回测对照）

每次 `update-data` 成功后，再切出当天截面：

`data/live/history/market/YYYYMMDD/{daily,fund_share,margin}.parquet`

主回测仍用整段湖；按日目录是「那天收盘时拿到的截面」，避免以后文件被改对不上。
