import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  Target,
  Crosshair,
} from "lucide-react";
import { api } from "../lib/api";
import { StockKlineDialog } from "../components/StockKlineDialog";

// ── 类型 ──

interface BuyPoint {
  type: string;
  price: number;
  date: string;
  reason: string;
  confidence: number;
}

interface SellPoint {
  type: string;
  price: number;
  reason: string;
  severity: string;
}

interface KeyLevels {
  support: number[];
  resistance: number[];
  ma: Record<string, number>;
  stop_loss: number | null;
  take_profit: number | null;
}

interface RiskAssessment {
  rsi_level: string;
  rsi_value: number | null;
  near_resistance: boolean;
  near_support: boolean;
  warnings: string[];
}

interface StockAnalysisData {
  symbol: string;
  name: string;
  analysis_date: string;
  strategy_hits: string[];
  factor_highlights: unknown[];
  sector_context: string;
  phase_at_selection: string;
  buy_points: BuyPoint[];
  sell_points: SellPoint[];
  key_levels: KeyLevels;
  risk: RiskAssessment;
  current_price: number;
  pnl_pct: number | null;
  distance_to_stop: number | null;
}

// ── 辅助 ──

function fmtPrice(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ── 主组件 ──

export function StockAnalysis() {
  const { symbol } = useParams<{ symbol: string }>();
  const [showKline, setShowKline] = useState(false);

  const { data: analysis, isLoading } = useQuery({
    queryKey: ["analysis", symbol],
    queryFn: () => api.stockAnalysis(symbol!),
    enabled: !!symbol,
  });

  if (isLoading) return <div className="analysis-loading">分析中...</div>;
  if (!analysis) return <div className="analysis-error">无法加载分析</div>;

  return (
    <div className="stock-analysis-page">
      {/* 顶部导航 */}
      <div className="analysis-header">
        <Link to="/selection" className="back-link">
          <ArrowLeft size={16} />
          返回选股
        </Link>
        <div className="stock-title">
          <h2>{analysis.name}</h2>
          <span className="symbol">{analysis.symbol}</span>
          {analysis.sector_context && (
            <span className="sector-tag">{analysis.sector_context}</span>
          )}
        </div>
        <button className="kline-btn" onClick={() => setShowKline(true)}>
          <TrendingUp size={14} />
          K线图
        </button>
      </div>

      <div className="analysis-body">
        {/* 左侧：实时状态 + 关键价位 */}
        <div className="analysis-left">
          <RealTimeCard analysis={analysis} />
          <KeyLevelsCard analysis={analysis} />
          <RiskCard analysis={analysis} />
        </div>

        {/* 右侧：买卖点 + 理由 */}
        <div className="analysis-right">
          <ReasonCard analysis={analysis} />
          <BuySellCard analysis={analysis} />
          <AlertHistoryCard symbol={analysis.symbol} />
        </div>
      </div>

      {/* K线弹窗 */}
      {showKline && (
        <StockKlineDialog
          symbol={analysis.symbol}
          name={analysis.name}
          onClose={() => setShowKline(false)}
        />
      )}
    </div>
  );
}

// ── 子组件 ──

function RealTimeCard({ analysis }: { analysis: StockAnalysisData }) {
  const pnl = analysis.pnl_pct;
  const distStop = analysis.distance_to_stop;

  return (
    <div className="card realtime-card">
      <h3>
        <Crosshair size={16} />
        实时状态
      </h3>
      <div className="realtime-grid">
        <div className="rt-item">
          <span className="rt-label">现价</span>
          <span className="rt-value price">{fmtPrice(analysis.current_price)}</span>
        </div>
        <div className="rt-item">
          <span className="rt-label">浮盈</span>
          <span className={`rt-value ${pnl && pnl >= 0 ? "up" : "down"}`}>
            {fmtPct(pnl)}
          </span>
        </div>
        <div className="rt-item">
          <span className="rt-label">距止损</span>
          <span className={`rt-value ${distStop != null && distStop < 3 ? "danger" : ""}`}>
            {distStop != null ? `${distStop.toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="rt-item">
          <span className="rt-label">状态</span>
          <span className="rt-value status-active">跟踪中</span>
        </div>
      </div>
    </div>
  );
}

function KeyLevelsCard({ analysis }: { analysis: StockAnalysisData }) {
  const levels = analysis.key_levels;

  return (
    <div className="card levels-card">
      <h3>
        <Target size={16} />
        关键价位
      </h3>

      {levels.resistance.length > 0 && (
        <div className="level-group">
          <span className="level-label">压力位</span>
          <div className="level-values">
            {levels.resistance.map((r, i) => (
              <span key={i} className="level-tag resistance">
                {fmtPrice(r)}
              </span>
            ))}
          </div>
        </div>
      )}

      {levels.support.length > 0 && (
        <div className="level-group">
          <span className="level-label">支撑位</span>
          <div className="level-values">
            {levels.support.map((s, i) => (
              <span key={i} className="level-tag support">
                {fmtPrice(s)}
              </span>
            ))}
          </div>
        </div>
      )}

      {levels.stop_loss && (
        <div className="level-group">
          <span className="level-label">止损价</span>
          <span className="level-tag stop">{fmtPrice(levels.stop_loss)}</span>
        </div>
      )}

      {levels.take_profit && (
        <div className="level-group">
          <span className="level-label">止盈价</span>
          <span className="level-tag profit">{fmtPrice(levels.take_profit)}</span>
        </div>
      )}
    </div>
  );
}

function RiskCard({ analysis }: { analysis: StockAnalysisData }) {
  const risk = analysis.risk;

  return (
    <div className="card risk-card">
      <h3>
        <Shield size={16} />
        风险评估
      </h3>

      {risk.rsi_value != null && (
        <div className="risk-item">
          <span className="risk-label">RSI(14)</span>
          <span className={`risk-value ${risk.rsi_level === "超买" ? "danger" : risk.rsi_level === "超卖" ? "profit" : ""}`}>
            {risk.rsi_value.toFixed(0)} ({risk.rsi_level})
          </span>
        </div>
      )}

      {risk.near_resistance && (
        <div className="risk-item warning">
          <AlertTriangle size={14} />
          <span>接近压力位</span>
        </div>
      )}

      {risk.near_support && (
        <div className="risk-item info">
          <Shield size={14} />
          <span>接近支撑位</span>
        </div>
      )}

      {risk.warnings.map((w, i) => (
        <div key={i} className="risk-item warning">
          <AlertTriangle size={14} />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}

function ReasonCard({ analysis }: { analysis: StockAnalysisData }) {
  return (
    <div className="card reason-card">
      <h3>
        <TrendingUp size={16} />
        入选理由
      </h3>

      {analysis.strategy_hits.length > 0 && (
        <div className="reason-section">
          <span className="reason-label">策略命中</span>
          <div className="reason-tags">
            {analysis.strategy_hits.map((s, i) => (
              <span key={i} className="reason-tag hit">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {analysis.sector_context && (
        <div className="reason-section">
          <span className="reason-label">板块</span>
          <span className="reason-text">{analysis.sector_context}</span>
        </div>
      )}

      {analysis.phase_at_selection && (
        <div className="reason-section">
          <span className="reason-label">入选时情绪</span>
          <span className="reason-text">{analysis.phase_at_selection}</span>
        </div>
      )}
    </div>
  );
}

function BuySellCard({ analysis }: { analysis: StockAnalysisData }) {
  return (
    <div className="card buysell-card">
      <div className="buysell-section">
        <h3>
          <TrendingUp size={16} className="up" />
          买入点
        </h3>
        {analysis.buy_points.length > 0 ? (
          analysis.buy_points.map((bp, i) => (
            <div key={i} className="point-item buy">
              <div className="point-header">
                <span className="point-type">{bp.type}</span>
                <span className="point-price">{fmtPrice(bp.price)}</span>
              </div>
              <div className="point-reason">{bp.reason}</div>
              <div className="point-confidence">
                置信度: {(bp.confidence * 100).toFixed(0)}%
              </div>
            </div>
          ))
        ) : (
          <div className="no-points">暂无买入信号</div>
        )}
      </div>

      <div className="buysell-section">
        <h3>
          <TrendingDown size={16} className="down" />
          卖出点
        </h3>
        {analysis.sell_points.length > 0 ? (
          analysis.sell_points.map((sp, i) => (
            <div key={i} className={`point-item sell ${sp.severity}`}>
              <div className="point-header">
                <span className="point-type">{sp.type}</span>
                <span className="point-price">{fmtPrice(sp.price)}</span>
              </div>
              <div className="point-reason">{sp.reason}</div>
            </div>
          ))
        ) : (
          <div className="no-points">暂无卖出信号</div>
        )}
      </div>
    </div>
  );
}

function AlertHistoryCard({ symbol }: { symbol: string }) {
  // 这里可以从跟踪记录中获取告警历史
  return (
    <div className="card alert-card">
      <h3>
        <AlertTriangle size={16} />
        告警流
      </h3>
      <div className="alert-list-empty">
        暂无告警
      </div>
    </div>
  );
}
