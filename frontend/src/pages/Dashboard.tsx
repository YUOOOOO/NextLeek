import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, OverviewRankItem, OverviewStock } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { StockKlineDialog, type StockRef } from "../components/StockKlineDialog";

function num(v: number | null | undefined) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function scoreColor(v: number) {
  if (v >= 70) return "#F04438";
  if (v >= 55) return "#FB923C";
  if (v >= 45) return "#F59E0B";
  if (v >= 30) return "#84CC16";
  return "#12B76A";
}

function fmtPrice(v: number | null | undefined, digits = 2) {
  const x = num(v);
  return x == null ? "—" : x.toFixed(digits);
}

function fmtIndexPct(v: number | null | undefined) {
  const x = num(v);
  if (x == null) return "—";
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

function fmtStockPct(v: number | null | undefined) {
  const x = num(v);
  if (x == null) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
}

function pctClass(v: number | null | undefined) {
  const x = num(v);
  if (x == null || x === 0) return "pct-flat";
  return x > 0 ? "pct-up" : "pct-down";
}

function fmtAmount(v: number | null | undefined) {
  const x = num(v);
  if (x == null) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${(x / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(x / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(x / 1e4).toFixed(0)}万`;
  return x.toFixed(0);
}

function quoteAge(ms?: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function StockList({
  title,
  rows,
  mode,
  onOpen,
}: {
  title: string;
  rows: OverviewStock[];
  mode: "gain" | "loss" | "amount" | "active";
  onOpen: (stock: StockRef) => void;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3 text-xs font-medium text-[var(--ds-color-text-placeholder)]">{title}</div>
      <table className="data-table">
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="text-[var(--ds-color-text-placeholder)]">暂无</td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.symbol} className="kline-row" onClick={() => onOpen({ symbol: row.symbol, name: row.name })}>
              <td>
                <div className="text-[var(--ds-color-text-primary)]">{row.name || row.symbol}</div>
                <div className="text-[11px] text-[var(--ds-color-text-placeholder)]">{row.symbol}</div>
              </td>
              <td className="text-right font-mono">
                {mode === "amount" ? fmtAmount(row.amount) : mode === "active" ? `${fmtPrice(row.turnover_rate, 1)}%` : fmtPrice(row.close)}
              </td>
              <td className={`text-right font-mono ${pctClass(row.change_pct)}`}>{fmtStockPct(row.change_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RankList({ title, rank }: { title: string; rank: { leading: OverviewRankItem[]; lagging: OverviewRankItem[] } }) {
  const rows = rank.leading.length ? rank.leading : rank.lagging;
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3 text-xs font-medium text-[var(--ds-color-text-placeholder)]">{title}</div>
      <table className="data-table">
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="text-[var(--ds-color-text-placeholder)]">暂无扩展数据</td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <div className="text-[var(--ds-color-text-primary)]">{row.name}</div>
                <div className="text-[11px] text-[var(--ds-color-text-placeholder)]">
                  {row.count} 只 · {row.leader?.name || row.leader?.symbol || "—"}
                </div>
              </td>
              <td className={`text-right font-mono ${pctClass(row.avg_pct)}`}>{fmtStockPct(row.avg_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Dashboard() {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: queryKeys.overviewMarket(),
    queryFn: () => api.overviewMarket(),
    refetchInterval: 15_000,
  });
  const data = overview.data;
  const [preview, setPreview] = useState<StockRef | null>(null);

  async function refresh() {
    await api.dataRefreshCache().catch(() => undefined);
    await qc.invalidateQueries({ queryKey: queryKeys.overviewMarket() });
  }

  if (overview.isLoading && !data) {
    return <div className="grid min-h-[40vh] place-items-center text-[var(--ds-color-text-placeholder)]">加载市场看板…</div>;
  }

  if (overview.isError) {
    return (
      <section className="card p-6 text-center">
        <div className="text-sm text-[#f87171]">看板加载失败</div>
        <button className="btn btn-primary mt-3" type="button" onClick={() => overview.refetch()}>
          重试
        </button>
      </section>
    );
  }

  if (!data) return null;

  const score = data.emotion?.score ?? 50;
  const running = Boolean(data.quote_status?.running);

  return (
    <div className="space-y-4">
      <div className="page-head">
        <div>
          <h1 className="page-title">看板</h1>
          <p className="page-desc">
            {data.as_of ?? "暂无行情日"} · {data.emotion.label} {score}
            {running ? " · 实时" : " · 盘后"}
            {data.quote_status?.quote_age_ms != null ? ` · ${quoteAge(data.quote_status.quote_age_ms)}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()}>
            重载
          </button>
          <Link to="/data" className="btn btn-ghost">
            数据
          </Link>
        </div>
      </div>

      {!data.as_of && (
        <section className="card p-4 text-sm text-[var(--ds-color-text-description)]">
          本地还没有 Enriched。去「数据」页同步完成后，涨跌分布和榜单才会出来。
        </section>
      )}

      <div className="dash-indices">
        {data.indices.map((item) => (
          <div key={item.symbol} className="card px-4 py-3">
            <div className="kpi-label">{item.name}</div>
            <div className="kpi-value text-[16px]">{fmtPrice(item.last_price)}</div>
            <div className={`mt-1 font-mono text-xs ${pctClass(item.change_pct)}`}>{fmtIndexPct(item.change_pct)}</div>
          </div>
        ))}
      </div>

      <div className="dash-kpis">
        <div className="kpi-cell">
          <div className="kpi-label">涨 / 平 / 跌</div>
          <div className="kpi-value text-[16px]">
            <span className="pct-up">{data.breadth.up}</span>
            <span className="text-[var(--ds-color-text-placeholder)]"> / {data.breadth.flat} / </span>
            <span className="pct-down">{data.breadth.down}</span>
          </div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">涨停 / 跌停</div>
          <div className="kpi-value text-[16px]">
            <span className="pct-up">{data.limit.limit_up}</span>
            <span className="text-[var(--ds-color-text-placeholder)]"> / </span>
            <span className="pct-down">{data.limit.limit_down}</span>
          </div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">最高连板</div>
          <div className="kpi-value text-[16px]">{data.limit.max_boards || 0}板</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">成交额</div>
          <div className="kpi-value text-[16px]">{fmtAmount(data.amount.total)}</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">换手 / 量比</div>
          <div className="kpi-value text-[16px]">
            {fmtPrice(data.activity.avg_turnover, 1)}% / {fmtPrice(data.activity.vol_ratio, 2)}
          </div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">情绪</div>
          <div className="kpi-value text-[16px]" style={{ color: scoreColor(score) }}>
            {data.emotion.label} · {score}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <section className="card p-4 space-y-2">
          <div className="text-xs text-[var(--ds-color-text-placeholder)]">涨跌分布 · {data.breadth.total} 只</div>
          {data.distribution.map((row) => (
            <div key={row.label} className="dash-dist">
              <span>{row.label}</span>
              <div className="dash-bar">
                <i style={{ width: `${Math.min(100, row.pct)}%`, background: row.label.startsWith("-") || row.label.startsWith("<") ? "#4ade80" : "#f87171" }} />
              </div>
              <span>{row.count}</span>
            </div>
          ))}
          <div className="dash-breadth">
            <i className="is-up" style={{ width: `${data.breadth.up_pct}%` }} />
            <i className="is-flat" style={{ width: `${Math.max(0, 100 - data.breadth.up_pct - data.breadth.down_pct)}%` }} />
            <i className="is-down" style={{ width: `${data.breadth.down_pct}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-[var(--ds-color-text-placeholder)]">
            <span className={pctClass(data.breadth.avg_pct)}>均 {fmtStockPct(data.breadth.avg_pct)}</span>
            <span className={pctClass(data.breadth.median_pct)}>中 {fmtStockPct(data.breadth.median_pct)}</span>
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <div className="text-xs text-[var(--ds-color-text-placeholder)]">情绪雷达</div>
          {(data.radar ?? []).map((row) => (
            <div key={row.key} className="dash-dist">
              <span>{row.label}</span>
              <div className="dash-bar">
                <i style={{ width: `${Math.min(100, row.value)}%`, background: scoreColor(row.value) }} />
              </div>
              <span>{row.value}</span>
            </div>
          ))}
        </section>

        <section className="card p-4">
          <div className="text-xs text-[var(--ds-color-text-placeholder)]">趋势 / 监控</div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div>
              <div className="kpi-label">MA5</div>
              <div className="kpi-value text-[15px]">{data.trend.above_ma5_pct.toFixed(0)}%</div>
            </div>
            <div>
              <div className="kpi-label">MA20</div>
              <div className="kpi-value text-[15px]">{data.trend.above_ma20_pct.toFixed(0)}%</div>
            </div>
            <div>
              <div className="kpi-label">MA60</div>
              <div className="kpi-value text-[15px]">{data.trend.above_ma60_pct.toFixed(0)}%</div>
            </div>
            <div>
              <div className="kpi-label">新高</div>
              <div className="kpi-value text-[15px] pct-up">{data.trend.new_high}</div>
            </div>
            <div>
              <div className="kpi-label">新低</div>
              <div className="kpi-value text-[15px] pct-down">{data.trend.new_low}</div>
            </div>
            <div>
              <div className="kpi-label">炸板</div>
              <div className="kpi-value text-[15px]">{data.limit.broken}</div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {(data.limit.tiers ?? []).slice(0, 6).map((tier) => (
              <div key={tier.boards} className="flex justify-between text-xs">
                <span>{tier.boards}板 · {tier.count}</span>
                <span className="text-[var(--ds-color-text-placeholder)] truncate ml-3">
                  {(tier.stocks ?? []).map((s) => s.name || s.symbol).join(" · ") || "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <RankList title="概念热度" rank={data.concept_rank} />
        <RankList title="行业热度" rank={data.industry_rank} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StockList title="涨幅榜" rows={data.top_gainers} mode="gain" onOpen={setPreview} />
        <StockList title="跌幅榜" rows={data.top_losers} mode="loss" onOpen={setPreview} />
        <StockList title="成交额榜" rows={data.turnover_leaders} mode="amount" onOpen={setPreview} />
        <StockList title="活跃换手" rows={data.active_leaders} mode="active" onOpen={setPreview} />
      </div>
      {preview ? (
        <StockKlineDialog symbol={preview.symbol} name={preview.name} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}
