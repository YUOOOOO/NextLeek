import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  Target,
  Crosshair,
} from "lucide-react";
import { streamStockAnalysis, api } from "../lib/api";
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
interface AnalysisAlert {
  type: string;
  message: string;
  time?: string;
  ts?: number;
  price?: number | null;
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
  tracking: boolean;
  entry_price: number | null;
  track_status: string | null;
  alerts: AnalysisAlert[];
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
  const queryClient = useQueryClient();
  const [showKline, setShowKline] = useState(false);
  const [aiReport, setAiReport] = useState("");
  const [aiFocus, setAiFocus] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const { data: analysis, isLoading, error: analysisError } = useQuery<StockAnalysisData>({
    queryKey: ["analysis", symbol],
    queryFn: async () => (await api.stockAnalysis(symbol!)) as unknown as StockAnalysisData,
    enabled: !!symbol,
    refetchInterval: 30000,
  });
  const startTracking = useMutation({
    mutationFn: async () => api.startTrack({
      symbol: analysis!.symbol,
      name: analysis!.name,
      entry_price: analysis!.current_price,
      stop_loss: analysis!.key_levels.stop_loss,
      take_profit: analysis!.key_levels.take_profit,
      reason: "从个股分析页开始跟踪",
      strategy_id: analysis!.strategy_hits[0] ?? "technical_analysis",
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["analysis", symbol] }),
  });

  useEffect(() => {
    const source = new EventSource("/api/monitor/stream");
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["analysis", symbol] });
    };
    source.addEventListener("pool_updated", refresh);
    source.addEventListener("strategy_alert", refresh);
    return () => source.close();
  }, [queryClient, symbol]);

  async function runAiAnalysis() {
    if (!symbol || aiBusy) return;
    setAiBusy(true);
    setAiError("");
    setAiReport("");
    try {
      await streamStockAnalysis(symbol, aiFocus, (event) => {
        if (event.type === "delta") setAiReport((value) => value + event.content);
        if (event.type === "error") setAiError(event.message);
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI 分析失败");
    } finally {
      setAiBusy(false);
    }
  }

  if (isLoading) return <div className="analysis-loading">分析中...</div>;
  if (!analysis) return <div className="analysis-error">{analysisError instanceof Error ? analysisError.message : "无法加载分析"}</div>;

  return (
    <div className="stock-analysis-page">
      {/* 顶部导航 */}
      <div className="analysis-header">
        <Link to="/analysis" className="back-link">
          <ArrowLeft size={16} />
          返回个股分析
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
        <button className="kline-btn" onClick={runAiAnalysis} disabled={aiBusy}>
          {aiBusy ? "分析中…" : "AI 分析"}
        </button>
      </div>

      <div className="analysis-body">
        {/* 左侧：实时状态 + 关键价位 */}
        <div className="analysis-left">
          <RealTimeCard analysis={analysis} onStartTracking={() => startTracking.mutate()} trackingBusy={startTracking.isPending} />
          <KeyLevelsCard analysis={analysis} />
          <RiskCard analysis={analysis} />
        </div>

        {/* 右侧：买卖点 + 理由 */}
        <div className="analysis-right">
          <ReasonCard analysis={analysis} />
          <BuySellCard analysis={analysis} />
          <AlertHistoryCard alerts={analysis.alerts} />
        </div>
      </div>

      <section className="ai-analysis-card">
        <div className="ai-analysis-head">
          <div>
            <h3>AI 结构分析</h3>
            <p>基于最新 K 线、技术指标、关键价位和财务数据生成客观报告。</p>
          </div>
          <span className={aiBusy ? "ai-live" : "ai-idle"}>{aiBusy ? "实时生成" : "按需运行"}</span>
        </div>
        <div className="ai-analysis-controls">
          <input value={aiFocus} onChange={(event) => setAiFocus(event.target.value)} placeholder="可选：关注量价、支撑压力或风险" />
          <button type="button" className="kline-btn" onClick={runAiAnalysis} disabled={aiBusy}>{aiBusy ? "分析中…" : "开始分析"}</button>
        </div>
        {aiError ? <div className="ai-analysis-error">{aiError}</div> : null}
        {aiReport ? <pre className="ai-analysis-report">{aiReport}</pre> : <div className="ai-analysis-empty">尚未生成 AI 报告。</div>}
      </section>

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

function RealTimeCard({ analysis, onStartTracking, trackingBusy }: {
  analysis: StockAnalysisData;
  onStartTracking: () => void;
  trackingBusy: boolean;
}) {
  const pnl = analysis.pnl_pct;
  const distStop = analysis.distance_to_stop;
  const statusLabels: Record<string, string> = {
    watching: "观察中", holding: "持仓中", stopped: "已止损", sold: "已卖出", expired: "已到期",
  };

  return (
    <div className="card realtime-card">
      <h3><Crosshair size={16} />实时状态</h3>
      <div className="realtime-grid">
        <div className="rt-item"><span className="rt-label">现价</span><span className="rt-value price">{fmtPrice(analysis.current_price)}</span></div>
        <div className="rt-item">
          <span className="rt-label">{analysis.tracking ? "浮盈" : "参考成本"}</span>
          <span className={`rt-value ${pnl != null && pnl >= 0 ? "up" : "down"}`}>
            {analysis.tracking ? fmtPct(pnl) : fmtPrice(analysis.current_price)}
          </span>
        </div>
        <div className="rt-item">
          <span className="rt-label">距止损</span>
          <span className={`rt-value ${distStop != null && distStop < 3 ? "danger" : ""}`}>
            {distStop != null ? `${distStop.toFixed(1)}%` : `${((analysis.current_price - (analysis.key_levels.stop_loss ?? analysis.current_price)) / analysis.current_price * 100).toFixed(1)}%`}
          </span>
        </div>
        <div className="rt-item">
          <span className="rt-label">状态</span>
          {analysis.tracking ? (
            <span className="rt-value status-active">{statusLabels[analysis.track_status ?? ""] ?? analysis.track_status}</span>
          ) : (
            <button type="button" className="track-btn" onClick={onStartTracking} disabled={trackingBusy || analysis.key_levels.stop_loss == null}>
              {trackingBusy ? "启动中…" : "开始跟踪"}
            </button>
          )}
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
      {Object.keys(levels.ma).length > 0 && (
        <div className="level-group">
          <span className="level-label">均线</span>
          <div className="level-values">
            {Object.entries(levels.ma).map(([label, value]) => (
              <span key={label} className="level-tag">{label} {fmtPrice(value)}</span>
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

function AlertHistoryCard({ alerts }: { alerts: AnalysisAlert[] }) {
  return (
    <div className="card alert-card">
      <h3><AlertTriangle size={16} />告警流</h3>
      {alerts.length > 0 ? (
        <div className="alert-list">
          {alerts.map((alert, index) => (
            <div className="alert-item" key={`${alert.ts ?? alert.time ?? "alert"}-${index}`}>
              <div>{alert.message}</div>
              <span>{alert.time ?? (alert.ts ? new Date(alert.ts).toLocaleString() : "")}</span>
            </div>
          ))}
        </div>
      ) : <div className="alert-list-empty">近 7 日暂无该股票告警</div>}
    </div>
  );
}
