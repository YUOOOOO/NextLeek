import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { lastKline, num, trendFacts, trendTags, type KlineRow } from "../lib/kline";
import { useUniverse } from "../lib/universe";
import { DailyKChart } from "./DailyKChart";

export type StockRef = { symbol: string; name?: string | null };

const FIN_FIELDS: Array<[string, string]> = [
  ["period_end", "报告期"],
  ["eps", "EPS"],
  ["bps", "BPS"],
  ["roe", "ROE"],
  ["roa", "ROA"],
  ["gross_margin", "毛利率"],
  ["net_margin", "净利率"],
  ["revenue_yoy", "营收同比"],
  ["net_income_yoy", "净利同比"],
  ["debt_ratio", "负债率"],
];

function fmtCell(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number" && Number.isFinite(v)) return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

export function StockKlineDialog({ symbol, name, onClose }: StockRef & { onClose: () => void }) {
  const [tab, setTab] = useState<"kline" | "finance">("kline");
  const kline = useQuery({
    queryKey: queryKeys.klineDaily(symbol),
    queryFn: () => api.klineDaily(symbol, 250),
  });
  const { universe } = useUniverse();
  useEffect(() => {
    if (universe !== "stock") setTab("kline");
  }, [universe]);
  const finStatus = useQuery({
    queryKey: queryKeys.financialStatus,
    queryFn: api.financialStatus,
    enabled: universe === "stock",
  });
  const metrics = useQuery({
    queryKey: queryKeys.financialMetrics(symbol),
    queryFn: () => api.financialMetrics(symbol),
    enabled: universe === "stock" && finStatus.data?.available === true,
  });
  const signals = useQuery({
    queryKey: queryKeys.displaySignals(universe),
    queryFn: () => api.listDisplaySignals(universe),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = (kline.data?.rows ?? []) as KlineRow[];
  const last = lastKline(rows);
  const extras = useMemo(
    () =>
      (signals.data?.custom ?? [])
        .filter((item) => item.enabled && item.field)
        .map((item) => ({
          id: item.id,
          label: item.name,
          field: item.field as string,
          tone: item.tone,
        })),
    [signals.data?.custom],
  );
  const tags = useMemo(() => trendTags(last, extras), [extras, last]);
  const facts = trendFacts(last);
  const displayName = name || kline.data?.name || kline.data?.stock_info?.name || symbol;
  const close = num(last?.close);
  const change = num(last?.change_pct);
  const latestMetric = metrics.data?.data?.length
    ? [...metrics.data.data].sort((a, b) => String(b.period_end ?? "").localeCompare(String(a.period_end ?? "")))[0]
    : null;
  const financeBlocked = finStatus.data && finStatus.data.available === false;
  const financeEmpty = !financeBlocked && (metrics.isSuccess || finStatus.isSuccess) && !latestMetric;

  return (
    <div className="kline-root" role="dialog" aria-modal="true" aria-label={`${displayName} 日K`}>
      <button className="kline-scrim" type="button" aria-label="关闭" onClick={onClose} />
      <section className="kline-dialog">
        <header className="kline-head">
          <div>
            <div className="kline-title">
              {displayName}
              <span className="kline-code">{symbol}</span>
            </div>
            <div className="kline-quote">
              <span className={change != null && change < 0 ? "is-down" : "is-up"}>
                {close == null ? "—" : close.toFixed(2)}
                {change == null ? "" : ` ${change >= 0 ? "+" : ""}${(change * 100).toFixed(2)}%`}
              </span>
              {facts ? <span className="kline-facts">{facts}</span> : null}
            </div>
          </div>
          <button className="btn-quiet" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="kline-tags">
          {kline.isLoading ? <span className="kline-muted">读取日K…</span> : null}
          {kline.isError ? <span className="kline-err">{(kline.error as Error).message}</span> : null}
          {!kline.isLoading && !kline.isError && tags.length === 0 ? (
            <span className="kline-muted">最后一根日K没有命中走势标签</span>
          ) : null}
          {tags.map((tag) => (
            <span key={tag.id} className={`kline-tag is-${tag.tone}`}>
              {tag.label}
            </span>
          ))}
        </div>

        <div className="kline-tabs">
          <button type="button" className={tab === "kline" ? "is-on" : ""} onClick={() => setTab("kline")}>
            日K
          </button>
          {universe === "stock" ? (
            <button type="button" className={tab === "finance" ? "is-on" : ""} onClick={() => setTab("finance")}>
              财务
            </button>
          ) : null}
        </div>

        {tab === "kline" ? (
          <div className="kline-pane">
            {kline.isLoading ? <div className="kline-empty">加载日K…</div> : null}
            {kline.isError ? <div className="kline-empty">日K读取失败</div> : null}
            {!kline.isLoading && !kline.isError && rows.length === 0 ? <div className="kline-empty">无日K数据</div> : null}
            {rows.length > 0 ? <DailyKChart rows={rows} /> : null}
            <p className="kline-note">走势标签只打最后一根日K实算命中。分时无本地分钟K，不画。暂无 AI 个股分析。</p>
          </div>
        ) : universe === "stock" ? (
          <div className="kline-pane">
            {financeBlocked ? <div className="kline-empty">无财务权限，本地也没有财务数据</div> : null}
            {!financeBlocked && metrics.isLoading ? <div className="kline-empty">读取财务…</div> : null}
            {!financeBlocked && metrics.isError ? (
              <div className="kline-empty">{(metrics.error as Error).message || "财务读取失败"}</div>
            ) : null}
            {financeEmpty ? <div className="kline-empty">无财务数据</div> : null}
            {latestMetric ? (
              <div className="kline-fin">
                {FIN_FIELDS.map(([key, label]) => (
                  <div key={key} className="kline-fin-row">
                    <span>{label}</span>
                    <span>{fmtCell(latestMetric[key])}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
