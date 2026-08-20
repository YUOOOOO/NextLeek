"""
Combo WFO 入口脚本 - 全空间搜索
================================================================================
设计理念：策略开发初期应该追求**广度**而非精度

工作流程：
1. WFO阶段：全空间搜索（18因子 × [2,3,4,5,6,7]阶 ≈ 62,985组合）
   - 利用WFO快速验证能力（~2分钟完成）
   - 输出Top-N候选组合（默认Top-100）

2. VEC阶段：精细化验证（scripts/run_full_space_vec_backtest.py）
   - 对WFO输出的Top-N进行完整回测
   - 计算详细指标（收益、Sharpe、MaxDD等）

3. 筛选阶段：多维度过滤（scripts/select_strategy_v2.py）
   - IC门槛过滤
   - 综合得分排序
   - 复杂度约束
   - Holdout验证

⚠️ 不要在WFO阶段就做过多限制，让数据说话！
预期组合数：C(18,2) + C(18,3) + ... + C(18,7) ≈ 62,985
"""

import sys
import os
from pathlib import Path

# Must set NUMBA_NUM_THREADS before any Numba import to prevent
# thread pool conflict when FactorCache misses and triggers parallel @njit
if not os.getenv("NUMBA_NUM_THREADS"):
    cpu_count = os.cpu_count() or 8
    n_jobs = min(cpu_count // 2, 8)  # mirror _get_optimal_n_jobs logic
    os.environ["NUMBA_NUM_THREADS"] = str(max(1, cpu_count // n_jobs))

import yaml
import logging
from datetime import datetime

from etf_strategy.core.utils.run_meta import write_step_meta
import numpy as np
import pandas as pd

# ROOT应该指向项目根目录
ROOT = Path(os.environ.get("ETF_STRATEGY_ROOT", str(Path(__file__).resolve().parents[2]))).resolve()

# 添加 src/ 到路径（确保 etf_strategy 包可导入）
sys.path.insert(0, str(ROOT / "src"))

from etf_strategy.core.data_loader import DataLoader
from etf_strategy.core.precise_factor_library_v2 import PreciseFactorLibrary
from etf_strategy.core.cross_section_processor import CrossSectionProcessor
from etf_strategy.core.combo_wfo_optimizer import ComboWFOOptimizer, ComboWFOConfig
from etf_strategy.core.market_timing import LightTimingModule
from etf_strategy.regime_gate import compute_regime_gate_arr, gate_stats

# 配置日志
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# ============================================================================
# 配置说明
# ============================================================================
# ⚠️ 不在此处硬编码因子和组合阶数，全部从配置文件读取
# 原因：策略开发初期应该追求广度，利用WFO/VEC快速验证能力
# 过滤和筛选应该在后续阶段进行（VEC验证 + 综合筛选）


def main():
    """主流程"""
    print("=" * 80)
    print("� Combo WFO - 全空间搜索（广度优先）")
    print("=" * 80)

    # 1. 加载配置
    config_path = Path(
        os.environ.get("WFO_CONFIG_PATH", str(ROOT / "configs/combo_wfo_config.yaml"))
    )
    with open(config_path) as f:
        config = yaml.safe_load(f)

    print(f"\n✅ 配置加载完成")
    print(f"  数据路径: {config['data']['data_dir']}")
    print(
        f"  训练期: {config['data']['start_date']} ~ {config['data'].get('training_end_date', config['data']['end_date'])}"
    )

    # 2. 加载数据
    data_loader = DataLoader(
        data_dir=config["data"]["data_dir"],
        cache_dir=config["data"]["cache_dir"],
    )

    training_end = config["data"].get("training_end_date", config["data"]["end_date"])

    ohlcv_data = data_loader.load_ohlcv(
        etf_codes=config["data"]["symbols"],
        start_date=config["data"]["start_date"],
        end_date=training_end,
    )

    print(f"\n✅ 数据加载完成")
    print(f"  日期数: {len(ohlcv_data['close'])}")
    print(f"  ETF数: {len(config['data']['symbols'])}")

    # 3. 加载因子 (OHLCV + non-OHLCV via FactorCache)
    print(f"\n🔧 加载因子（含缓存 + 外部因子）...")
    from etf_strategy.core.factor_cache import FactorCache

    factor_cache = FactorCache(
        cache_dir=Path(config["data"].get("cache_dir", ".cache"))
    )
    data_dir = Path(config["data"]["data_dir"])
    cached = factor_cache.get_or_compute(ohlcv_data, config, data_dir)
    processed_factors = cached["std_factors"]
    all_factors = list(cached["factor_names"])
    print(f"✅ 因子加载完成: {len(all_factors)} 个")

    # 6. 择时信号
    print(f"\n⏰ 生成择时信号...")
    timing_config = config["backtest"]["timing"]
    timing_module = LightTimingModule(
        extreme_threshold=timing_config["extreme_threshold"],
        extreme_position=timing_config["extreme_position"],
    )

    timing_signals = timing_module.compute_position_ratios(ohlcv_data["close"])

    # 7. WFO配置（使用配置文件设置）
    print(f"\n⚙️ WFO配置:")
    wfo_cfg = config["combo_wfo"]
    combo_sizes = wfo_cfg.get("combo_sizes", [2, 3, 4, 5, 6, 7])
    print(f"  组合阶数: {combo_sizes}")
    print(f"  IS窗口: {wfo_cfg['is_period']} 天")
    print(f"  OOS窗口: {wfo_cfg['oos_period']} 天")
    print(f"  滚动步长: {wfo_cfg.get('step_size', 60)} 天")

    expected_combos = sum(
        [
            len(list(pd.Series(range(len(all_factors))).apply(lambda x: x).index))
            for size in combo_sizes
        ]
    )
    print(
        f"  预期组合数: ~{len(all_factors)}C{min(combo_sizes)}...{len(all_factors)}C{max(combo_sizes)}"
    )

    wfo_config = ComboWFOConfig(
        combo_sizes=combo_sizes,
        is_period=wfo_cfg["is_period"],
        oos_period=wfo_cfg["oos_period"],
        step_size=wfo_cfg.get("step_size", 60),
        n_jobs=wfo_cfg.get("n_jobs", -1),
        verbose=wfo_cfg.get("verbose", 1),
        enable_fdr=wfo_cfg.get("enable_fdr", True),
        fdr_alpha=wfo_cfg.get("fdr_alpha", 0.05),
        complexity_penalty_lambda=wfo_cfg["scoring"].get(
            "complexity_penalty_lambda", 0.01
        ),
    )

    # 7.5 正交因子集过滤
    active_factors_cfg = config.get("active_factors")
    if active_factors_cfg:
        active_set = set(active_factors_cfg)
        all_factor_set = set(processed_factors.keys())
        missing = active_set - all_factor_set
        if missing:
            logger.warning(
                f"⚠️ {len(missing)} 个外部因子未加载 (parquet 不存在): {sorted(missing)}"
            )
            logger.warning(
                "   → 仅使用已加载的因子继续运行，包含这些因子的组合将被跳过"
            )
        excluded = sorted(all_factor_set - active_set)
        processed_factors = {
            k: v for k, v in processed_factors.items() if k in active_set
        }
        all_factors = sorted(processed_factors.keys())
        print(f"✅ 正交因子集: {len(all_factors)}/{len(all_factor_set)} 个因子已激活")
        print(f"  已排除: {excluded}")

    # 8. 转换为 (T, N, F) 数组
    print(f"\n🔄 转换因子为3D数组...")
    factor_list = list(processed_factors.values())
    factors_array = np.stack([df.values for df in factor_list], axis=2)  # (T, N, F)
    factor_names = list(processed_factors.keys())
    print(f"  Shape: {factors_array.shape}")

    # 8b. 加载额外因子矩阵 (来自 factor mining prefilter)
    extra_cfg = config.get("combo_wfo", {}).get("extra_factors", {})
    env_npz = os.environ.get("EXTRA_FACTORS_NPZ")
    if env_npz:
        extra_cfg = {"enabled": True, "path": env_npz}
        print(f"  环境变量覆盖 extra_factors: {env_npz}")
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

        # Date alignment
        base_dates = [str(d.date()) if hasattr(d, "date") else str(d) for d in ohlcv_data["close"].index]
        if extra_dates == base_dates:
            date_slice = slice(None)
        elif set(base_dates).issubset(set(extra_dates)):
            start_idx = extra_dates.index(base_dates[0])
            end_idx = extra_dates.index(base_dates[-1])
            date_slice = slice(start_idx, end_idx + 1)
            sliced_dates = extra_dates[date_slice]
            if sliced_dates != base_dates:
                raise ValueError(
                    f"Date alignment failed: sliced extra has {len(sliced_dates)} dates "
                    f"but base has {len(base_dates)}"
                )
            print(f"  Extra factors date subset: {len(extra_dates)} → {len(base_dates)} dates")
        else:
            raise ValueError(
                f"Date mismatch: base has {len(base_dates)} dates "
                f"({base_dates[0]}~{base_dates[-1]}), "
                f"extra has {len(extra_dates)} ({extra_dates[0]}~{extra_dates[-1]})"
            )

        # Symbol alignment
        base_symbols = config["data"]["symbols"]
        if extra_symbols == base_symbols:
            symbol_indices = None
        elif set(base_symbols).issubset(set(extra_symbols)):
            symbol_indices = [extra_symbols.index(s) for s in base_symbols]
            print(f"  Extra factors symbol subset: {len(extra_symbols)} → {len(base_symbols)} ETFs")
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
            factors_array = np.concatenate([factors_array, extra_data], axis=-1)
            factor_names = factor_names + new_names

            # Register extra factors into bucket system
            import json as _json
            meta_path = extra_path.parent / "survivors_meta.json"
            if meta_path.exists():
                with open(meta_path) as f:
                    extra_meta = _json.load(f)
                bucket_map = extra_meta.get("factor_bucket_map", {})
                mapped = {n: b for n, b in bucket_map.items() if n in new_names and b != "UNMAPPED"}
                if mapped:
                    from etf_strategy.core.factor_buckets import register_extra_factors
                    register_extra_factors(mapped)
                    print(f"  Registered {len(mapped)} extra factors into buckets")

            print(f"✅ Extra factors loaded: +{len(new_names)} → total {len(factor_names)} factors")
            print(f"  New: {', '.join(new_names[:10])}{'...' if len(new_names) > 10 else ''}")
        else:
            print("  Extra factors: all already in base pool, skipped")

    print(f"✅ 因子准备完成: {len(factor_names)} 个因子, shape: {factors_array.shape}")

    # 9. 计算收益率
    returns_df = ohlcv_data["close"].pct_change()
    returns = returns_df.values

    # Regime gate（作为交易规则的一部分进入 WFO：用于 OOS 收益模拟）
    backtest_cfg = config.get("backtest", {})
    gate_arr = compute_regime_gate_arr(
        ohlcv_data["close"],
        returns_df.index,
        backtest_config=backtest_cfg,
    )
    if bool((backtest_cfg.get("regime_gate") or {}).get("enabled", False)):
        stats = gate_stats(gate_arr)
        print(
            f"🧯 Regime gate enabled (WFO): mean={stats['mean']:.3f} min={stats['min']:.3f} max={stats['max']:.3f}"
        )

    # 10. 运行WFO
    print(f"\n🚀 开始WFO优化（全空间搜索）...")

    # 跨桶约束配置
    bucket_cfg = wfo_cfg.get("bucket_constraints", {})

    optimizer = ComboWFOOptimizer(
        combo_sizes=combo_sizes,
        is_period=wfo_cfg["is_period"],
        oos_period=wfo_cfg["oos_period"],
        step_size=wfo_cfg.get("step_size", 60),
        n_jobs=wfo_cfg.get("n_jobs", -1),
        verbose=wfo_cfg.get("verbose", 1),
        enable_fdr=wfo_cfg.get("enable_fdr", True),
        fdr_alpha=wfo_cfg.get("fdr_alpha", 0.05),
        complexity_penalty_lambda=wfo_cfg["scoring"].get(
            "complexity_penalty_lambda", 0.01
        ),
        use_bucket_constraints=bucket_cfg.get("enabled", False),
        bucket_min_buckets=bucket_cfg.get("min_buckets", 3),
        bucket_max_per_bucket=bucket_cfg.get("max_per_bucket", 2),
    )

    top_combos, results_df = optimizer.run_combo_search(
        factors_data=factors_array,
        returns=returns,
        factor_names=factor_names,
        top_n=wfo_cfg.get("top_n", 100),
        pos_size=config["backtest"]["pos_size"],
        commission_rate=config["backtest"]["commission_rate"],
        exposures=gate_arr,
    )

    # 11. 保存结果
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = ROOT / f"results/run_{timestamp}"
    output_dir.mkdir(parents=True, exist_ok=True)

    # 保存完整结果
    full_output_file = output_dir / "full_combo_results.csv"
    results_df.to_csv(full_output_file, index=False)

    # 保存 Top 组合
    top_output_file = output_dir / "top_combos.csv"
    top_df = pd.DataFrame(top_combos)
    top_df.to_csv(top_output_file, index=False)

    print(f"\n💾 结果保存至:")
    print(f"  完整结果: {full_output_file}")
    print(f"  Top组合: {top_output_file}")
    print(f"  组合总数: {len(results_df)}, Top-N: {len(top_combos)}")

    write_step_meta(output_dir, step="wfo", config=str(config_path), extras={"combo_count": len(results_df), "top_n": len(top_combos)})

    # 12. 输出Top20
    print(f"\n🏆 Top20 组合 (按IC排序)")
    print("-" * 80)

    # 使用WFO返回的列名
    results_sorted = results_df.sort_values("mean_oos_ic", ascending=False)

    for idx, row in results_sorted.head(20).iterrows():
        combo_display = (
            row["combo"][:65] + "..." if len(row["combo"]) > 68 else row["combo"]
        )
        print(f"{idx+1:3d}. {combo_display:68s}")
        print(
            f"     IC={row['mean_oos_ic']:+.4f} | IR={row.get('oos_ic_ir', 0):.2f} | "
            f"正率={row.get('positive_rate', 0):.1%} | 阶数={row.get('combo_size', 0)}"
        )

    print(f"\n✅ WFO完成（全空间搜索）")
    print("=" * 80)

    print(f"\n📋 下一步工作流程:")
    print(f"  1. VEC精算: uv run python scripts/run_full_space_vec_backtest.py")
    print(f"     - 对Top-{len(top_combos)}组合进行完整回测")
    print(f"     - 计算收益/Sharpe/MaxDD等详细指标")
    print(f"  ")
    print(f"  2. 策略筛选: uv run python scripts/select_strategy_v2.py")
    print(f"     - IC门槛过滤")
    print(f"     - 综合得分排序")
    print(f"     - 可选：复杂度约束、因子黑名单等")
    print(f"  ")
    print(f"  3. Holdout验证: 验证最终筛选结果的样本外表现")


if __name__ == "__main__":
    main()
