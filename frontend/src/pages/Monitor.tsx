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
import { isMobileApp } from "../lib/device";

const KIND_LABEL: Record<string, string> = {
  formula: "公式",
  conditions: "条件",
  composite: "叠加",
  chanlun: "缠论",
};

const THEORY_OPTIONS: Array<{ value: string; label: string }> = [{ value: "chanlun", label: "缠论" }];


type BoardRow = MonitorRow & {
  strategy: { id: string; name: string; kind: string };
  hit?: boolean;
  summary?: string;
  position?: string;
  signal?: string;
  signal_label?: string;
  signal_labels?: string[];
  period_label?: string;
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

function stockKey(id: string) {
  return `stock:${id}`;
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
    return () => source.close();
  }, [queryClient]);
}

export function Monitor() {
  const mobile = isMobileApp();
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
  const [listTab, setListTab] = useState<"strategy" | "stock">(() =>
    localStorage.getItem("nextleek_mon_list_tab") === "stock" ? "stock" : "strategy",
  );
  const [feedOpen, setFeedOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem("nextleek_mon_ai_open") !== "0");
  const [sideWidth, setSideWidth] = useState(() => Number(localStorage.getItem("nextleek_mon_side_width") || 340));
  const sideDragging = useRef(false);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ symbol: string; name: string } | null>(null);
  const [theory, setTheory] = useState("chanlun");
  const search = useQuery({
    queryKey: ["instruments", "search", query],
    queryFn: () => api.searchInstruments(query),
    enabled: query.trim().length >= 1,
  });
  const addTarget = picked ?? (query.trim() ? search.data?.results[0] ?? null : null);

  const stopWatch = useMutation({
    mutationFn: (id: string) => api.stopStrategyMonitor(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.monitor(universe) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.strategies(universe) });
    },
  });
  const addStock = useMutation({
    mutationFn: () => {
      const target = picked ?? search.data?.results[0];
      if (!target) throw new Error("先搜索并选择标的");
      return api.createStockMonitor({
        symbol: target.symbol,
        name: target.name,
        theory,
      });
    },
    onSuccess: () => {
      setQuery("");
      setPicked(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.monitor(universe) });
    },
  });
  const stopStock = useMutation({
    mutationFn: (id: string) => api.deleteStockMonitor(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.monitor(universe) });
    },
  });

  useEffect(() => {
    prevSymbols.current = new Map();
    setFlash({});
    setGhosts({});
    setSelectedId(listTab === "stock" ? "stocks" : "all");
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
  const stockWatches = snapshot.data?.stock_watches ?? [];
  const events = snapshot.data?.events ?? [];
  const filteredEvents = useMemo(() => {
    const onStock = listTab === "stock" || selectedId === "stocks" || selectedId.startsWith("stock:");
    const scoped = onStock
      ? events.filter(
          (event) =>
            event.source === "stock_chanlun" ||
            event.type === "signal_hit" ||
            String(event.message || "").includes("缠论"),
        )
      : events.filter((event) => event.source !== "stock_chanlun" && event.type !== "signal_hit");
    const narrowed =
      selectedId === "all" || selectedId === "stocks"
        ? scoped
        : scoped.filter((event) => event.strategy_id === selectedId || stockKey(event.strategy_id || "") === selectedId);
    if (eventFilter === "all") return narrowed;
    return narrowed.filter((event) => {
      const leaving = event.type === "pool_exit" || event.message.includes("移出");
      return eventFilter === "out" ? leaving : !leaving;
    });
  }, [events, eventFilter, listTab, selectedId]);

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
    const stockCurrent = new Set(stockWatches.filter((item) => item.hit).map((item) => item.id));
    const stockPrev = prevSymbols.current.get("stocks");
    nextPrev.set("stocks", stockCurrent);
    if (stockPrev) {
      for (const id of stockCurrent) {
        if (!stockPrev.has(id)) nextFlash[stockKey(id)] = "in";
      }
      for (const id of stockPrev) {
        if (!stockCurrent.has(id)) nextFlash[stockKey(id)] = "out";
      }
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
  const selectedStock =
    selectedId.startsWith("stock:") ? stockWatches.find((item) => stockKey(item.id) === selectedId) ?? null : null;

  const stockBoardRows = useMemo((): BoardRow[] => {
    if (listTab !== "stock") return [];
    const source = selectedStock ? [selectedStock] : stockWatches;
    return source.map((item) => ({
      symbol: item.symbol,
      name: item.name,
      close: item.close,
      change_pct: item.change_pct,
      hit: item.hit,
      summary: item.summary,
      position: item.position,
      signal: item.signal,
      signal_label: item.signal_label,
      signal_labels: item.signal_labels ?? [],
      period_label: item.period_label,
      strategy: {
        id: stockKey(item.id),
        name: item.signal === "all" ? "缠论" : `${item.signal_label} · ${item.period_label}`,
        kind: "chanlun",
      },
    }));
  }, [listTab, selectedStock, stockWatches]);

  const boardRows = useMemo(() => {
    const strategyRows: BoardRow[] =
      listTab !== "strategy"
        ? []
        : (selectedId === "all" || !selected ? liveRows : [selected]).flatMap(({ strategy, rows }) =>
            rows.map((row) => ({ ...row, strategy })),
          );
    const rows = [...strategyRows, ...stockBoardRows];
    rows.sort((a, b) => {
      const hitDelta = Number(Boolean(b.hit)) - Number(Boolean(a.hit));
      if (hitDelta) return hitDelta;
      return (num(b.change_pct) ?? -Infinity) - (num(a.change_pct) ?? -Infinity);
    });
    return rows;
  }, [listTab, liveRows, selected, selectedId, stockBoardRows]);

  useEffect(() => {
    if (listTab === "stock") {
      if (selectedId === "stocks") return;
      if (!selectedId.startsWith("stock:") || !stockWatches.some((item) => stockKey(item.id) === selectedId)) {
        setSelectedId("stocks");
      }
      return;
    }
    if (selectedId === "all") return;
    if (!liveRows.some((item) => item.strategy.id === selectedId)) setSelectedId("all");
  }, [listTab, liveRows, selectedId, stockWatches]);

  const data = snapshot.data;
  const emptyWatches = listTab === "stock" ? stockWatches.length === 0 : liveRows.length === 0;
  const stockHits = stockWatches.filter((item) => item.hit).length;
  const canAdd = Boolean(addTarget);
  const showRuleCol = selectedId === "all" || selectedId === "stocks";
  const switchListTab = (tab: "strategy" | "stock") => {
    setListTab(tab);
    localStorage.setItem("nextleek_mon_list_tab", tab);
    setSelectedId(tab === "stock" ? "stocks" : "all");
  };


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
              策略<b>{strategies.length}</b>
            </span>
            <span className="mon-toolbar-stat">
              个股<b>{stockWatches.length}</b>
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
                <div className="mon-col-head">
                  <div className="mon-filter" role="tablist">
                    <button
                      type="button"
                      className={listTab === "strategy" ? "is-on" : ""}
                      onClick={() => switchListTab("strategy")}
                    >
                      策略
                    </button>
                    <button
                      type="button"
                      className={listTab === "stock" ? "is-on" : ""}
                      onClick={() => switchListTab("stock")}
                    >
                      个股
                    </button>
                  </div>
                </div>
                <div className="mon-watch-list">
                  {listTab === "strategy" ? (
                    <>
                      <button type="button" className={`ide-row${selectedId === "all" ? " is-on" : ""}`} onClick={() => setSelectedId("all")}>
                        <div className="ide-row-top">
                          <span className="ide-row-name">全部</span>
                          <span className="mon-watch-count">{liveRows.reduce((n, item) => n + item.rows.length, 0)}</span>
                        </div>
                        <div className="mon-pool-meta">{liveRows.length} 个策略</div>
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
                    </>
                  ) : (
                    <>
                      <div className="mon-section">个股</div>
                      <div className="mon-add">
                        <div className="mon-add-field">
                          <input
                            className="mon-add-input"
                            value={picked ? `${picked.name} ${picked.symbol}` : query}
                            placeholder="代码 / 名称 / 拼音"
                            onChange={(event) => {
                              setPicked(null);
                              setQuery(event.target.value);
                            }}
                          />
                          {query.trim() && !picked && (search.data?.results.length ?? 0) > 0 ? (
                            <div className="mon-add-hits">
                              {search.data?.results.map((item) => (
                                <button
                                  key={item.symbol}
                                  type="button"
                                  onClick={() => {
                                    setPicked({ symbol: item.symbol, name: item.name });
                                    setQuery("");
                                  }}
                                >
                                  <span>{item.name}</span>
                                  <span className="mon-sym-code">{item.symbol}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="mon-add-label">理论</div>
                        <div className="mon-add-row mon-theory-row">
                          <select value={theory} onChange={(event) => setTheory(event.target.value)}>
                            {THEORY_OPTIONS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!canAdd || addStock.isPending}
                            onClick={() => addStock.mutate()}
                          >
                            添加
                          </button>
                        </div>
                        {addStock.error ? <div className="mon-add-err">{(addStock.error as Error).message}</div> : null}
                      </div>
                      <button
                        type="button"
                        className={`ide-row${selectedId === "stocks" ? " is-on" : ""}`}
                        onClick={() => setSelectedId("stocks")}
                      >
                        <div className="ide-row-top">
                          <span className="ide-row-name">全部</span>
                          <span className="mon-watch-count">{stockHits}</span>
                        </div>
                        <div className="mon-pool-meta">{stockWatches.length} 只</div>
                      </button>
                      {stockWatches.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`ide-row${selectedId === stockKey(item.id) ? " is-on" : ""}`}
                          onClick={() => {
                            setSelectedId(stockKey(item.id));
                            if (mobile) setPreview({ symbol: item.symbol, name: item.name });
                          }}
                        >
                          <div className="ide-row-top">
                            <span className="ide-row-name">{item.name}</span>
                            <span className="mon-watch-count">{item.hit ? "中" : "等"}</span>
                          </div>
                          <div className="mon-pool-meta">
                            {item.position || (item.hit && (item.signal_labels?.length ?? 0) > 0
                              ? item.signal_labels!.join(" ")
                              : item.signal_label || "缠论")}
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </aside>
              <section className="mon-board">
                <div className="mon-col-head">
                  <span>
                    {selected
                      ? selected.strategy.name
                      : selectedStock
                        ? `${selectedStock.name} ${selectedStock.position || selectedStock.signal_labels?.join(" ") || selectedStock.signal_label || "缠论"}`
                        : selectedId === "stocks"
                          ? "个股监控"
                          : "当前命中"}
                  </span>
                  <span className="mon-col-count">{boardRows.length} 只</span>
                  <div className="mon-pool-actions">
                    {selected ? (
                      <button type="button" className="btn-quiet" disabled={stopWatch.isPending} onClick={() => stopWatch.mutate(selected.strategy.id)}>
                        取消监控
                      </button>
                    ) : selectedStock ? (
                      <button type="button" className="btn-quiet" disabled={stopStock.isPending} onClick={() => stopStock.mutate(selectedStock.id)}>
                        取消监控
                      </button>
                    ) : null}
                    <button type="button" className={`btn-quiet${feedOpen ? " is-on" : ""}`} onClick={() => setFeedOpen((open) => !open)}>
                      日志
                    </button>
                  </div>
                </div>
                {emptyWatches ? (
                  <div className="mon-empty">
                    {listTab === "stock"
                      ? "还没有个股监控。搜索标的，选择理论后添加。命中买1/买2等会显示在列表和日志里。"
                      : "还没有策略监控。右侧从已有策略创建。"}
                  </div>
                ) : boardRows.length === 0 ? (
                  <div className="mon-empty">等待命中</div>
                ) : (
                  <div className="mon-board-body">
                    <table className="data-table mon-table">
                      <thead>
                        <tr>
                          <th>标的</th>
                          {showRuleCol ? <th>{listTab === "stock" ? "理论" : "策略"}</th> : null}
                          <th>信号</th>
                          <th className="text-right">现价</th>
                          <th className="text-right">涨跌</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boardRows.map((row) => {
                          const mark = flash[`${row.strategy.id}:${row.symbol}`] ?? flash[row.strategy.id];
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
                              {showRuleCol ? <td className="mon-sym-code">{row.strategy.name}</td> : null}
                              <td>
                                <div className="kline-tags mon-tags">
                                  {row.position ? <span className="mon-pos">{row.position}</span> : null}
                                  {row.signal_labels && row.signal_labels.length > 0
                                    ? row.signal_labels.map((label) => (
                                        <span key={label} className="kline-tag is-bull">
                                          出现{label}
                                        </span>
                                      ))
                                    : null}
                                  {tags.map((tag) => (
                                    <span key={tag.id} className={`kline-tag is-${tag.tone}`}>
                                      {tag.label}
                                    </span>
                                  ))}
                                  {!row.position && !row.signal_labels?.length && tags.length === 0 ? (
                                    <span className="mon-sym-code">—</span>
                                  ) : null}
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
        {mobile ? null : (
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
        )}
        {preview ? <StockKlineDialog symbol={preview.symbol} name={preview.name} onClose={() => setPreview(null)} /> : null}
      </div>
      </UniverseShell>
    </AiChatProvider>
  );
}
