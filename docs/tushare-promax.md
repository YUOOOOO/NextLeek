# Tushare / tureshare 聚合接口

来源：[语雀 · tureshare接口说明](https://www.yuque.com/tenglong-emkah/foo0eo/ztr29xs6iarfom71?singleDoc)

改行情源、补因子、写 `update-data` 之前先读本文和 `strategy-api/src/data/tushare_client.py`，**不要再问用户接口长什么样**。密钥只在 `strategy-api/.env`，文档不写 key。

## 形态

这是 HTTP 聚合 API，不是官方 `pro.tushare.pro` 的 Python SDK。

语雀用法：

```python
print(ts("daily", ts_code="510300.SH", start_date="20200101", end_date="20260820"))
```

对应本仓库：

- 类：`strategy-api/src/data/tushare_client.py` 的 `TushareClient.query(api_name, **params)`
- 配置：`TUSHARE_PROVIDER=promax`
- 地址：`TUSHARE_PROMAX_URL`（默认 `https://pcd.mobcvb.cn/tushare/pro`）
- 鉴权：请求头 `X-API-Key: $TUSHARE_PROMAX_KEY`
- 方法：`GET {url}/{api_name}?...params`
- SSL：`TUSHARE_PROMAX_VERIFY_SSL=0` 时不校验证书

官方 Pro 仍可用：`TUSHARE_PROVIDER=pro` 时 POST `https://api.tushare.pro`，body 带 `api_name / token / params`。`auto` 时先 Pro，失败再 Promax。

## 返回

```json
{ "code": 0, "data": { "fields": ["ts_code", "trade_date", "..."], "items": [[...], ...] } }
```

`code != 0` 视为失败。客户端把 `fields + items` 收成 DataFrame。

## 本仓库用到的 api_name

| 用途 | 环境变量 | 默认 api_name | 参数 |
|------|----------|---------------|------|
| ETF 日线 | `TUSHARE_FUND_DAILY_API` | `fund_daily` | `ts_code, start_date, end_date` |
| 股票日线 | `TUSHARE_STOCK_DAILY_API` | `daily` | 同上 |
| ETF 份额 | `TUSHARE_FUND_SHARE_API` | `fund_share` | 同上；失败可改 `etf_share_size` |
| 融资融券 | `TUSHARE_MARGIN_DETAIL_API` | `margin_detail` | 同上 |

日期一律 `YYYYMMDD`。代码用 `510300.SH` / `159915.SZ`。

落盘：`strategy-api/data/raw/ETF/daily/{code}.{SH\|SZ}_daily_ohlcv.parquet`，列 `trade_date, adj_open, adj_high, adj_low, adj_close, vol, amount`。

## 语雀侧约束（摘要）

页面正文是 Lake 格式，公开 HTML 只露出简介。已确认、必须遵守的约定：

- 聚合接口，**直接拉要的数据，不要用测试接口试连**。
- 历史分钟级不要从服务器拉，用网盘更新。
- 用法就是 `ts(api_name, **params)`，与 `TushareClient.query` 对齐。

接口清单以语雀正文和 `tushare_client.py` 为准；语雀有更新时改客户端并同步本文。
