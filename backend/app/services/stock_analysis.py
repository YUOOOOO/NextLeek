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
    tracking: bool = False
    alerts: list[dict[str, Any]] = field(default_factory=list)
    entry_price: float | None = None
    track_status: str | None = None



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

        # 关键价位使用 indicators.levels 的统一结构，避免维护第二套算法。
        from app.indicators.levels import compute_levels
        levels_raw = compute_levels(df)
        key_levels = self._extract_key_levels(levels_raw, close, df)

        # 买卖点判断
        buy_points = self._detect_buy_points(df, close, strategy_hits or [], key_levels)
        sell_points = self._detect_sell_points(df, close, key_levels)

        # 风险评估
        risk = self._assess_risk(df, close, key_levels)

        # 实时状态。浮盈只在存在真实跟踪成本时计算，不能用推测成本伪造。
        current_price = close
        pnl_pct = None
        distance_to_stop = None
        alerts: list[dict[str, Any]] = []
        if track_record is not None:
            current_price = track_record.current_price or close
            if track_record.entry_price > 0:
                pnl_pct = (current_price - track_record.entry_price) / track_record.entry_price * 100
            if track_record.stop_loss > 0 and current_price > 0:
                distance_to_stop = (current_price - track_record.stop_loss) / current_price * 100
            alerts = list(reversed(track_record.alert_history))
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
            current_price=current_price,
            pnl_pct=pnl_pct,
            distance_to_stop=distance_to_stop,
            tracking=track_record is not None,
            alerts=alerts,
            entry_price=track_record.entry_price if track_record is not None else None,
            track_status=str(track_record.status) if track_record is not None else None,
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
        df: pl.DataFrame,
    ) -> KeyLevels:
        """把统一价位引擎的 ``value`` 输出压缩成分析页所需档位。"""
        support: list[float] = []
        resistance: list[float] = []

        for points in levels_raw.values():
            for point in points:
                value = point.get("value")
                try:
                    price = float(value)
                except (TypeError, ValueError):
                    continue
                if price <= 0:
                    continue
                side = point.get("side")
                if price < close and side == "support":
                    support.append(round(price, 2))
                elif price > close and side == "resistance":
                    resistance.append(round(price, 2))

        support = sorted(set(support), reverse=True)[:3]
        resistance = sorted(set(resistance))[:3]

        ma: dict[str, float] = {}
        latest = df.sort("date").tail(1)
        for label, column in (("MA5", "ma_5"), ("MA10", "ma_10"), ("MA20", "ma_20"), ("MA60", "ma_60")):
            if column not in latest.columns:
                continue
            value = latest.get_column(column).item()
            if value is not None:
                ma[label] = round(float(value), 2)

        return KeyLevels(support=support, resistance=resistance, ma=ma)

    def _detect_buy_points(
        self,
        df: pl.DataFrame,
        close: float,
        strategy_hits: list[str],
        key_levels: KeyLevels,
    ) -> list[BuyPoint]:
        """生成策略命中或技术结构对应的可执行买入触发价。"""
        points: list[BuyPoint] = []
        latest_date = str(df.get_column("date").max())

        for strategy_id in strategy_hits:
            if any(k in strategy_id for k in ("limit_up", "lianban", "broken")):
                kind, price, reason, confidence = (
                    "打板买入", close, f"策略[{strategy_id}]命中，次日竞价或板上确认", 0.7,
                )
            elif any(k in strategy_id for k in ("pullback", "bounce", "oversold")):
                price = key_levels.support[0] if key_levels.support else close * 0.98
                kind, reason, confidence = "低吸买入", f"策略[{strategy_id}]命中，等待支撑位确认", 0.6
            elif any(k in strategy_id for k in ("breakout", "new_high", "trend")):
                price = key_levels.resistance[0] if key_levels.resistance else close * 1.01
                kind, reason, confidence = "突破买入", f"策略[{strategy_id}]命中，放量突破后确认", 0.65
            else:
                kind, price, reason, confidence = "信号买入", close, f"策略[{strategy_id}]命中", 0.5
            points.append(BuyPoint(kind, round(price, 2), latest_date, reason, confidence))

        if points:
            return points

        latest = df.sort("date").tail(1)
        signal_specs = (
            ("signal_limit_up", "涨停确认", "涨停信号已触发", 0.7),
            ("signal_broken_limit_up", "回封确认", "炸板后仅在重新封板时确认", 0.55),
            ("signal_macd_golden", "金叉买入", "MACD 金叉信号已触发", 0.6),
            ("signal_ma_golden_5_20", "均线金叉", "MA5 上穿 MA20", 0.6),
            ("signal_boll_breakout_upper", "突破买入", "价格突破布林上轨", 0.55),
        )
        for column, kind, reason, confidence in signal_specs:
            if column in latest.columns and latest.get_column(column).item() is True:
                points.append(BuyPoint(kind, round(close, 2), latest_date, reason, confidence))

        if not points:
            if key_levels.support:
                price = key_levels.support[0]
                reason = "等待最近支撑位企稳后确认，不代表当前已触发"
            else:
                price = close
                reason = "暂无明确技术信号，等待现价附近放量确认"
            points.append(BuyPoint("观察买点", round(price, 2), latest_date, reason, 0.4))
        return points

    def _detect_sell_points(
        self,
        df: pl.DataFrame,
        close: float,
        key_levels: KeyLevels,
    ) -> list[SellPoint]:
        """根据统一关键价位生成止损和止盈触发价。"""
        nearest_support = key_levels.support[0] if key_levels.support else None
        stop = max(close * 0.95, nearest_support * 0.99) if nearest_support else close * 0.95
        key_levels.stop_loss = round(stop, 2)

        nearest_resistance = key_levels.resistance[0] if key_levels.resistance else None
        take_profit = nearest_resistance * 0.99 if nearest_resistance else close * 1.08
        if take_profit <= close:
            take_profit = close * 1.08
        key_levels.take_profit = round(take_profit, 2)

        return [
            SellPoint(
                type="止损",
                price=key_levels.stop_loss,
                reason="最近支撑位下方 1% 与现价下方 5% 中较近者",
                severity="critical",
            ),
            SellPoint(
                type="止盈",
                price=key_levels.take_profit,
                reason="最近压力位下方 1%；无有效压力位时按 8% 目标",
                severity="normal",
            ),
        ]

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
