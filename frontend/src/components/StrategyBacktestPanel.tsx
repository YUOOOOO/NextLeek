import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import type { ResearchResult, StrategyResearchIn } from "../lib/api";

export type BacktestForm = {
  start: string;
  end: string;
  initialCapital: string;
  fees: string;
  stampTax: string;
  slippage: string;
  maxPositions: string;
  holdingDays: string;
  entryFill: "close_t" | "open_t+1";
  exitFill: "close_t" | "open_t+1";
};

function ymd(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function defaultBacktestForm(): BacktestForm {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  return {
    start: ymd(start),
    end: ymd(end),
    initialCapital: "1000000",
    fees: "2",
    stampTax: "1",
    slippage: "5",
    maxPositions: "10",
    holdingDays: "5",
    entryFill: "open_t+1",
    exitFill: "open_t+1",
  };
}

export function toResearchBody(form: BacktestForm): StrategyResearchIn {
  return {
    start: form.start || null,
    end: form.end || null,
    initial_capital: Number(form.initialCapital) || 1_000_000,
    commission_pct: (Number(form.fees) || 0) / 10_000,
    stamp_tax_pct: (Number(form.stampTax) || 0) / 1_000,
    slippage_bps: Number(form.slippage) || 0,
    max_positions: Number(form.maxPositions) || 10,
    holding_days: Number(form.holdingDays) || 5,
    entry_fill: form.entryFill,
    exit_fill: form.exitFill,
  };
}

function pct(value: number | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function money(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function EquitySpark({ points }: { points: Array<{ date: string; value: number }> }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = el.current;
    if (!host || points.length === 0) return;
    const chart = echarts.init(host, undefined, { renderer: "canvas" });
    const option: EChartsOption = {
      animation: false,
      grid: { left: 48, right: 8, top: 8, bottom: 24 },
      xAxis: { type: "category", data: points.map((p) => p.date), axisLabel: { fontSize: 10 }, axisTick: { show: false } },
      yAxis: { scale: true, splitNumber: 3, axisLabel: { fontSize: 10 } },
      series: [{ type: "line", data: points.map((p) => p.value), symbol: "none", lineStyle: { width: 1.4, color: "#6799fe" }, areaStyle: { color: "rgba(103,153,254,0.12)" } }],
    };
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(host);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [points]);
  return <div ref={el} className="bt-spark" />;
}

export function StrategyBacktestPanel({
  form,
  onChange,
  result,
  pending,
  canRun,
  blockedReason,
  onRun,
  factorMode,
}: {
  form: BacktestForm;
  onChange: (next: BacktestForm) => void;
  result: ResearchResult | null;
  pending: boolean;
  canRun: boolean;
  blockedReason?: string;
  onRun: () => void;
  factorMode?: boolean;
}) {
  const set = (patch: Partial<BacktestForm>) => onChange({ ...form, ...patch });
  const shiftStart = (months: number) => {
    const end = new Date(`${form.end}T00:00:00`);
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    set({ start: ymd(start) });
  };
  const trades = result?.trades ?? [];
  const curve = result?.equity_curve ?? [];
  const stats = useMemo(() => {
    if (!result?.ok) return [];
    if (factorMode) {
      return [
        ["IC", result.ic ?? "—"],
        ["IR", result.ir ?? "—"],
        ["样本", result.days ?? "—"],
      ];
    }
    return [
      ["本金", money(result.initial_capital)],
      ["期末", money(result.final_equity)],
      ["收益", pct(result.total_return)],
      ["年化", pct(result.annual_return)],
      ["最大回撤", pct(result.max_drawdown)],
      ["夏普", result.sharpe ?? "—"],
      ["胜率", pct(result.win_rate)],
      ["交易", result.trade_count ?? 0],
    ];
  }, [factorMode, result]);

  return (
    <div className="bt-panel">
      <div className="bt-grid">
        <label>
          开始
          <input type="date" value={form.start} onChange={(e) => set({ start: e.target.value })} />
        </label>
        <label>
          结束
          <input type="date" value={form.end} onChange={(e) => set({ end: e.target.value })} />
        </label>
        <div className="bt-quick">
          <button type="button" className="btn-quiet" onClick={() => shiftStart(3)}>
            近3月
          </button>
          <button type="button" className="btn-quiet" onClick={() => shiftStart(12)}>
            近1年
          </button>
        </div>
        {factorMode ? (
          <label>
            前瞻天数
            <input value={form.holdingDays} onChange={(e) => set({ holdingDays: e.target.value })} />
          </label>
        ) : (
          <>
            <label>
              本金
              <input value={form.initialCapital} onChange={(e) => set({ initialCapital: e.target.value })} />
            </label>
            <label>
              持有天数
              <input value={form.holdingDays} onChange={(e) => set({ holdingDays: e.target.value })} />
            </label>
            <label>
              最大持股
              <input value={form.maxPositions} onChange={(e) => set({ maxPositions: e.target.value })} />
            </label>
            <label>
              佣金(万分)
              <input value={form.fees} onChange={(e) => set({ fees: e.target.value })} />
            </label>
            <label>
              印花税(千分)
              <input value={form.stampTax} onChange={(e) => set({ stampTax: e.target.value })} />
            </label>
            <label>
              滑点(bps)
              <input value={form.slippage} onChange={(e) => set({ slippage: e.target.value })} />
            </label>
            <label>
              入场
              <select value={form.entryFill} onChange={(e) => set({ entryFill: e.target.value as BacktestForm["entryFill"] })}>
                <option value="open_t+1">次日开盘</option>
                <option value="close_t">当日收盘</option>
              </select>
            </label>
            <label>
              出场
              <select value={form.exitFill} onChange={(e) => set({ exitFill: e.target.value as BacktestForm["exitFill"] })}>
                <option value="open_t+1">次日开盘</option>
                <option value="close_t">当日收盘</option>
              </select>
            </label>
          </>
        )}
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || !canRun}
        title={canRun ? undefined : blockedReason}
        onClick={onRun}
      >
        {pending ? "回测中…" : "运行回测"}
      </button>
      {pending ? <div className="kline-muted">回测中…</div> : null}
      {result?.warning ? <div className="kline-err">{result.warning}</div> : null}
      {result?.ok ? (
        <>
          <div className="bt-stats">
            {stats.map(([label, value]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {!factorMode && curve.length > 1 ? <EquitySpark points={curve} /> : null}
          {!factorMode && result.start ? (
            <div className="kline-muted">
              {result.start} ~ {result.end} · 信号日均命中 {result.avg_names ?? "—"} · 前瞻收益 {pct(result.avg_return)}
            </div>
          ) : null}
          {!factorMode && trades.length > 0 ? (
            <table className="data-table bt-trades">
              <thead>
                <tr>
                  <th>标的</th>
                  <th>买入</th>
                  <th>卖出</th>
                  <th>盈亏</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(-20).reverse().map((trade, index) => (
                  <tr key={`${trade.symbol}-${trade.entry_date}-${index}`}>
                    <td>
                      {trade.name || trade.symbol}
                      <div className="kline-muted">{trade.symbol}</div>
                    </td>
                    <td>
                      {trade.entry_date}
                      <div className="kline-muted">{trade.entry_price}</div>
                    </td>
                    <td>
                      {trade.exit_date}
                      <div className="kline-muted">{trade.exit_price}</div>
                    </td>
                    <td className={(trade.pnl ?? 0) >= 0 ? "is-up" : "is-down"}>
                      {money(trade.pnl)}
                      <div>{pct(trade.pnl_pct)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
