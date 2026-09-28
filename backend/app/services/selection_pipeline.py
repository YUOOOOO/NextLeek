"""选股管线 — 串联情绪→板块→策略→因子→可行性五层过滤。

职责:
  以策略为核心，在其上叠加环境(情绪周期)与板块(主线)上下文，
  输出带评分明细的候选池 + 买入理由。

不知道: HTTP、前端、配置持久化。
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import polars as pl

from app.config import settings

logger = logging.getLogger(__name__)

# 情绪周期 → 仓位上限映射
PHASE_POSITION_LIMIT: dict[str, float] = {
    "ice": 0.0,       # 冰点 → 空仓
    "ebb": 0.3,       # 退潮 → 30%
    "repair": 0.3,    # 修复 → 30%
    "ignite": 0.7,    # 启动 → 70%
    "rally": 1.0,     # 主升 → 满仓
    "climax": 0.5,    # 高潮 → 50%（开始谨慎）
}

# 情绪周期 → 中文标签
PHASE_LABELS: dict[str, str] = {
    "ice": "冰点期",
    "ignite": "启动期",
    "rally": "主升期",
    "climax": "高潮期",
    "ebb": "退潮期",
    "repair": "修复期",
}


@dataclass
class EnvironmentInfo:
    """市场环境快照"""
    phase: str                              # ice/ignite/rally/climax/ebb/repair
    phase_label: str                        # 中文标签
    position_limit: float                   # 0.0 ~ 1.0
    main_sectors: list[str] = field(default_factory=list)
    height: int = 0                         # 最高连板数
    limit_up_count: int = 0                 # 涨停家数
    promotion_rate: float = 0.0             # 晋级率
    seal_rate: float = 0.0                  # 封板率


@dataclass
class FactorContribution:
    """单因子贡献"""
    factor_id: str
    factor_label: str
    raw_value: float | None
    weight: float
    contribution: float                     # 加权后的贡献值


@dataclass
class Candidate:
    """候选股票"""
    symbol: str
    name: str
    score: float
    close: float
    pct_chg: float
    turnover_rate: float
    amount: float
    float_mv: float | None
    consecutive_limit_ups: int = 0
    factor_contributions: list[FactorContribution] = field(default_factory=list)
    strategy_hits: list[str] = field(default_factory=list)
    sector: str | None = None
    suggested_position: float = 0.0         # 建议仓位百分比
    stop_loss: float | None = None
    entry_low: float | None = None
    entry_high: float | None = None


@dataclass
class SelectionResult:
    """选股结果"""
    as_of: date
    environment: EnvironmentInfo
    strategy_id: str
    strategy_name: str
    candidates: list[Candidate]
    total_scored: int = 0
    filtered_out: dict[str, int] = field(default_factory=dict)
    elapsed_ms: float = 0.0
    skip_reason: str | None = None           # 如果情绪不适合，说明原因


class SelectionPipeline:
    """
    选股管线

    用法:
        pipeline = SelectionPipeline(repo, data_dir)
        result = pipeline.run("limit_up_momentum", target_date)
    """

    def __init__(self, repo, data_dir: str | None = None) -> None:
        self.repo = repo
        if data_dir:
            self.data_dir = data_dir
        else:
            self.data_dir = str(getattr(settings, "data_dir", ""))

    def run(
        self,
        strategy_id: str,
        target_date: date | None = None,
        *,
        sector_filter: bool = True,
        phase_filter: bool = True,
        limit: int = 50,
        position_limit_override: float | None = None,
    ) -> SelectionResult:
        """运行选股管线

        Args:
            strategy_id: 策略ID (对应 builtin 策略)
            target_date: 选股日期，None=最新
            sector_filter: 是否启用板块主线过滤
            phase_filter: 是否启用情绪过滤
            limit: 最大候选数
            position_limit_override: 手动覆盖仓位上限
        """
        t0 = time.perf_counter()

        if target_date is None:
            target_date = self._latest_date()

        # ── 第0层: 获取环境 ──
        env = self._get_environment(target_date)

        # ── 第1层: 情绪门 ──
        if phase_filter and env.position_limit == 0.0:
            return SelectionResult(
                as_of=target_date,
                environment=env,
                strategy_id=strategy_id,
                strategy_name=strategy_id,
                candidates=[],
                skip_reason=f"当前处于{env.phase_label}，建议空仓观望",
                elapsed_ms=(time.perf_counter() - t0) * 1000,
            )

        effective_limit = position_limit_override if position_limit_override is not None else env.position_limit

        # ── 第2层: 加载数据 + 板块过滤 ──
        df = self._load_and_filter(target_date, sector_filter, env)
        filtered_out: dict[str, int] = {}
        if df.is_empty():
            return SelectionResult(
                as_of=target_date,
                environment=env,
                strategy_id=strategy_id,
                strategy_name=strategy_id,
                candidates=[],
                filtered_out=filtered_out,
                skip_reason="无符合板块/基础条件的股票",
                elapsed_ms=(time.perf_counter() - t0) * 1000,
            )

        # ── 第3层: 执行策略评分 ──
        scored, strategy_name = self._execute_strategy(df, strategy_id, target_date)

        if scored.is_empty():
            return SelectionResult(
                as_of=target_date,
                environment=env,
                strategy_id=strategy_id,
                strategy_name=strategy_name,
                candidates=[],
                total_scored=df.height,
                filtered_out=filtered_out,
                elapsed_ms=(time.perf_counter() - t0) * 1000,
            )

        # ── 第4层: 构建候选 ──
        candidates = self._build_candidates(scored, env, effective_limit, limit)

        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "selection pipeline: strategy=%s date=%s candidates=%d elapsed=%.0fms",
            strategy_id, target_date, len(candidates), elapsed,
        )

        return SelectionResult(
            as_of=target_date,
            environment=env,
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            candidates=candidates,
            total_scored=scored.height,
            filtered_out=filtered_out,
            elapsed_ms=elapsed,
        )

    # ──────────────────────────────────────────────
    # 内部方法
    # ──────────────────────────────────────────────

    def _latest_date(self) -> date:
        """获取最新数据日期"""
        from datetime import date as dt_date
        latest = self.repo.latest_enriched_date("stock")
        if latest is not None:
            return latest
        return dt_date.today()

    def _get_environment(self, target_date: date) -> EnvironmentInfo:
        """获取市场环境"""
        from pathlib import Path
        data_dir = Path(self.data_dir)

        phase = "repair"  # 默认
        height = 0
        limit_up_count = 0
        promo_rate = 0.0
        seal_rate = 0.0

        # 读取 regime 历史获取情绪周期
        try:
            from app.services.regime_builder import load_regime_history
            from app.services.market_phase import PHASE_LABELS

            regime_df = load_regime_history(data_dir)
            if not regime_df.is_empty() and "phase" in regime_df.columns:
                # 找到 target_date 或最近的
                date_col = regime_df["date"]
                mask = date_col <= target_date
                if mask.any():
                    row = regime_df.filter(mask).sort("date", descending=True).head(1).row(0, named=True)
                    phase = row.get("phase", "repair")
                    height = int(row.get("max_consecutive", 0) or 0)
                    limit_up_count = int(row.get("first_board", 0) or 0)
                    promo_rate = float(row.get("promo_rate", 0) or 0)
                    seal_rate = float(row.get("seal_rate", 0) or 0)
        except Exception as e:  # noqa: BLE001
            logger.warning("get_environment: regime read failed: %s", e)

        # 获取主线板块
        main_sectors: list[str] = []
        try:
            from app.services.market_mainline import load_mainline_history
            ml_df = load_mainline_history(data_dir, kind="concept")
            if not ml_df.is_empty():
                # 获取 target_date 当天的 top 板块
                if "date" in ml_df.columns:
                    day_df = ml_df.filter(pl.col("date") == target_date)
                    if not day_df.is_empty() and "name" in day_df.columns:
                        # 按强度排序取前5
                        sort_col = "score" if "score" in day_df.columns else "rank"
                        day_df = day_df.sort(sort_col)
                        main_sectors = day_df.get_column("name").head(5).to_list()
        except Exception as e:  # noqa: BLE001
            logger.warning("get_environment: mainline read failed: %s", e)

        return EnvironmentInfo(
            phase=phase,
            phase_label=PHASE_LABELS.get(phase, "未知"),
            position_limit=PHASE_POSITION_LIMIT.get(phase, 0.5),
            main_sectors=main_sectors,
            height=height,
            limit_up_count=limit_up_count,
            promotion_rate=promo_rate,
            seal_rate=seal_rate,
        )

    def _load_and_filter(
        self,
        target_date: date,
        sector_filter: bool,
        env: EnvironmentInfo,
    ) -> pl.DataFrame:
        """加载数据 + 板块过滤"""
        from app.services.screener import ScreenerService

        screener = ScreenerService(self.repo, "stock")

        # 加载当天的 enriched 数据
        df = screener._load_enriched_for_date(target_date)
        if df.is_empty():
            return df

        # 基础过滤: 排除ST、停牌、成交额不足
        df = self._basic_filter(df)

        # 板块过滤: 只保留主线板块
        if sector_filter and env.main_sectors and "sector" in df.columns:
            before = df.height
            df = df.filter(pl.col("sector").is_in(env.main_sectors))
            # 如果板块过滤后数据太少，回退到全市场
            if df.height < 5:
                df = screener._load_enriched_for_date(target_date)
                df = self._basic_filter(df)

        return df

    def _basic_filter(self, df: pl.DataFrame) -> pl.DataFrame:
        """基础过滤"""
        from app.strategy.engine import DEFAULT_BASIC_FILTER, StrategyEngine
        return StrategyEngine._apply_basic_filter(df, DEFAULT_BASIC_FILTER)

    def _execute_strategy(
        self,
        df: pl.DataFrame,
        strategy_id: str,
        target_date: date,
    ) -> tuple[pl.DataFrame, str]:
        """执行内置策略条件，返回带排序分数的 DataFrame。"""
        from app.services.screener import ScreenerService

        meta = self._get_strategy_meta(strategy_id)
        strategy_name = meta.get("name", strategy_id) if meta else strategy_id
        conditions = meta.get("conditions", []) if meta else []
        if not conditions:
            return pl.DataFrame(), strategy_name

        try:
            result = ScreenerService(self.repo, "stock").run_conditions(
                target_date,
                conditions,
                order_by=meta.get("order_by", "change_pct"),
                descending=True,
                limit=0,
                current=df,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("strategy conditions failed: %s", e)
            return pl.DataFrame(), strategy_name

        if not result.rows:
            return pl.DataFrame(), strategy_name
        scored = pl.DataFrame(result.rows)
        order_by = meta.get("order_by", "change_pct")
        if order_by not in scored.columns:
            scored = scored.with_columns(pl.lit(50.0).alias("score"))
        else:
            value = pl.col(order_by).cast(pl.Float64, strict=False)
            bounds = scored.select(value.min().alias("min"), value.max().alias("max")).row(0)
            low, high = bounds
            scored = scored.with_columns(
                (pl.lit(50.0) if low is None or high is None or high == low else
                 ((value - low) / (high - low) * 100)).alias("score")
            )
        return scored.with_columns(pl.lit(strategy_id).alias("strategy_id")), strategy_name

    def _get_strategy_meta(self, strategy_id: str) -> dict[str, Any] | None:
        """获取策略元数据（从 market_catalog 的内置策略定义或数据库）"""
        # 先尝试从 market_catalog 获取
        try:
            from app.services.market_catalog import MARKET_STRATEGIES
            for s in MARKET_STRATEGIES:
                if s.get("name") == strategy_id or s.get("id") == strategy_id:
                    return s
        except Exception:  # noqa: BLE001
            pass
        return None

    def _score_dataframe(
        self,
        df: pl.DataFrame,
        scoring: dict[str, float],
        engine,  # StrategyEngine
    ) -> pl.DataFrame:
        """对 DataFrame 中的股票做因子评分"""
        from app.strategy.scoring import scoring_value_expr, materialize_scoring_columns

        # 确保需要的因子列存在
        available = set(df.columns)
        needed = set()
        for factor_id in scoring:
            needed.add(factor_id)

        # 尝试物化缺失的虚拟因子
        missing = needed - available
        if missing:
            try:
                df = materialize_scoring_columns(df, available | missing)
            except Exception as e:  # noqa: BLE001
                logger.debug("materialize_scoring_columns partial: %s", e)
                # 只保留可用的因子
                scoring = {k: v for k, v in scoring.items() if k in df.columns}

        if not scoring:
            return pl.DataFrame()

        # 计算每个因子的评分贡献
        score_exprs: list[pl.Expr] = []
        for factor_id, weight in scoring.items():
            if factor_id not in df.columns:
                continue
            expr = scoring_value_expr(set(df.columns), factor_id)
            if expr is not None:
                # 截面标准化 (zscore over date)
                mean_val = expr.mean().over("date") if "date" in df.columns else expr.mean()
                std_val = expr.std().over("date") if "date" in df.columns else expr.std()
                normalized = (
                    pl.when(std_val > 0)
                    .then((expr - mean_val) / std_val)
                    .otherwise(pl.lit(0.0))
                )
                score_exprs.append((normalized * weight).alias(f"__contrib_{factor_id}"))

        if not score_exprs:
            return pl.DataFrame()

        # 添加各因子贡献列
        df = df.with_columns(score_exprs)

        # 汇总总分
        contrib_cols = [f"__contrib_{fid}" for fid in scoring if f"__contrib_{fid}" in df.columns]
        if not contrib_cols:
            return pl.DataFrame()

        total = pl.col(contrib_cols[0])
        for c in contrib_cols[1:]:
            total = total + pl.col(c)

        df = df.with_columns(total.alias("__raw_score"))

        # 缩放到 0-100
        raw_min = df.select(pl.col("__raw_score").min()).item()
        raw_max = df.select(pl.col("__raw_score").max()).item()
        if raw_max > raw_min:
            df = df.with_columns(
                ((pl.col("__raw_score") - raw_min) / (raw_max - raw_min) * 100).alias("score")
            )
        else:
            df = df.with_columns(pl.lit(50.0).alias("score"))

        # 排序
        df = df.sort("score", descending=True, nulls_last=True)

        return df

    def _build_candidates(
        self,
        scored: pl.DataFrame,
        env: EnvironmentInfo,
        position_limit: float,
        limit: int,
    ) -> list[Candidate]:
        """构建候选列表"""
        meta = self._get_strategy_meta(scored.get("__strategy_id__", "") if "__strategy_id__" in scored.columns else "")
        scoring = meta.get("scoring", {}) if meta else {}

        candidates: list[Candidate] = []
        rows = scored.head(limit).to_dicts()

        for rank, row in enumerate(rows):
            symbol = row.get("symbol", "")
            name = row.get("name", "")
            close = float(row.get("close", 0) or 0)
            score = float(row.get("score", 0) or 0)

            # 因子贡献
            contributions: list[FactorContribution] = {}
            for factor_id, weight in scoring.items():
                contrib_col = f"__contrib_{factor_id}"
                if contrib_col in row:
                    contributions[factor_id] = FactorContribution(
                        factor_id=factor_id,
                        factor_label=self._factor_label(factor_id),
                        raw_value=row.get(factor_id),
                        weight=weight,
                        contribution=row.get(contrib_col, 0) or 0,
                    )

            # 仓位建议: 排名越前仓位越大
            position = position_limit * min(0.3, 1.0 / max(1, rank + 1)) * 100

            # 止损价: close * 0.95 (可后续用 ATR 替代)
            stop_loss = round(close * 0.95, 2) if close > 0 else None

            # 买入区间
            entry_low = round(close * 0.99, 2) if close > 0 else None
            entry_high = round(close * 1.02, 2) if close > 0 else None

            cand = Candidate(
                symbol=symbol,
                name=name,
                score=round(score, 2),
                close=close,
                pct_chg=float(row.get("change_pct", row.get("pct_chg", 0)) or 0),
                turnover_rate=float(row.get("turnover_rate", 0) or 0),
                amount=float(row.get("amount", 0) or 0),
                float_mv=row.get("float_mv"),
                consecutive_limit_ups=int(row.get("consecutive_limit_ups", 0) or 0),
                factor_contributions=list(contributions.values()),
                strategy_hits=[row.get("strategy_id", "")],
                sector=row.get("sector"),
                suggested_position=round(position, 1),
                stop_loss=stop_loss,
                entry_low=entry_low,
                entry_high=entry_high,
            )
            candidates.append(cand)

        return candidates

    @staticmethod
    def _factor_label(factor_id: str) -> str:
        """获取因子中文名"""
        try:
            from app.factors.registry import get_factor
            spec = get_factor(factor_id)
            if spec is not None:
                return spec.label
        except Exception:  # noqa: BLE001
            pass
        return factor_id
