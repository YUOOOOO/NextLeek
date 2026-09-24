import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api, MonitorRow } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { AiDock } from "../components/AiDock";
import { StockKlineDialog, type StockRef } from "../components/StockKlineDialog";
import { UniverseShell } from "../components/UniverseBar";
import { AiChatProvider, MONITOR_INTRO } from "../lib/aiChat";
import { trendTags } from "../lib/kline";
import { useUniverse } from "../lib/universe";

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
      void queryClient.invalidateQueries({ queryKey: ["monitor"] });
    };
    source.addEventListener("pool_updated", refresh);
    source.addEventListener("strategy_alert", refresh);
    source.onerror = () => undefined;
    return () => source.close();
  }, [queryClient]);
}

export function Monitor() {
  useMonitorStream();
  const { universe } = useUniverse();
  const snapshot = useQuery({
    queryKey: queryKeys.monitor(universe),
    queryFn: () => api.monitorSnapshot(universe),
    refetchInterval: 5_000,
  });
  const prevSymbols = useRef<Map<string, Set<string>>>(new Map());
  const [flash, setFlash] = useState<Record<string, "in" | "out">>({});
  const [ghosts, setGhosts] = useState<Record<string, MonitorRow[]>>({});
  const [preview, setPreview] = useState<StockRef | null>(null);
  const [eventFilter, setEventFilter] = useState<"all" | "in" | "out">("all");
  const [selectedId, setSelectedId] = useState("all");
  const [feedOpen, setFeedOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem("nextleek_mon_ai_open") !== "0");
  const [sideWidth, setSideWidth] = useState(() => Number(localStorage.getItem("nextleek_mon_side_width") || 340));
  const sideDragging = useRef(false);
  const queryClient = useQueryClient();
  const stopWatch = useMutation({
    mutationFn: (id: string) => api.stopStrategyMonitor(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.monitor(universe) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.strategies(universe) });
    },
  });
  useEffect(() => {
    prevSymbols.current = new Map();
    setFlash({});
    setGhosts({});
    setSelectedId("all");
  }, [universe]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!sideDragging.current) return;
      event.preventDefault();
      const next = Math.max(280, Math.min(720, window.innerWidth - event.clientX));
      setSideWidth(next);
      localStorage.setItem("nextleek_mon_side_width", String(next));
    };
    const up = () => {
      if (!sideDragging.current) return;
      sideDragging.current = false;
      document.body.classList.remove("is-resizing");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("is-resizing");
    };
  }, []);

  const strategies = snapshot.data?.strategies ?? [];
  const events = snapshot.data?.events ?? [];
  const filteredEvents = useMemo(() => {
    const scoped = selectedId === "all" ? events : events.filter((event) => event.strategy_id === selectedId);
    if (eventFilter === "all") return scoped;
    return scoped.filter((event) => {
      const leaving = event.type === "pool_exit" || event.message.includes("移出");
      return eventFilter === "out" ? leaving : !leaving;
    });
  }, [events, eventFilter, selectedId]);

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

  const selected = liveRows.find((item) => item.strategy.id === selectedId) ?? null;
  const boardRows = useMemo(() => {
    const source = selectedId === "all" || !selected ? liveRows : [selected];
    const rows = source.flatMap(({ strategy, rows }) => rows.map((row) => ({ ...row, strategy })));
    rows.sort((a, b) => (num(b.change_pct) ?? -Infinity) - (num(a.change_pct) ?? -Infinity));
    return rows;
  }, [liveRows, selected, selectedId]);

  useEffect(() => {
    if (selectedId !== "all" && !liveRows.some((item) => item.strategy.id === selectedId)) {
      setSelectedId("all");
    }
  }, [liveRows, selectedId]);

  const data = snapshot.data;
  const emptyWatches = !data || data.watch_count === 0;

  return (
    <AiChatProvider workspace="monitor" intro={MONITOR_INTRO}>
      <UniverseShell>
      <div className="ide">
        <section className="ide-editor">
          <div className="mon-toolbar">
            <div className="mon-status">
              <i className={snapshot.isError ? "is-error" : ""} />
              {snapshot.isError ? "异常" : "实时运行"}
            </div>
            <span className="mon-toolbar-stat">
              行情日<b>{data?.as_of ?? "—"}</b>
            </span>
            <span className="mon-toolbar-stat">
              策略<b>{data?.watch_count ?? 0}</b>
            </span>
            <span className="mon-toolbar-stat">
              命中<b>{data?.hit_count ?? 0}</b>
            </span>
            <span className="mon-toolbar-stat">
              最近<b>{events[0]?.ts ? fmtTime(events[0].ts) : "—"}</b>
            </span>
          </div>
          {snapshot.isError ? (
            <div className="mon-empty">
              监控加载失败
              <div>
                <button className="btn btn-primary mt-3" type="button" onClick={() => snapshot.refetch()}>
                  重试
                </button>
              </div>
            </div>
          ) : snapshot.isLoading && !data ? (
            <div className="mon-empty">加载监控…</div>
          ) : (
            <div className="mon-split">
              <aside className="mon-watches">
                <div className="mon-col-head">监控中</div>
                <div className="mon-watch-list">
                  <button type="button" className={`ide-row${selectedId === "all" ? " is-on" : ""}`} onClick={() => setSelectedId("all")}>
                    <div className="ide-row-top">
                      <span className="ide-row-name">全部</span>
                      <span className="mon-watch-count">{data?.hit_count ?? 0}</span>
                    </div>
                    <div className="mon-pool-meta">{data?.watch_count ?? 0} 个策略</div>
                  </button>
                  {liveRows.map(({ strategy, rows }) => (
                    <button
                      key={strategy.id}
                      type="button"
                      className={`ide-row${selectedId === strategy.id ? " is-on" : ""}`}
                      onClick={() => setSelectedId(strategy.id)}
                    >
                      <div className="ide-row-top">
                        <span className="ide-row-name">{strategy.name}</span>
                        <span className="mon-watch-count">{rows.length}</span>
                      </div>
                      <div className="mon-pool-meta">{KIND_LABEL[strategy.kind] || strategy.kind}</div>
                    </button>
                  ))}
                </div>
              </aside>
              <section className="mon-board">
                <div className="mon-col-head">
                  <span>{selected ? selected.strategy.name : "当前命中"}</span>
                  <span className="mon-col-count">{boardRows.length} 只</span>
                  <div className="mon-pool-actions">
                    {selected ? (
                      <button type="button" className="btn-quiet" disabled={stopWatch.isPending} onClick={() => stopWatch.mutate(selected.strategy.id)}>
                        取消监控
                      </button>
                    ) : null}
                    <button type="button" className={`btn-quiet${feedOpen ? " is-on" : ""}`} onClick={() => setFeedOpen((open) => !open)}>
                      日志
                    </button>
                  </div>
                </div>
                {emptyWatches ? (
                  <div className="mon-empty">还没有监控。右侧从已有策略创建单条或叠加。</div>
                ) : boardRows.length === 0 ? (
                  <div className="mon-empty">等待命中</div>
                ) : (
                  <div className="mon-board-body">
                    <table className="data-table mon-table">
                      <thead>
                        <tr>
                          <th>标的</th>
                          {selectedId === "all" ? <th>策略</th> : null}
                          <th>信号</th>
                          <th className="text-right">现价</th>
                          <th className="text-right">涨跌</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boardRows.map((row) => {
                          const mark = flash[`${row.strategy.id}:${row.symbol}`];
                          const tags = trendTags(row, snapshot.data?.custom_tags);
                          return (
                            <tr
                              key={`${row.strategy.id}:${row.symbol}`}
                              className={mark ? `mon-row is-${mark}` : "mon-row"}
                              onClick={() => setPreview({ symbol: row.symbol, name: row.name || row.symbol })}
                            >
                              <td>
                                <div className="mon-sym-name">{row.name || row.symbol}</div>
                                <div className="mon-sym-code">{row.symbol}</div>
                              </td>
                              {selectedId === "all" ? <td className="mon-sym-code">{row.strategy.name}</td> : null}
                              <td>
                                <div className="kline-tags mon-tags">
                                  {tags.length === 0 ? <span className="mon-sym-code">—</span> : null}
                                  {tags.map((tag) => (
                                    <span key={tag.id} className={`kline-tag is-${tag.tone}`}>
                                      {tag.label}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="text-right font-mono">{fmtPrice(row.close)}</td>
                              <td className={`text-right font-mono ${pctClass(row.change_pct)}`}>{fmtPct(row.change_pct)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              {feedOpen ? (
                <section className="mon-feed">
                  <div className="mon-col-head mon-events-head">
                    <span>进出</span>
                    <div className="mon-filter" role="group" aria-label="事件筛选">
                      {(["all", "in", "out"] as const).map((filter) => (
                        <button key={filter} type="button" className={eventFilter === filter ? "is-on" : ""} onClick={() => setEventFilter(filter)}>
                          {filter === "all" ? "全部" : filter === "in" ? "进入" : "离场"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mon-feed-body">
                    {filteredEvents.length === 0 ? (
                      <div className="mon-empty">{events.length === 0 ? "尚未发生进入或移出" : "没有符合筛选条件的事件"}</div>
                    ) : (
                      filteredEvents.map((event) => {
                        const leaving = event.type === "pool_exit" || event.message.includes("移出");
                        return (
                          <button
                            key={`${event.ts}-${event.symbol}-${event.message}`}
                            type="button"
                            className={`mon-feed-row${leaving ? " is-out" : " is-in"}`}
                            disabled={!event.symbol}
                            onClick={() => event.symbol && setPreview({ symbol: event.symbol, name: event.name || event.symbol })}
                          >
                            <span className="mon-feed-time">{event.ts ? fmtTime(event.ts) : ""}</span>
                            <span className="mon-feed-tag">{leaving ? "离" : "进"}</span>
                            <span className="mon-feed-main">
                              <span className="mon-sym-name">{event.name || event.symbol || event.message}</span>
                              <span className="mon-feed-msg">{event.message}</span>
                            </span>
                            <span className={`font-mono ${pctClass(event.change_pct)}`}>{fmtPct(event.change_pct)}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </section>
        <aside className="ide-side">
          {sideOpen ? (
            <div className="ide-side-panel" style={{ width: sideWidth }}>
              <div
                className="ide-side-resize"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  sideDragging.current = true;
                  document.body.classList.add("is-resizing");
                  window.getSelection()?.removeAllRanges();
                }}
                aria-label="拖动调整侧栏宽度"
              />
              <div className="ide-ai-head">
                <span>AI · 配置监控</span>
              </div>
              <AiDock mode="monitor" />
            </div>
          ) : null}
          <nav className="ide-rail" aria-label="侧栏">
            <button
              type="button"
              className={`wb-item${sideOpen ? " is-active" : ""}`}
              aria-label="AI"
              title="AI"
              onClick={() => {
                setSideOpen((open) => {
                  const next = !open;
                  localStorage.setItem("nextleek_mon_ai_open", next ? "1" : "0");
                  return next;
                });
              }}
            >
              <Sparkles size={15} className="wb-item-icon" />
            </button>
          </nav>
        </aside>
        {preview ? <StockKlineDialog symbol={preview.symbol} name={preview.name} onClose={() => setPreview(null)} /> : null}
      </div>
      </UniverseShell>
    </AiChatProvider>
  );
}

