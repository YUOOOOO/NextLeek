# 竞价多头策略 · Tushare 因子复现研究

日期：2026-08-21  
状态：进行中（已落脚本与部分日线；竞价全量面板未跑完）  
范围：用 Tushare 字段解释用户给出的 6 只样例股，反推「竞价多头」可用因子；**先研究、不接选股生产**

## 样例股

| 名称 | ts_code | 状态 |
|---|---|---|
| 飞龙股份 | `002536.SZ` | 已确认 |
| 晓程科技 | `300139.SZ` | 已确认 |
| 广汇能源 | `600256.SH` | 已确认 |
| 五洲交通 | `600368.SH` | 已确认 |
| 经纬辉开 | `300120.SZ` | 已确认 |
| 中海远控 | **未精确命中** | `stock_basic` 无此名；候选 `601919.SH 中远海控`（形近/音近，**待用户确认**） |

排除：ST / \*ST（样例均非 ST）。  
小市值：样例流通市值约 **47 亿～2000 亿+**（`daily_basic.circ_mv` 单位万元 → ÷10000 为亿元）。研究过滤建议 **流通市值 ≥ 30 亿**（可调）。

## 目标

1. 找出这 6 只在「竞价/开盘」维度上的**共性**（不是全市场扫盲）。  
2. 映射到 **Tushare 可拉字段**，形成可编码的因子/过滤清单。  
3. 再与 i.gushi.in「竞价多头」对标；最后才改 NextLeek 选股页 `STRATEGY_DEFS`。

## 非目标

- 不在本阶段改 `strategy-api` 因子引擎或选股生产信号。  
- 不把 ETF 轮动因子（`MOM_20D` 等）当作竞价多头真因子。  
- 不依赖 eltdx/通达信 TCP（仅作备选数据源）。

## Tushare 接口（已验证可用性）

| API | 用途 | Promax 备注 |
|---|---|---|
| `stock_basic` | 代码/名称/行业/市场 | SSE 全表偶发超时，可分 exchange 重试 |
| `trade_cal` | 交易日 | 正常 |
| `daily` | OHLC、开盘价、涨跌幅 | 按 ts_code 稳定 |
| `daily_basic` | 换手、量比、流通/总市值 | 当日部分字段可能空，用 T-1 |
| `stk_limit` | 涨跌停价 | 判断开盘/收盘是否触板 |
| `stk_auction` | **开盘集合竞价** price/vol/amount/pre_close/turnover_rate/volume_ratio/float_share | 按 `trade_date` 拉全日再 filter；单票参数不稳；偶发 90s+ 超时 |
| `stk_auction_o` / `stk_auction_c` | 扩展竞价 | 当前网关空/无权限 |
| `namechange` | 曾用名 | 需带 `ts_code` |

### 衍生字段（本地算）

```text
auction_pct   = stk_auction.price / pre_close - 1
open_pct      = daily.open / pre_close - 1
is_open_limit = abs(open - up_limit) <= 1 分钱
is_close_limit= abs(close - up_limit) <= 1 分钱
circ_mv_yi    = daily_basic.circ_mv / 10000   # 亿元
```

## 已观察到的共性（基于已落盘 daily，2026-08-17～21）

数据文件：`strategy-api/results/_auction_long_research/six_daily.csv` 等。

### 硬过滤层（高置信）

| 规则 | 样例表现 |
|---|---|
| 非 ST | 6/6 通过 |
| A 股主板/创业板 | 主板 4 + 创业板 2 |
| 排除极小市值 | 20260820 流通市值最小经纬辉开 ≈ **47.5 亿**；中远海控候选 ≈ 2089 亿 |

### 竞价/开盘层（中置信，待 stk_auction 补全）

| 观察 | 证据 |
|---|---|
| **20260821 开盘涨幅全为正** | 飞龙 +4.99% … 中远海控 +0.36%；`open_pct > 0` 全中 |
| **不要求开盘涨停** | 21 日无一 `is_open_limit`；飞龙收盘触板 |
| **行业不统一** | 汽配/黄金/石油/路桥/元器件/水运 → 不是行业主题单因子 |
| **市值带很宽** | 不可用「小盘」或「大盘」单独刻画 |

### 20260821 开盘涨幅排序（daily）

| 名称 | open_pct | pct_chg | 收盘涨停 |
|---|---:|---:|---|
| 飞龙股份 | +4.99% | +10.00% | Y |
| 五洲交通 | +3.54% | +1.52% | |
| 晓程科技 | +2.51% | +8.55% | |
| 经纬辉开 | +2.22% | 0.00% | |
| 广汇能源 | +1.31% | +1.80% | |
| 中远海控(候选) | +0.36% | +2.22% | |

> 注意：其他交易日开盘涨幅**并非**天天全为正（如 08-19 多只低开）。若样例来自某一日「竞价多头」结果列表，必须以**该信号日**的 `stk_auction` 为准，不能把整周日线平均当竞价因子。

## 建议因子清单（Tushare 可复现草案）

### A. 过滤（先做）

1. `name` 不含 `ST`  
2. `circ_mv_yi >= 30`（参数化）  
3. 可选：排除次新（`list_date` 距今 < N 日）— 样例均为老股，暂不强制  
4. 可选：排除停牌 / `vol==0`

### B. 竞价多头核心（排序/打分）

| 因子 | 计算 | 方向 | Tushare |
|---|---|---|---|
| 竞价涨幅 | `auction_pct` | 高 | `stk_auction` |
| 竞价量比 | `volume_ratio` | 高 | `stk_auction` |
| 竞价换手 | `turnover_rate` | 高 | `stk_auction` |
| 竞价成交额 | `amount` | 高 | `stk_auction` |
| 开盘缺口 | `open_pct` | 高（验证用） | `daily` |
| 是否竞价/开盘触板 | `is_open_limit` | 策略相关，样例显示非必须 | `stk_limit`+price |

### C. 暂不作为主因子

- 行业、地域  
- 单一 PE/PB  
- ETF 轮动池因子（`MOM_20D`/`BREAKOUT_20D`…）— 与竞价语义不符

### D. 复现流程（研究）

```text
trade_date = 信号日
1) stock_basic + daily_basic[T or T-1] → 股票宇宙 + 非ST + 市值过滤
2) stk_auction[trade_date] → 计算 auction_pct 等
3) 阈值或截面分位：auction_pct / volume_ratio / amount
4) 看 6 只样例的召回与名次；调阈值
5) 用 daily.open 交叉验证 open_pct 与 auction 一致性
```

## 仓库落点

| 路径 | 说明 |
|---|---|
| `strategy-api/scripts/research_auction_long_commonality.py` | 可续跑脚本（缓存 CSV + 摘要 MD） |
| `strategy-api/results/_auction_long_research/` | 数据与 `commonality_summary.md` |
| `docs/superpowers/specs/2026-08-21-auction-long-tushare-factors.md` | 本说明 |

### 续跑命令

```bash
cd D:/YU/NextLeek/strategy-api

# 只基于已有 CSV 出摘要
python scripts/research_auction_long_commonality.py --skip-fetch

# 补拉最近 4 日竞价 + 刷新摘要（Promax 可能慢/超时，多跑一次即可）
python scripts/research_auction_long_commonality.py --start 20260801 --end 20260821 --auction-last 4

# 强制重拉
python scripts/research_auction_long_commonality.py --force-fetch
```

## 下次继续清单

1. 用户确认「中海远控」真实代码（或是否为中远海控）。  
2. 确认样例列表对应的**信号交易日**（若不是 20260821，换日再算共性）。  
3. 跑通 `six_auction.csv`，用竞价字段重做 min/分位。  
4. 在「非 ST + 市值」宇宙上估召回：6 只能否被简单阈值捞出、同时选出多少只。  
5. 阈值稳定后，再写选股页真因子映射（替换 mock `STRATEGY_DEFS`）。

## 风险

- Promax 超时/502 频繁 → 脚本已按日缓存 `stk_auction_YYYYMMDD.csv`。  
- 无信号日则日线共性会误导（低开日与高开日混用）。  
- 研究-only 数据源合规：Tushare 按账号权限；结果不作投资建议。
