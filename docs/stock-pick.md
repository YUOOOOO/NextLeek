# 选股页策略显示

页面：`frontend/src/pages/stock-pick/index.vue`  
接口：`GET /api/stock-picks`（BFF `/api/strategy/stock-picks`），默认 `top_n=20`  
打分：`strategy-api/src/stock_strategy/screeners.py`  
数据：`strategy-api/results/_auction_long_research/`

## 不再做阈值硬筛

先剔除噪音票，再在剩余股票上做百分位综合得分，取 Top 20 观察池。

剔除：

- 上市不足 60 个交易日（次新，无量一字板干扰量比/涨幅）
- 流通市值 > 200 亿（万元单位 `circ_mv/total_mv > 2_000_000`；大盘竞价难撬动）
- 昨日涨停/跌停（主板 |pct|≥9.8%，创业/科创 ≥19.5%）
- 股价 < 5 元（用昨收，缺失用收盘）

## 综合得分

对剩余股票分别算百分位（0~1），再加权。竞价多头示例：

`综合得分 = 竞价涨幅排名×0.3 + 成交额排名×0.3 + 量比排名×0.4`

得分 ×100 展示。8 个策略名仍保留，因子不同、权重不同，**共用同一剔除池**。

打分结果写入 `data/live/history/stock_picks/YYYYMMDD.json`。页面可前后翻已有截面。
