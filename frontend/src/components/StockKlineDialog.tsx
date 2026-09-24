import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { WatchlistToggle } from "./WatchlistToggle";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { klineDate, lastKline, num, resampleKline, resampleMinuteKline, trendFacts, trendTags, type KlineRow } from "../lib/kline";
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
  const [tab, setTab] = useState<"daily" | "d5" | "m15" | "m5" | "minute" | "finance">("daily");
  const kline = useQuery({
    queryKey: queryKeys.klineDaily(symbol),
    queryFn: () => api.klineDaily(symbol, 800),
  });
  const minute = useQuery({
    queryKey: queryKeys.klineMinute(symbol),
    queryFn: () => api.klineMinute(symbol),
    enabled: tab === "minute" || tab === "m5" || tab === "m15",
  });
  const minuteRange = useQuery({
    queryKey: queryKeys.klineMinuteRange(symbol),
    queryFn: () => api.klineMinuteRange(symbol, 10),
    enabled: tab === "m5" || tab === "m15",
  });
  const { universe } = useUniverse();
  useEffect(() => {
    if (universe !== "stock" && tab === "finance") setTab("daily");
  }, [universe, tab]);
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

  const dailyRows = (kline.data?.rows ?? []) as KlineRow[];
  const fiveDayRows = useMemo(() => resampleKline(dailyRows, 5), [dailyRows]);
  const todayRows = useMemo(
    () =>
      ((minute.data?.rows ?? []) as KlineRow[]).map((row) => ({
        ...row,
        date: row.datetime ?? row.date,
      })),
    [minute.data?.rows],
  );
  const rangeRows = useMemo(
    () =>
      (minuteRange.data?.sessions ?? []).flatMap((session) =>
        ((session.rows ?? []) as KlineRow[]).map((row) => ({
          ...row,
          date: row.datetime ?? row.date,
        })),
      ),
    [minuteRange.data?.sessions],
  );
  const intraRows = useMemo(() => {
    if (todayRows.length === 0) return rangeRows;
    const today = klineDate(todayRows[0]?.date);
    return [...rangeRows.filter((row) => klineDate(row.date) !== today), ...todayRows];
  }, [rangeRows, todayRows]);
  const fiveMinRows = useMemo(() => resampleMinuteKline(intraRows, 5), [intraRows]);
  const fifteenMinRows = useMemo(() => resampleMinuteKline(intraRows, 15), [intraRows]);
  const chartRows =
    tab === "d5"
      ? fiveDayRows
      : tab === "minute"
        ? todayRows
        : tab === "m5"
          ? fiveMinRows
          : tab === "m15"
            ? fifteenMinRows
            : dailyRows;
  const intraTab = tab === "minute" || tab === "m5" || tab === "m15";
  const chartLoading =
    tab === "minute"
      ? minute.isLoading
      : tab === "m5" || tab === "m15"
        ? chartRows.length === 0 && (minuteRange.isLoading || minute.isLoading)
        : kline.isLoading;
  const chartError =
    tab === "minute"
      ? minute.error
      : tab === "m5" || tab === "m15"
        ? chartRows.length === 0
          ? (minuteRange.error ?? minute.error)
          : null
        : kline.error;
  const rows = dailyRows;
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
    <div className="kline-root" role="dialog" aria-modal="true" aria-label={`${displayName} 走势`}>
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
          <div className="kline-head-actions">
            <WatchlistToggle symbol={symbol} name={displayName} />
            <button className="btn-quiet" type="button" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
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
          <button type="button" className={tab === "daily" ? "is-on" : ""} onClick={() => setTab("daily")}>
            日K
          </button>
          <button type="button" className={tab === "d5" ? "is-on" : ""} onClick={() => setTab("d5")}>
            5日K
          </button>
          <button type="button" className={tab === "m15" ? "is-on" : ""} onClick={() => setTab("m15")}>
            15分
          </button>
          <button type="button" className={tab === "m5" ? "is-on" : ""} onClick={() => setTab("m5")}>
            5分
          </button>
          <button type="button" className={tab === "minute" ? "is-on" : ""} onClick={() => setTab("minute")}>
            分时
          </button>
          {universe === "stock" ? (
            <button type="button" className={tab === "finance" ? "is-on" : ""} onClick={() => setTab("finance")}>
              财务
            </button>
          ) : null}
        </div>

        {tab !== "finance" ? (
          <div className="kline-pane">
            {chartLoading ? (
              <div className="kline-empty">{intraTab ? "加载分钟K…" : "加载日K…"}</div>
            ) : null}
            {chartError ? (
              <div className="kline-empty">
                {(chartError as Error).message || (intraTab ? "分钟K读取失败" : "日K读取失败")}
              </div>
            ) : null}
            {!chartLoading && !chartError && chartRows.length === 0 ? (
              <div className="kline-empty">{intraTab ? "无分钟数据" : "无日K数据"}</div>
            ) : null}
            {chartRows.length > 0 ? <DailyKChart rows={chartRows} axis={intraTab ? "minute" : "day"} /> : null}
            <p className="kline-note">
              {tab === "d5"
                ? "5日K由日K每5个交易日合成，缠论在该周期上独立计算。"
                : tab === "m15"
                  ? "15分K由1分钟K按交易日每15根合成，午休不跨段。缠论在该周期独立计算。无分钟权限时为空。"
                  : tab === "m5"
                    ? "5分K由1分钟K按交易日每5根合成，午休不跨段。缠论在该周期独立计算。无分钟权限时为空。"
                    : tab === "minute"
                      ? "分时用当日1分钟K做缠论，不是均价分时线。无分钟权限时为空。"
                      : "缠论：包含分型、笔、线段、笔中枢与线段中枢；同级别分解走势；MACD/斜率背驰出一买一卖，回抽不破为二类，中枢外回踩为三类。虚线未确认。"}
            </p>
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
