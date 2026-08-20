#!/usr/bin/env python3
"""
组合级WFO优化启动脚本

功能：
1. 加载OHLCV数据
2. 计算精确因子库
3. 横截面标准化处理
4. 执行组合级Walk-Forward优化
5. 保存Top组合到 results/run_XXXXXX/

输出：
- results/run_XXXXXX/top100_by_ic.parquet
- results/run_XXXXXX/all_combos.parquet
- results/run_XXXXXX/wfo_summary.json

用法：
    python run_combo_wfo.py
"""

import json
import logging
import os
import sys
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

# Ensure src/ is on sys.path when running as a script
ROOT = Path(os.environ.get("ETF_STRATEGY_ROOT", str(Path(__file__).resolve().parents[2]))).resolve()
sys.path.insert(0, str(ROOT / "src"))

from etf_strategy.core.combo_wfo_optimizer import (
    ComboWFOOptimizer,
    warmup_numba_kernels,
)
from etf_strategy.core.cross_section_processor import CrossSectionProcessor
from etf_strategy.core.data_loader import DataLoader
from etf_strategy.core.factor_cache import FactorCache
from etf_strategy.core.cost_model import load_cost_model, build_cost_array
from etf_strategy.core.frozen_params import load_frozen_config, FrozenETFPool
from etf_strategy.core.precise_factor_library_v2 import PreciseFactorLibrary
from etf_strategy.regime_gate import compute_regime_gate_arr, gate_stats

# 设置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def main():
    """主函数"""

    # ========== 1. 加载配置 ==========
    logger.info("=" * 100)
    logger.info("🚀 组合级WFO优化启动")
    logger.info("=" * 100)
    logger.info("")

    config_path = Path(
        os.environ.get("WFO_CONFIG_PATH", "configs/combo_wfo_config.yaml")
    )
    if not config_path.exists():
        logger.error(f"配置文件不存在: {config_path}")
        sys.exit(1)

    with open(config_path, "r") as f:
        config = yaml.safe_load(f)

    frozen = load_frozen_config(config, config_path=str(config_path))
    logger.info(f"🔒 参数冻结校验通过 (version={frozen.version})")

    logger.info("✅ 配置加载成功")
    logger.info(f"  - ETF数量: {len(config['data']['symbols'])}")
    logger.info(
        f"  - 日期范围: {config['data']['start_date']} → {config['data']['end_date']}"
    )
    logger.info(f"  - 组合规模: {config['combo_wfo']['combo_sizes']}")
    logger.info(f"  - IS窗口: {config['combo_wfo']['is_period']}天")
    logger.info(f"  - OOS窗口: {config['combo_wfo']['oos_period']}天")
    logger.info("")

    # 环境变量覆盖：可通过 RB_FREQ_SUBSET 指定逗号分隔的换仓频率列表（例如 "8" 或 "8,16,24"）
    # 可通过 RB_RESULT_TS 指定输出目录的时间戳，以便与启动脚本的日志时间戳一致。
    env_freq = os.environ.get("RB_FREQ_SUBSET")
    if env_freq:
        try:
            override = [int(x.strip()) for x in env_freq.split(",") if x.strip()]
            if override:
                config["combo_wfo"]["rebalance_frequencies"] = override
                logger.info(f"🔧 通过环境变量覆盖频率: RB_FREQ_SUBSET={override}")
        except Exception as e:
            logger.warning(f"忽略非法的 RB_FREQ_SUBSET 值: {env_freq} ({e})")
    env_ts = os.environ.get("RB_RESULT_TS", "").strip()
    if env_ts:
        logger.info(f"🔧 使用外部指定时间戳 RB_RESULT_TS={env_ts}")

    # ========== 2. 加载数据 ==========
    logger.info("=" * 100)
    logger.info("📊 加载OHLCV数据")
    logger.info("=" * 100)

    loader = DataLoader(
        data_dir=config["data"].get("data_dir"),
        cache_dir=config["data"].get("cache_dir"),
    )

    # 使用 training_end_date 如果设置了（Holdout验证模式）
    data_end_date = (
        config["data"].get("training_end_date") or config["data"]["end_date"]
    )

    if config["data"].get("training_end_date"):
        logger.info("=" * 100)
        logger.info("🔬 HOLDOUT验证模式")
        logger.info("=" * 100)
        logger.info(f"训练集截止日期: {data_end_date}")
        logger.info(f"完整数据截止日期: {config['data']['end_date']}")
        logger.info(f"Holdout期: {data_end_date} 至 {config['data']['end_date']}")
        logger.info("⚠️  注意: 当前仅使用训练集数据，Holdout期数据将用于最终验证")
        logger.info("")

    ohlcv = loader.load_ohlcv(
        etf_codes=config["data"]["symbols"],
        start_date=config["data"]["start_date"],
        end_date=data_end_date,  # 使用训练集截止日期
        use_cache=True,
    )

    logger.info(f"✅ 数据加载完成")
    logger.info(f"  - 交易日数: {len(ohlcv['close'])}")
    logger.info(f"  - ETF数量: {len(ohlcv['close'].columns)}")
    logger.info("")

    # ========== 3-4. 计算因子 + 横截面标准化 (带缓存) ==========
    logger.info("=" * 100)
    logger.info("🔧 计算精确因子库 + 横截面标准化 (带缓存)")
    logger.info("=" * 100)

    factor_cache = FactorCache(
        cache_dir=Path(config["data"].get("cache_dir") or ".cache")
    )
    cached = factor_cache.get_or_compute(
        ohlcv=ohlcv,
        config=config,
        data_dir=loader.data_dir,
    )
    standardized_factors = cached["std_factors"]
    all_factor_names = list(cached["factor_names"])  # Convert to list for modification
    factors_3d = cached["factors_3d"]
    dates = cached["dates"]
    etf_codes = cached["etf_codes"]

    # ── 正交因子集过滤 ──
    # (non-OHLCV factors already loaded by FactorCache)
    active_factors_cfg = config.get("active_factors")
    if active_factors_cfg:
        active_set = set(active_factors_cfg)
        missing = active_set - set(all_factor_names)
        if missing:
            logger.warning(
                f"⚠️ {len(missing)} 个外部因子未加载 (parquet 不存在): {sorted(missing)}"
            )
            logger.warning(
                "   → 仅使用已加载的因子继续运行，包含这些因子的组合将被跳过"
            )
        factor_names = sorted(active_set & set(all_factor_names))
        idx_map = {name: i for i, name in enumerate(all_factor_names)}
        selected_idx = [idx_map[f] for f in factor_names]
        factors_data = factors_3d[:, :, selected_idx]
        logger.info(
            f"✅ 正交因子集: {len(factor_names)}/{len(all_factor_names)} 个因子已激活"
        )
        logger.info(f"  已排除: {sorted(set(all_factor_names) - active_set)}")
    else:
        factor_names = all_factor_names
        factors_data = factors_3d

    # ── 加载额外因子矩阵 (来自 factor mining prefilter) ──
    extra_cfg = config.get("combo_wfo", {}).get("extra_factors", {})
    # 环境变量覆盖 config 中的 extra_factors 设置
    env_npz = os.environ.get("EXTRA_FACTORS_NPZ")
    if env_npz:
        extra_cfg = {"enabled": True, "path": env_npz}
        logger.info(f"环境变量覆盖 extra_factors: {env_npz}")
    if extra_cfg.get("enabled", False):
        extra_path = Path(extra_cfg["path"])
        if not extra_path.is_absolute():
            extra_path = ROOT / extra_path

        if not extra_path.exists():
            raise FileNotFoundError(f"Extra factors not found: {extra_path}")

        extra = np.load(extra_path)
        extra_names = list(extra["factor_names"])
        extra_dates = list(extra["dates"])
        extra_symbols = list(extra["symbols"])

        # Date alignment: extra may have more dates (mining uses full data,
        # WFO uses training_end_date). Subset extra to base date range.
        base_dates = [str(d.date()) for d in cached["dates"]]
        if extra_dates == base_dates:
            date_slice = slice(None)  # Perfect match
        elif set(base_dates).issubset(set(extra_dates)):
            # Extra has more dates — find contiguous slice
            start_idx = extra_dates.index(base_dates[0])
            end_idx = extra_dates.index(base_dates[-1])
            date_slice = slice(start_idx, end_idx + 1)
            sliced_dates = extra_dates[date_slice]
            if sliced_dates != base_dates:
                raise ValueError(
                    f"Date alignment failed: sliced extra has {len(sliced_dates)} dates "
                    f"but base has {len(base_dates)}"
                )
            logger.info(
                f"  Extra factors date subset: {len(extra_dates)} → {len(base_dates)} dates"
            )
        else:
            raise ValueError(
                f"Date mismatch: base has {len(base_dates)} dates "
                f"({base_dates[0]}~{base_dates[-1]}), "
                f"extra has {len(extra_dates)} ({extra_dates[0]}~{extra_dates[-1]})"
            )

        # Symbol alignment: extra may have more symbols than WFO (mining loads
        # all parquet files, WFO uses config symbol list). Subset to base symbols.
        base_symbols = cached["etf_codes"]
        if extra_symbols == base_symbols:
            symbol_indices = None  # Perfect match
        elif set(base_symbols).issubset(set(extra_symbols)):
            symbol_indices = [extra_symbols.index(s) for s in base_symbols]
            logger.info(
                f"  Extra factors symbol subset: {len(extra_symbols)} → {len(base_symbols)} ETFs"
            )
        else:
            missing = set(base_symbols) - set(extra_symbols)
            raise ValueError(
                f"Symbol mismatch: base needs {sorted(missing)} "
                f"but extra only has {len(extra_symbols)} symbols"
            )

        # Exclude factors already in base pool
        new_mask = [n not in set(factor_names) for n in extra_names]
        new_indices = [i for i, keep in enumerate(new_mask) if keep]
        new_names = [extra_names[i] for i in new_indices]

        if new_names:
            raw_extra = extra["data"][date_slice, :, :][:, :, new_indices]
            if symbol_indices is not None:
                extra_data = raw_extra[:, symbol_indices, :]
            else:
                extra_data = raw_extra
            factors_data = np.concatenate([factors_data, extra_data], axis=-1)
            factor_names = factor_names + new_names

            # Register extra factors into bucket system
            meta_path = extra_path.parent / "survivors_meta.json"
            if meta_path.exists():
                with open(meta_path) as f:
                    extra_meta = json.load(f)
                bucket_map = extra_meta.get("factor_bucket_map", {})
                mapped = {
                    n: b
                    for n, b in bucket_map.items()
                    if n in new_names and b != "UNMAPPED"
                }
                if mapped:
                    from etf_strategy.core.factor_buckets import register_extra_factors

                    register_extra_factors(mapped)
                    logger.info(
                        f"  Registered {len(mapped)} extra factors into buckets"
                    )

            logger.info(
                f"✅ Extra factors loaded: +{len(new_names)} → "
                f"total {len(factor_names)} factors"
            )
            logger.info(
                f"  New: {', '.join(new_names[:10])}{'...' if len(new_names) > 10 else ''}"
            )
        else:
            logger.info("  Extra factors: all already in base pool, skipped")

    logger.info(f"✅ 因子准备完成: {len(factor_names)} 个因子")
    logger.info(f"  - 因子列表: {', '.join(factor_names[:10])}...")
    logger.info("")

    # ========== 5. 准备数据 ==========
    logger.info("=" * 100)
    logger.info("🔄 准备WFO输入数据")
    logger.info("=" * 100)

    # 准备收益率
    returns_df = ohlcv["close"].pct_change()
    returns = returns_df.values

    # Regime gate（作为交易规则的一部分进入 WFO：用于 OOS 收益模拟）
    backtest_cfg = config.get("backtest", {})
    gate_arr = compute_regime_gate_arr(
        ohlcv["close"],
        returns_df.index,
        backtest_config=backtest_cfg,
    )
    if bool((backtest_cfg.get("regime_gate") or {}).get("enabled", False)):
        stats = gate_stats(gate_arr)
        logger.info(
            "🧯 Regime gate enabled (WFO): mean=%.3f min=%.3f max=%.3f",
            stats["mean"],
            stats["min"],
            stats["max"],
        )

    logger.info(f"✅ 数据准备完成")
    logger.info(
        f"  - 数据维度: {factors_data.shape[0]}天 × {factors_data.shape[1]}只ETF × {factors_data.shape[2]}个因子"
    )
    logger.info(f"  - 因子名称: {factor_names}")
    logger.info("")

    # ========== 5.5 Numba 预热 ==========
    warmup_numba_kernels()

    # ========== 6. 执行WFO优化 ==========
    logger.info("=" * 100)
    logger.info("⚡ 执行组合级WFO优化")
    logger.info("=" * 100)
    logger.info("")

    # 跨桶约束配置 (默认关闭, 需在 combo_wfo.bucket_constraints 中启用)
    bucket_cfg = config["combo_wfo"].get("bucket_constraints", {})

    # Hysteresis 配置 (从 backtest.hysteresis 读取)
    hyst_cfg = config.get("backtest", {}).get("hysteresis", {})

    optimizer = ComboWFOOptimizer(
        combo_sizes=config["combo_wfo"]["combo_sizes"],
        is_period=config["combo_wfo"]["is_period"],
        oos_period=config["combo_wfo"]["oos_period"],
        step_size=config["combo_wfo"]["step_size"],
        n_jobs=config["combo_wfo"]["n_jobs"],
        verbose=1 if config["combo_wfo"]["verbose"] else 0,
        enable_fdr=config["combo_wfo"]["enable_fdr"],
        fdr_alpha=config["combo_wfo"]["fdr_alpha"],
        complexity_penalty_lambda=config["combo_wfo"]["scoring"][
            "complexity_penalty_lambda"
        ],
        rebalance_frequencies=config["combo_wfo"]["rebalance_frequencies"],
        use_t1_open=config.get("backtest", {}).get("execution_model", "COC")
        == "T1_OPEN",
        delta_rank=float(hyst_cfg.get("delta_rank", 0.0)),
        min_hold_days=int(hyst_cfg.get("min_hold_days", 0)),
        use_bucket_constraints=bucket_cfg.get("enabled", False),
        bucket_min_buckets=bucket_cfg.get("min_buckets", 3),
        bucket_max_per_bucket=bucket_cfg.get("max_per_bucket", 2),
        max_parent_occurrence=bucket_cfg.get("max_parent_occurrence", 0),
    )

    # ✅ Exp2: 加载成本模型 → 构建 per-ETF 成本数组
    cost_model = load_cost_model(config)
    etf_codes = list(ohlcv["close"].columns)
    qdii_set = set(FrozenETFPool().qdii_codes)
    cost_arr = build_cost_array(cost_model, etf_codes, qdii_set)
    tier = cost_model.active_tier
    logger.info(
        f"✅ 成本模型: mode={cost_model.mode}, tier={cost_model.tier}, "
        f"A股={tier.a_share * 10000:.0f}bp, QDII={tier.qdii * 10000:.0f}bp"
    )

    top_combos_list, all_combos_df = optimizer.run_combo_search(
        factors_data=factors_data,
        returns=returns,
        factor_names=factor_names,
        top_n=config["combo_wfo"].get("top_n", 100),
        pos_size=config["backtest"].get("pos_size", 2),
        commission_rate=config["backtest"].get("commission_rate", 0.0002),
        cost_arr=cost_arr,
        exposures=gate_arr,
    )

    logger.info("")
    logger.info("✅ WFO优化完成")
    logger.info("")

    # ========== 7. 保存结果 ==========
    logger.info("=" * 100)
    logger.info("💾 保存结果")
    logger.info("=" * 100)

    # 创建输出目录（原子写入）：pending_run_<ts> -> run_<ts>
    timestamp = env_ts if env_ts else datetime.now().strftime("%Y%m%d_%H%M%S")
    results_root = Path("results").resolve()
    final_dir = results_root / f"run_{timestamp}"
    pending_dir = results_root / f"pending_run_{timestamp}"
    if pending_dir.exists():
        import shutil

        logger.warning(f"清理残留的临时目录: {pending_dir}")
        shutil.rmtree(pending_dir, ignore_errors=True)
    pending_dir.mkdir(parents=True, exist_ok=True)

    # 保存配置 (匹配现有格式)
    run_config = {
        "timestamp": timestamp,
        "config_file": "configs/combo_wfo_config.yaml",
        "quick_mode": False,
        "parameters": {
            "run_id": config.get("run_id", "COMBO_WFO_DEEP_MINING"),
            "data": config["data"],
            "cross_section": config["cross_section"],
            "combo_wfo": config["combo_wfo"],
            "output_root": config.get("output_root", "results_combo_wfo"),
        },
    }

    with open(pending_dir / "run_config.json", "w", encoding="utf-8") as f:
        json.dump(run_config, f, indent=2, ensure_ascii=False)

    logger.info(f"✅ 配置已保存: {pending_dir}/run_config.json")

    # 保存WFO结果
    all_combos_df.to_parquet(pending_dir / "all_combos.parquet", index=False)
    logger.info(
        f"✅ 全部组合已保存: {pending_dir}/all_combos.parquet ({len(all_combos_df)} 个组合)"
    )

    # 保存Top组合 (匹配现有文件名: top_combos.parquet)
    top_n = config["combo_wfo"].get("top_n", 100)
    top_combos = all_combos_df.head(top_n)  # 已经排序过了
    top_combos.to_parquet(pending_dir / "top_combos.parquet", index=False)
    logger.info(f"✅ Top{top_n}组合已保存: {pending_dir}/top_combos.parquet")

    # 同时保存为 top100_by_ic.parquet (为了兼容回测脚本)
    top_combos.to_parquet(pending_dir / "top100_by_ic.parquet", index=False)
    logger.info(f"✅ Top{top_n}组合已保存(兼容): {pending_dir}/top100_by_ic.parquet")

    # 保存因子数据到 factors/ 目录 (仅base因子; extra因子已在mining输出中)
    factors_dir = pending_dir / "factors"
    factors_dir.mkdir(exist_ok=True)
    saved_count = 0
    for factor_name in factor_names:
        if factor_name in standardized_factors:
            factor_df = standardized_factors[factor_name]
            factor_df.to_parquet(factors_dir / f"{factor_name}.parquet")
            saved_count += 1
    skipped = len(factor_names) - saved_count
    msg = f"✅ {saved_count}个因子已保存: {factors_dir}/"
    if skipped > 0:
        msg += f" (跳过{skipped}个extra因子)"
    logger.info(msg)

    # 保存因子筛选汇总 (匹配现有格式)
    factor_selection_summary = {
        "timestamp": timestamp,
        "n_factors": len(factor_names),
        "factor_names": factor_names,
        "data_shape": {
            "n_days": factors_data.shape[0],
            "n_etfs": factors_data.shape[1],
            "n_factors": factors_data.shape[2],
        },
        "winsorize": {
            "lower": config["cross_section"]["winsorize_lower"],
            "upper": config["cross_section"]["winsorize_upper"],
        },
    }

    with open(
        pending_dir / "factor_selection_summary.json", "w", encoding="utf-8"
    ) as f:
        json.dump(factor_selection_summary, f, indent=2, ensure_ascii=False)

    logger.info(f"✅ 因子汇总已保存: {pending_dir}/factor_selection_summary.json")

    # 保存WFO汇总信息 (匹配现有格式)
    significant_combos = all_combos_df[all_combos_df.get("is_significant", True)]

    summary = {
        "timestamp": timestamp,
        "total_combos": len(all_combos_df),
        "significant_combos": len(significant_combos),
        "mean_ic": float(all_combos_df["mean_oos_ic"].mean()),
        "mean_oos_return": (
            float(all_combos_df["mean_oos_return"].mean())
            if "mean_oos_return" in all_combos_df.columns
            else 0.0
        ),
        "best_combo": {
            "combo": top_combos.iloc[0]["combo"],
            "ic": float(top_combos.iloc[0]["mean_oos_ic"]),
            "score": float(top_combos.iloc[0]["stability_score"]),
            "freq": int(top_combos.iloc[0]["best_rebalance_freq"]),
            "mean_oos_return": (
                float(top_combos.iloc[0]["mean_oos_return"])
                if "mean_oos_return" in top_combos.columns
                else 0.0
            ),
            "cum_oos_return": (
                float(top_combos.iloc[0]["cum_oos_return"])
                if "cum_oos_return" in top_combos.columns
                else 0.0
            ),
        },
        "config": {
            "is_period": config["combo_wfo"]["is_period"],
            "oos_period": config["combo_wfo"]["oos_period"],
            "step_size": config["combo_wfo"]["step_size"],
            "combo_sizes": config["combo_wfo"]["combo_sizes"],
            "pos_size": config["backtest"].get("pos_size", 2),
        },
        "runtime_minutes": 0.0,  # 运行时间将在后续更新
    }

    with open(pending_dir / "wfo_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    logger.info(f"✅ WFO汇总已保存: {pending_dir}/wfo_summary.json")
    # 原子切换到最终目录
    try:
        if final_dir.exists():
            import shutil

            logger.warning(f"目标目录已存在，将被替换: {final_dir}")
            shutil.rmtree(final_dir, ignore_errors=True)
        pending_dir.rename(final_dir)
        # 写入就绪标记
        (final_dir / "READY").write_text("ok", encoding="utf-8")
        # 维护指针
        latest_ptr = results_root / ".latest_run"
        latest_ptr.write_text(final_dir.name, encoding="utf-8")
        latest_link = results_root / "run_latest"
        try:
            if latest_link.exists() or latest_link.is_symlink():
                latest_link.unlink()
            latest_link.symlink_to(final_dir)
        except Exception as e:
            logger.warning(f"创建最新运行符号链接失败: {e}")
    except Exception as e:
        logger.error(f"切换到最终目录失败: {e}")
        raise
    logger.info("")

    # ========== 8. 结果汇总 ==========
    logger.info("=" * 100)
    logger.info("📊 结果汇总")
    logger.info("=" * 100)
    logger.info("")
    logger.info(f"输出目录: {final_dir}")
    logger.info(f"总组合数: {summary['total_combos']}")
    logger.info("")
    logger.info("🏆 Top 1 组合:")
    logger.info(f"  - 名称: {summary['best_combo']['combo']}")
    logger.info(f"  - OOS Sharpe: {summary['best_combo']['ic']:.4f} (原IC字段)")
    logger.info(f"  - 稳定性得分: {summary['best_combo']['score']:.2f}")
    logger.info(f"  - 最优换仓频率: {summary['best_combo']['freq']}天")
    if "best_trailing_stop" in top_combos.iloc[0]:
        logger.info(
            f"  - 最优动态止损: {top_combos.iloc[0]['best_trailing_stop'] * 100:.1f}%"
        )
    logger.info("")
    logger.info("📈 整体统计:")
    logger.info(f"  - 平均OOS Sharpe: {summary['mean_ic']:.4f}")
    logger.info(
        f"  - 显著组合数: {summary['significant_combos']}/{summary['total_combos']}"
    )
    logger.info("")
    logger.info("=" * 100)
    logger.info("✅ WFO优化完成！")
    logger.info("=" * 100)
    logger.info("")
    logger.info("💡 下一步:")
    logger.info("   运行真实回测: python test_freq_no_lookahead.py")
    logger.info("")


if __name__ == "__main__":
    main()
