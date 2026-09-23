import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, MonitorEvent, MonitorRow, MonitorStrategy } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { StockKlineDialog, type StockRef } from "../components/StockKlineDialog";

const KIND_LABEL: Record<string, string> = {
  formula: "公式",
  conditions: "条件",
  composite: "叠加",
};

function num(v: number | null | undefined) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtPrice(v: number | null | undefined) {
  const x = num(v);
  return x == null ? "—" : x.toFixed(2);
}

function fmtPct(v: number | null | undefined) {
  const x = num(v);
  if (x == null) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
}

function pctClass(v: number | null | undefined) {
  const x = num(v);
  if (x == null) return "";
  return x >= 0 ? "is-up" : "is-down";
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function useMonitorStream() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource("/api/monitor/stream");
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.monitor });
    };
    source.addEventListener("pool_updated", refresh);
    source.addEventListener("strategy_alert", refresh);
    source.onerror = () => undefined;
    return () => source.close();
  }, [queryClient]);
}

export function Monitor() {
  useMonitorStream();
  const snapshot = useQuery({
    queryKey: queryKeys.monitor,
    queryFn: api.monitorSnapshot,
    refetchInterval: 5_000,
  });
  const prevSymbols = useRef<Map<string, Set<string>>>(new Map());
  const [flash, setFlash] = useState<Record<string, "in" | "out">>({});
  const [ghosts, setGhosts] = useState<Record<string, MonitorRow[]>>({});
  const [preview, setPreview] = useState<StockRef | null>(null);
  const [eventFilter, setEventFilter] = useState<"all" | "in" | "out">("all");

  const strategies = snapshot.data?.strategies ?? [];
  const events = snapshot.data?.events ?? [];
  const filteredEvents = useMemo(() => {
    if (eventFilter === "all") return events;
    return events.filter((event) => {
      const leaving = event.type === "pool_exit" || event.message.includes("移出");
      return eventFilter === "out" ? leaving : !leaving;
    });
  }, [events, eventFilter]);

  useEffect(() => {
    if (!snapshot.data) return;
    const nextFlash: Record<string, "in" | "out"> = {};
    const nextGhosts: Record<string, MonitorRow[]> = { ...ghosts };
    const nextPrev = new Map<string, Set<string>>();
    for (const strategy of snapshot.data.strategies) {
      const current = new Set(strategy.rows.map((row) => row.symbol));
      const previous = prevSymbols.current.get(strategy.id);
      nextPrev.set(strategy.id, current);
      if (!previous) continue;
      for (const row of strategy.rows) {
        if (!previous.has(row.symbol)) nextFlash[`${strategy.id}:${row.symbol}`] = "in";
      }
      const leftover = (nextGhosts[strategy.id] ?? []).filter((row) => !current.has(row.symbol));
      const dropped: MonitorRow[] = [];
      for (const symbol of previous) {
        if (current.has(symbol)) continue;
        nextFlash[`${strategy.id}:${symbol}`] = "out";
        const existing = leftover.find((row) => row.symbol === symbol);
        dropped.push(existing ?? { symbol, name: symbol });
      }
      if (dropped.length) nextGhosts[strategy.id] = [...leftover, ...dropped];
      else if (leftover.length) nextGhosts[strategy.id] = leftover;
      else delete nextGhosts[strategy.id];
    }
    prevSymbols.current = nextPrev;
    if (Object.keys(nextFlash).length) {
      setFlash((prev) => ({ ...prev, ...nextFlash }));
      window.setTimeout(() => {
        setFlash((prev) => {
          const copy = { ...prev };
          for (const key of Object.keys(nextFlash)) delete copy[key];
          return copy;
        });
        setGhosts((prev) => {
          const copy = { ...prev };
          for (const [strategyId, rows] of Object.entries(copy)) {
            const keep = rows.filter((row) => nextFlash[`${strategyId}:${row.symbol}`] !== "out");
            if (keep.length) copy[strategyId] = keep;
            else delete copy[strategyId];
          }
          return copy;
        });
      }, 1200);
    }
    setGhosts(nextGhosts);
    // ghosts is merged from previous render; omit from deps to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.data]);

  const liveRows = useMemo(() => {
    return strategies.map((strategy) => {
      const outgoing = ghosts[strategy.id] ?? [];
      const seen = new Set(strategy.rows.map((row) => row.symbol));
      return {
        strategy,
        rows: [...strategy.rows, ...outgoing.filter((row) => !seen.has(row.symbol))],
      };
    });
  }, [strategies, ghosts]);

  if (snapshot.isLoading && !snapshot.data) {
    return <div className="grid min-h-[40vh] place-items-center text-[var(--ds-color-text-placeholder)]">加载监控…</div>;
  }

  if (snapshot.isError) {
    return (
      <section className="card p-6 text-center">
        <div className="text-sm text-[#f87171]">监控加载失败</div>
        <button className="btn btn-primary mt-3" type="button" onClick={() => snapshot.refetch()}>
          重试
        </button>
      </section>
    );
  }

  const data = snapshot.data;
  const emptyWatches = !data || data.watch_count === 0;

  return (
    <div className="mon-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">监控</h1>
          <p className="page-desc">
            {data?.as_of ?? "暂无行情日"}
            {data ? ` · ${data.watch_count} 个策略` : ""}
            {data ? ` · ${data.hit_count} 只在池` : ""}
            {" · 新进增加、离场移出"}
          </p>
        </div>
        <Link to="/strategies" className="btn btn-ghost">
          管理策略
        </Link>
      </div>

      <section className="mon-overview card">
        <div className="kpi-strip mon-kpis">
          <div className="kpi-cell">
            <div className="kpi-label">监控状态</div>
            <div className="mon-status"><i className={snapshot.isFetching ? "is-syncing" : ""} />{snapshot.isFetching ? "同步中" : "实时运行"}</div>
            <div className="mon-kpi-note">SSE + 5 秒快照</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">监控策略</div>
            <div className="kpi-value">{data?.watch_count ?? 0}</div>
            <div className="mon-kpi-note">正在评估的策略</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">当前命中</div>
            <div className="kpi-value">{data?.hit_count ?? 0}</div>
            <div className="mon-kpi-note">跨策略去重前</div>
          </div>
          <div className="kpi-cell mon-kpi-last">
            <div className="kpi-label">最近事件</div>
            <div className="kpi-value mon-kpi-time">{events[0]?.ts ? fmtTime(events[0].ts) : "—"}</div>
            <div className="mon-kpi-note">{events.length ? events[0].message : "暂无进出记录"}</div>
          </div>
        </div>
      </section>

      {emptyWatches ? (
        <section className="card p-6 text-sm text-[var(--ds-color-text-description)]">
          还没有监控中的策略。去「策略」页点监控后，命中标的会实时出现在这里。
        </section>
      ) : (
        <div className="mon-split">
          <section className="mon-col">
            <div className="mon-col-head">当前命中</div>
            <div className="mon-col-body">
              {liveRows.map(({ strategy, rows }) => (
                <StrategyPool
                  key={strategy.id}
                  strategy={strategy}
                  rows={rows}
                  flash={flash}
                  onOpen={setPreview}
                />
              ))}
            </div>
          </section>
          <section className="mon-col mon-col-events">
            <div className="mon-col-head mon-events-head">
              <span>进出记录</span>
              <div className="mon-filter" role="group" aria-label="事件筛选">
                {(["all", "in", "out"] as const).map((filter) => (
                  <button key={filter} type="button" className={eventFilter === filter ? "is-on" : ""} onClick={() => setEventFilter(filter)}>
                    {filter === "all" ? "全部" : filter === "in" ? "进入" : "离场"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mon-col-body">
              {filteredEvents.length === 0 ? (
                <div className="mon-empty">{events.length === 0 ? "尚未发生进入或移出" : "没有符合筛选条件的事件"}</div>
              ) : (
                filteredEvents.map((event) => (
                  <EventCard
                    key={`${event.ts}-${event.symbol}-${event.message}`}
                    event={event}
                    onOpen={setPreview}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      )}
      {preview ? (
        <StockKlineDialog symbol={preview.symbol} name={preview.name} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

function StrategyPool({
  strategy,
  rows,
  flash,
  onOpen,
}: {
  strategy: MonitorStrategy;
  rows: MonitorRow[];
  flash: Record<string, "in" | "out">;
  onOpen: (stock: StockRef) => void;
}) {
  return (
    <section className="mon-pool">
      <div className="mon-pool-head">
        <div>
          <div className="mon-pool-name">{strategy.name}</div>
          <div className="mon-pool-meta">
            {KIND_LABEL[strategy.kind] || strategy.kind} · {strategy.total} 只
          </div>
        </div>
        <Link to="/strategies" className="btn-quiet">
          打开
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="mon-empty">等待命中</div>
      ) : (
        <table className="data-table">
          <tbody>
            {rows.map((row) => {
              const mark = flash[`${strategy.id}:${row.symbol}`];
              return (
                <tr
                  key={row.symbol}
                  className={mark ? `mon-row is-${mark}` : "mon-row"}
                  onClick={() => onOpen({ symbol: row.symbol, name: row.name })}
                >
                  <td>
                    <div className="text-[var(--ds-color-text-primary)]">{row.name || row.symbol}</div>
                    <div className="text-[11px] text-[var(--ds-color-text-placeholder)]">{row.symbol}</div>
                  </td>
                  <td className="text-right font-mono">{fmtPrice(row.close)}</td>
                  <td className={`text-right font-mono ${pctClass(row.change_pct)}`}>{fmtPct(row.change_pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EventCard({ event, onOpen }: { event: MonitorEvent; onOpen: (stock: StockRef) => void }) {
  const leaving = event.type === "pool_exit" || event.message.includes("移出");
  return (
    <div
      className={`mon-event${leaving ? " is-out" : " is-in"}${event.symbol ? " kline-row" : ""}`}
      onClick={() => event.symbol && onOpen({ symbol: event.symbol, name: event.name })}
    >
      <div className="mon-event-time">{event.ts ? fmtTime(event.ts) : ""}</div>
      <div className="mon-event-msg">{event.message}</div>
      {(event.price != null || event.change_pct != null) && (
        <div className={`mon-event-quote ${pctClass(event.change_pct)}`}>
          {fmtPrice(event.price)} {fmtPct(event.change_pct)}
        </div>
      )}
    </div>
  );
}
