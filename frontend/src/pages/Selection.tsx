import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw, TrendingUp, Shield, AlertTriangle, Eye } from "lucide-react";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

// ── 类型 ──

interface SelectionEnvironment {
  phase: string;
  phase_label: string;
  position_limit: number;
  main_sectors: string[];
  height: number;
  limit_up_count: number;
  promotion_rate: number;
  seal_rate: number;
}

interface FactorContribution {
  factor_id: string;
  factor_label: string;
  raw_value: number | null;
  weight: number;
  contribution: number;
}

interface Candidate {
  symbol: string;
  name: string;
  score: number;
  close: number;
  pct_chg: number;
  turnover_rate: number;
  amount: number;
  float_mv: number | null;
  consecutive_limit_ups: number;
  sector: string | null;
  suggested_position: number;
  stop_loss: number | null;
  entry_low: number | null;
  entry_high: number | null;
  factor_contributions: FactorContribution[];
  strategy_hits: string[];
}

interface SelectionResult {
  as_of: string;
  strategy_id: string;
  strategy_name: string;
  skip_reason: string | null;
  environment: SelectionEnvironment;
  candidates: Candidate[];
  total_scored: number;
  filtered_out: Record<string, number>;
  elapsed_ms: number;
}

interface StrategyOption {
  id: string;
  name: string;
  description: string;
  tags: string[];
  scoring: Record<string, number>;
}

interface TrackRecord {
  symbol: string;
  name: string;
  entry_date: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number | null;
  max_hold_days: number;
  reason: string;
  strategy_id: string;
  score: number;
  status: string;
  current_price: number | null;
  pnl_pct: number | null;
  sector: string | null;
}

// ── 辅助 ──

const PHASE_COLORS: Record<string, string> = {
  ice: "#3498db",
  ignite: "#2ecc71",
  rally: "#e74c3c",
  climax: "#f39c12",
  ebb: "#9b59b6",
  repair: "#1abc9c",
};

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function fmtPrice(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function fmtAmount(v: number) {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
}

// ── 主组件 ──

export function Selection() {
  const queryClient = useQueryClient();
  const [selectedStrategy, setSelectedStrategy] = useState<string>("");
  const [phaseFilter, setPhaseFilter] = useState(true);
  const [sectorFilter, setSectorFilter] = useState(true);

  // 获取策略列表
  const { data: strategies } = useQuery({
    queryKey: ["selection", "strategies"],
    queryFn: () => api.selectionStrategies(),
  });

  // 获取环境
  const { data: environment } = useQuery({
    queryKey: ["selection", "environment"],
    queryFn: () => api.selectionEnvironment(),
  });

  // 获取跟踪池
  const { data: tracks } = useQuery({
    queryKey: ["selection", "tracks"],
    queryFn: () => api.listTracks(),
  });

  // 运行选股
  const runMutation = useMutation({
    mutationFn: () =>
      api.runSelection({
        strategy_id: selectedStrategy,
        phase_filter: phaseFilter,
        sector_filter: sectorFilter,
        limit: 50,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["selection", "result"], data);
    },
  });

  const result = useMemo(
    () => queryClient.getQueryData<SelectionResult>(["selection", "result"]),
    [queryClient, runMutation.data],
  );

  // 默认选中第一个策略
  if (!selectedStrategy && strategies && strategies.length > 0) {
    setSelectedStrategy(strategies[0].id);
  }

  return (
    <div className="selection-page">
      {/* 顶部：市场环境 */}
      <EnvironmentBar environment={environment} />

      {/* 中部：策略控制 + 结果 */}
      <div className="selection-main">
        <div className="selection-controls">
          <div className="control-row">
            <label>策略</label>
            <select
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
            >
              {strategies?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.description}
                </option>
              ))}
            </select>
          </div>

          <div className="control-row toggles">
            <label className="toggle">
              <input
                type="checkbox"
                checked={phaseFilter}
                onChange={(e) => setPhaseFilter(e.target.checked)}
              />
              情绪过滤
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.checked)}
              />
              板块过滤
            </label>
          </div>

          <button
            className="run-btn"
            disabled={!selectedStrategy || runMutation.isPending}
            onClick={() => runMutation.mutate()}
          >
            {runMutation.isPending ? (
              <RefreshCw className="spin" size={16} />
            ) : (
              <Play size={16} />
            )}
            {runMutation.isPending ? "运行中..." : "运行选股"}
          </button>
        </div>

        {/* 选股结果 */}
        {result?.skip_reason ? (
          <div className="skip-reason">
            <AlertTriangle size={20} />
            <span>{result.skip_reason}</span>
          </div>
        ) : result?.candidates && result.candidates.length > 0 ? (
          <CandidateTable candidates={result.candidates} env={result.environment} />
        ) : runMutation.isPending ? (
          <div className="loading">选股中...</div>
        ) : (
          <div className="empty">选择策略后点击"运行选股"</div>
        )}
      </div>

      {/* 底部：跟踪池 */}
      {tracks && tracks.length > 0 && (
        <TrackPool tracks={tracks} />
      )}
    </div>
  );
}

// ── 子组件 ──

function EnvironmentBar({ environment }: { environment: SelectionEnvironment | undefined }) {
  if (!environment) return null;

  const phaseColor = PHASE_COLORS[environment.phase] || "#888";

  return (
    <div className="env-bar">
      <div className="env-item phase">
        <span className="env-label">情绪</span>
        <span className="env-value" style={{ color: phaseColor }}>
          {environment.phase_label}
        </span>
      </div>
      <div className="env-item">
        <span className="env-label">仓位上限</span>
        <span className="env-value">{(environment.position_limit * 100).toFixed(0)}%</span>
      </div>
      <div className="env-item">
        <span className="env-label">主线</span>
        <span className="env-value sectors">
          {environment.main_sectors.length > 0
            ? environment.main_sectors.join(" > ")
            : "—"}
        </span>
      </div>
      <div className="env-item">
        <span className="env-label">涨停高度</span>
        <span className="env-value">{environment.height}板</span>
      </div>
      <div className="env-item">
        <span className="env-label">涨停家数</span>
        <span className="env-value">{environment.limit_up_count}</span>
      </div>
      <div className="env-item">
        <span className="env-label">晋级率</span>
        <span className="env-value">{fmtPct(environment.promotion_rate)}</span>
      </div>
    </div>
  );
}

function CandidateTable({
  candidates,
  env,
}: {
  candidates: Candidate[];
  env: SelectionEnvironment;
}) {
  const queryClient = useQueryClient();

  const startTrackMutation = useMutation({
    mutationFn: (c: Candidate) =>
      api.startTrack({
        symbol: c.symbol,
        name: c.name,
        entry_price: c.close,
        stop_loss: c.stop_loss || c.close * 0.95,
        take_profit: c.entry_high ? c.entry_high * 1.15 : c.close * 1.15,
        max_hold_days: 5,
        reason: `策略[${c.strategy_hits.join(",")}]命中, 得分${c.score}`,
        strategy_id: c.strategy_hits[0] || "",
        score: c.score,
        factor_summary: c.factor_contributions
          .map((f) => `${f.factor_label}:${f.contribution.toFixed(1)}`)
          .join(", "),
        sector: c.sector,
        phase_at_entry: env.phase,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["selection", "tracks"] });
    },
  });

  return (
    <div className="candidate-table-wrap">
      <table className="candidate-table">
        <thead>
          <tr>
            <th>#</th>
            <th>代码</th>
            <th>名称</th>
            <th>得分</th>
            <th>价格</th>
            <th>涨跌幅</th>
            <th>换手</th>
            <th>建议仓位</th>
            <th>止损</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, i) => (
            <tr key={c.symbol}>
              <td className="rank">{i + 1}</td>
              <td className="symbol">{c.symbol}</td>
              <td className="name">
                {c.name}
                {c.sector && <span className="sector-tag">{c.sector}</span>}
              </td>
              <td className="score">{c.score.toFixed(1)}</td>
              <td>{fmtPrice(c.close)}</td>
              <td className={c.pct_chg >= 0 ? "up" : "down"}>
                {fmtPct(c.pct_chg)}
              </td>
              <td>{c.turnover_rate.toFixed(2)}%</td>
              <td>{c.suggested_position.toFixed(0)}%</td>
              <td className="stop-loss">{fmtPrice(c.stop_loss)}</td>
              <td>
                <button
                  className="track-btn"
                  onClick={() => startTrackMutation.mutate(c)}
                  disabled={startTrackMutation.isPending}
                >
                  <Eye size={14} />
                  跟踪
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 因子贡献（第一只股票） */}
      {candidates[0]?.factor_contributions?.length > 0 && (
        <div className="factor-breakdown">
          <h4>{candidates[0].name} 因子贡献</h4>
          <div className="factor-bars">
            {candidates[0].factor_contributions
              .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
              .map((f) => (
                <div key={f.factor_id} className="factor-bar-row">
                  <span className="factor-name">{f.factor_label}</span>
                  <div className="factor-bar-track">
                    <div
                      className="factor-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.abs(f.contribution) * 5)}%`,
                        background: f.contribution >= 0 ? "#2ecc71" : "#e74c3c",
                      }}
                    />
                  </div>
                  <span className="factor-value">{f.contribution.toFixed(2)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrackPool({ tracks }: { tracks: TrackRecord[] }) {
  const active = tracks.filter((t) => t.status === "watching" || t.status === "holding");
  const closed = tracks.filter((t) => t.status === "sold" || t.status === "stopped");

  return (
    <div className="track-pool">
      <h3>
        跟踪池 <span className="count">{active.length}只跟踪中</span>
      </h3>
      {active.length > 0 && (
        <table className="track-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>买入价</th>
              <th>现价</th>
              <th>止损</th>
              <th>浮盈</th>
              <th>入选原因</th>
            </tr>
          </thead>
          <tbody>
            {active.map((t) => (
              <tr key={t.symbol}>
                <td className="symbol">{t.symbol}</td>
                <td>{t.name}</td>
                <td>{fmtPrice(t.entry_price)}</td>
                <td>{fmtPrice(t.current_price)}</td>
                <td className="stop-loss">{fmtPrice(t.stop_loss)}</td>
                <td className={t.pnl_pct && t.pnl_pct >= 0 ? "up" : "down"}>
                  {t.pnl_pct != null ? `${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(2)}%` : "—"}
                </td>
                <td className="reason">{t.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {closed.length > 0 && (
        <p className="closed-count">
          已平仓 {closed.length} 只，胜率{" "}
          {(
            (closed.filter((t) => (t.pnl_pct || 0) > 0).length / closed.length) *
            100
          ).toFixed(0)}
          %
        </p>
      )}
    </div>
  );
}
