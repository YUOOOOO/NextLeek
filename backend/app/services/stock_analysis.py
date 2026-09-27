"""个股深度分析服务 — 买卖点 + 关键价位 + 入选理由 + 实时状态。

职责:
  为单只股票生成完整的分析报告，包括:
  - 为什么入选 (策略命中 + 因子贡献)
  - 当前买卖点判断
  - 关键价位 (支撑/压力/均线)
  - 实时浮盈/距止损距离

不知道: HTTP、前端、配置持久化。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import polars as pl

logger = logging.getLogger(__name__)


@dataclass
class BuyPoint:
    """买入点"""
    type: str                    # 类型 (突破/回踩/反转/打板)
    price: float                 # 建议买入价
    date: str                    # 信号日期
    reason: str                  # 原因
    confidence: float = 0.5      # 置信度 0-1


@dataclass
class SellPoint:
    """卖出点"""
    type: str                    # 类型 (止损/止盈/信号)
    price: float                 # 触发价
    reason: str                  # 原因
    severity: str = "normal"     # normal/warning/critical


@dataclass
class KeyLevels:
    """关键价位"""
    support: list[float] = field(default_factory=list)
    resistance: list[float] = field(default_factory=list)
    ma: dict[str, float] = field(default_factory=dict)
    stop_loss: float | None = None
    take_profit: float | None = None


@dataclass
class RiskAssessment:
    """风险评估"""
    rsi_level: str = ""          # 超买/超卖/中性
    near_resistance: bool = False
    near_support: bool = False
    rsi_value: float | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class StockAnalysis:
    """个股完整分析"""
    symbol: str
    name: str
    analysis_date: str

    # 入选理由
    strategy_hits: list[str] = field(default_factory=list)
    factor_highlights: list[dict] = field(default_factory=list)
    sector_context: str = ""
    phase_at_selection: str = ""

    # 买卖点
    buy_points: list[BuyPoint] = field(default_factory=list)
    sell_points: list[SellPoint] = field(default_factory=list)

    # 关键价位
    key_levels: KeyLevels = field(default_factory=KeyLevels)

    # 风险
    risk: RiskAssessment = field(default_factory=RiskAssessment)

    # 实时 (可选)
    current_price: float | None = None
    pnl_pct: float | None = None
    distance_to_stop: float | None = None


class StockAnalysisService:
    """
    个股深度分析

    用法:
        svc = StockAnalysisService(repo, data_dir)
        analysis = svc.analyze("002236", strategy_hits=["limit_up_momentum"])
    """

    def __init__(self, repo, data_dir: str | None = None) -> None:
        self.repo = repo
        self.data_dir = data_dir

    def analyze(
        self,
        symbol: str,
        strategy_hits: list[str] | None = None,
        factor_highlights: list[dict] | None = None,
        sector: str | None = None,
        phase: str = "",
        track_record=None,  # TrackRecord | None
    ) -> StockAnalysis | None:
        """生成个股深度分析"""
        from datetime import date as dt_date

        end = dt_date.today()
        start = end - timedelta(days=120)

        # 加载K线数据
        df = self.repo.get_daily_asset(self.repo.resolve_asset_type(symbol), symbol, start, end)
        if df is None or df.is_empty():
            return None

        # 确保有需要的技术指标
        from app.services.screener import ScreenerService
        screener = ScreenerService(self.repo, "stock")
        df = screener.compute_indicators(df) if hasattr(screener, 'compute_indicators') else df

        # 获取基本信息
        name = self._get_name(symbol, df)
        latest = df.sort("date", descending=True).head(1)
        if latest.is_empty():
            return None

        close = float(latest.get_column("close").item())

        # 计算关键价位
        from app.indicators.levels import compute_levels
        levels_raw = compute_levels(df)
        key_levels = self._extract_key_levels(levels_raw, close)

        # 买卖点判断
        buy_points = self._detect_buy_points(df, close, strategy_hits or [])
        sell_points = self._detect_sell_points(df, close, key_levels)

        # 风险评估
        risk = self._assess_risk(df, close, key_levels)

        # 实时状态
        current_price = None
        pnl_pct = None
        distance_to_stop = None
        if track_record is not None:
            current_price = track_record.current_price or close
            pnl_pct = track_record.unrealized_pnl_pct
            distance_to_stop = track_record.distance_to_stop_pct
            if track_record.stop_loss > 0:
                key_levels.stop_loss = track_record.stop_loss
            if track_record.take_profit:
                key_levels.take_profit = track_record.take_profit

        return StockAnalysis(
            symbol=symbol,
            name=name,
            analysis_date=end.isoformat(),
            strategy_hits=strategy_hits or [],
            factor_highlights=factor_highlights or [],
            sector_context=sector or "",
            phase_at_selection=phase,
            buy_points=buy_points,
            sell_points=sell_points,
            key_levels=key_levels,
            risk=risk,
            current_price=current_price or close,
            pnl_pct=pnl_pct,
            distance_to_stop=distance_to_stop,
        )

    # ──────────────────────────────────────────────
    # 内部方法
    # ──────────────────────────────────────────────

    def _get_name(self, symbol: str, df: pl.DataFrame) -> str:
        if "name" in df.columns:
            vals = df.get_column("name").drop_nulls().to_list()
            if vals:
                return str(vals[-1])
        return symbol

    def _extract_key_levels(
        self,
        levels_raw: dict[str, list[dict]],
        close: float,
    ) -> KeyLevels:
        """从 compute_levels 结果中提取关键价位"""
        support: list[float] = []
        resistance: list[float] = []
        ma: dict[str, float] = {}

        # 支撑/阻力: 从 sr 和 pivot 中提取
        for src_key in ("sr", "pivot"):
            for pt in levels_raw.get(src_key, []):
                price = pt.get("price", 0)
                side = pt.get("side", "")
                if price <= 0:
                    continue
                if price < close and side in ("support", ""):
                    support.append(price)
                elif price > close and side in ("resistance", ""):
                    resistance.append(price)

        # 去重排序
        support = sorted(set(support))[-3:]  # 最近3个支撑
        resistance = sorted(set(resistance))[:3]  # 最近3个压力

        # ATR 止损
        for pt in levels_raw.get("atr_stop", []):
            if pt.get("side") == "stop_loss":
                support.append(pt.get("price", 0))

        return KeyLevels(
            support=support,
            resistance=resistance,
            ma=ma,
        )

    def _detect_buy_points(
        self,
        df: pl.DataFrame,
        close: float,
        strategy_hits: list[str],
    ) -> list[BuyPoint]:
        """检测买入点"""
        points: list[BuyPoint] = []
        latest_date = str(df.get_column("date").max())

        # 根据策略类型判断买入点类型
        for strategy_id in strategy_hits:
            if any(k in strategy_id for k in ("limit_up", "lianban", "broken")):
                points.append(BuyPoint(
                    type="打板买入",
                    price=round(close, 2),
                    date=latest_date,
                    reason=f"策略[{strategy_id}]命中，次日竞价或板上确认",
                    confidence=0.7,
                ))
            elif any(k in strategy_id for k in ("pullback", "bounce", "oversold")):
                points.append(BuyPoint(
                    type="低吸买入",
                    price=round(close * 0.98, 2),
                    date=latest_date,
                    reason=f"策略[{strategy_id}]命中，回踩支撑位低吸",
                    confidence=0.6,
                ))
            elif any(k in strategy_id for k in ("breakout", "new_high", "trend")):
                points.append(BuyPoint(
                    type="突破买入",
                    price=round(close * 1.01, 2),
                    date=latest_date,
                    reason=f"策略[{strategy_id}]命中，突破确认后买入",
                    confidence=0.65,
                ))
            else:
                points.append(BuyPoint(
                    type="信号买入",
                    price=round(close, 2),
                    date=latest_date,
                    reason=f"策略[{strategy_id}]命中",
                    confidence=0.5,
                ))

        return points

    def _detect_sell_points(
        self,
        df: pl.DataFrame,
        close: float,
        key_levels: KeyLevels,
    ) -> list[SellPoint]:
        """检测卖出点"""
        points: list[SellPoint] = []

        # 固定止损
        stop = close * 0.95
        if key_levels.support:
            # 取最近支撑位下方1%
            nearest_support = max(s for s in key_levels.support if s < close) if any(s < close for s in key_levels.support) else close * 0.95
            stop = min(stop, nearest_support * 0.99)
        points.append(SellPoint(
            type="止损",
            price=round(stop, 2),
            reason="固定止损（买入价下方5%或最近支撑位）",
            severity="critical",
        ))

        # 压力位止盈
        if key_levels.resistance:
            for r in key_levels.resistance[:2]:
                points.append(SellPoint(
                    type="止盈",
                    price=round(r * 0.98, 2),
                    reason=f"压力位 {r:.2f} 附近减仓",
                    severity="normal",
                ))

        return points

    def _assess_risk(
        self,
        df: pl.DataFrame,
        close: float,
        key_levels: KeyLevels,
    ) -> RiskAssessment:
        """风险评估"""
        risk = RiskAssessment()

        # RSI
        if "rsi_14" in df.columns:
            rsi_vals = df.get_column("rsi_14").drop_nulls().to_list()
            if rsi_vals:
                rsi = float(rsi_vals[-1])
                risk.rsi_value = rsi
                if rsi > 70:
                    risk.rsi_level = "超买"
                    risk.warnings.append(f"RSI={rsi:.0f}，处于超买区域")
                elif rsi < 30:
                    risk.rsi_level = "超卖"
                else:
                    risk.rsi_level = "中性"

        # 距压力位
        if key_levels.resistance:
            nearest_res = min(key_levels.resistance)
            if (nearest_res - close) / close < 0.03:
                risk.near_resistance = True
                risk.warnings.append(f"距压力位仅{(nearest_res - close) / close * 100:.1f}%")

        # 距支撑位
        if key_levels.support:
            nearest_sup = max(s for s in key_levels.support if s < close) if any(s < close for s in key_levels.support) else close
            if (close - nearest_sup) / close < 0.02:
                risk.near_support = True

        return risk
