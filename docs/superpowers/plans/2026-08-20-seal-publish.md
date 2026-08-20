# 封版到生产（Seal Publish）

## Goal
研究（WFO/VEC/BT）通过后，一键把公共因子池内的 combo 写入主策略 `v8_composite_1` 封版配置。只换因子配方，不换仓、不自动 signal。

## API
- `POST /api/sealed/publish` (strategy-api :8001)
- BFF: `POST /api/strategy/sealed/publish` (Express :3000)

Body:
```json
{
  "combo": ["ADX_14D", "BREAKOUT_20D", "..."] ,
  "source_job_id": "optional",
  "factor_signs": "optional 1,-1,...",
  "note": "optional",
  "metrics": { "sharpe": 1.2 }
}
```

Rules:
1. 因子必须 ∈ `combo_wfo_config.yaml` 的 `active_factors`
2. 2–8 个因子
3. 写前备份 `configs/backups/shadow_strategies_YYYYMMDD_HHMMSS.yaml`
4. 只改 primary 槽（`v8_composite_1` / `primary: true` / 首条）

## UI
`/rotation` 研究区底部「封版到生产」：从最近 result 或成功 BT/VEC job 解析 factors，确认后发布。

## Non-goals
- 不自动生成今日信号
- 不改 hysteresis / 持仓状态
- 不新建多版本主策略名
