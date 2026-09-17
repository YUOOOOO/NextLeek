import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  ResearchResult,
  Strategy,
  StrategyCondition,
  StrategyOptions,
  StrategyRunResult,
} from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { StrategyEditor } from "../components/StrategyEditor";

type Tab = "mine" | "subscribed" | "market";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "mine", label: "我的" },
  { id: "subscribed", label: "已订阅" },
  { id: "market", label: "市场" },
];

function fieldLabel(options: StrategyOptions | undefined, key: string) {
  return options?.fields.find((field) => field.key === key)?.label ?? key;
}

const OP_LABELS: Record<string, string> = {
  ">": "大于",
  ">=": "大于等于",
  "<": "小于",
  "<=": "小于等于",
  "==": "等于",
  "!=": "不等于",
  contains: "包含",
};

function conditionText(condition: StrategyCondition, options?: StrategyOptions) {
  const leftDays = condition.leftDays ? `前${condition.leftDays}日` : "";
  const left = `${leftDays}${fieldLabel(options, condition.left)}`;
  const op = OP_LABELS[condition.op] ?? condition.op;
  if (typeof condition.right === "string" && condition.right.startsWith("field:")) {
    const rightDays = condition.rightDays ? `前${condition.rightDays}日` : "";
    return `${left} ${op} ${rightDays}${fieldLabel(options, condition.right.slice(6))}`;
  }
  return `${left} ${op} ${String(condition.right)}`;
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fmtCell(key: string, value: unknown) {
  if (value == null || value === "") return "—";
  if (key === "change_pct" || key === "turnover_rate" || key.startsWith("momentum_")) {
    const x = num(value);
    if (x == null) return "—";
    const pct = Math.abs(x) <= 1 ? x * 100 : x;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  }
  if (key === "volume" || key === "amount") {
    const x = num(value);
    if (x == null) return "—";
    if (x >= 1e8) return `${(x / 1e8).toFixed(2)}亿`;
    if (x >= 1e4) return `${(x / 1e4).toFixed(0)}万`;
    return x.toLocaleString();
  }
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function pctClass(key: string, value: unknown) {
  if (key !== "change_pct") return "";
  const x = num(value);
  if (x == null || x === 0) return "pct-flat";
  return x > 0 ? "pct-up" : "pct-down";
}

const COLUMN_LABELS: Record<string, string> = {
  symbol: "代码",
  name: "名称",
  close: "收盘",
  change_pct: "涨跌幅",
  change_amount: "涨跌额",
  volume: "成交量",
  amount: "成交额",
  turnover_rate: "换手",
  ma5: "MA5",
  ma20: "MA20",
  rsi_14: "RSI14",
  consecutive_limit_ups: "连板",
};

export function Strategies() {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: queryKeys.strategies, queryFn: api.listStrategies });
  const options = useQuery({ queryKey: queryKeys.strategyOptions, queryFn: api.strategyOptions });
  const [tab, setTab] = useState<Tab>("mine");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StrategyRunResult | null>(null);
  const [research, setResearch] = useState<ResearchResult | null>(null);

  const items = catalog.data?.[tab] ?? [];
  const editing = useMemo(() => {
    if (!editingId || !catalog.data) return null;
    return catalog.data.mine.find((item) => item.id === editingId) ?? null;
  }, [catalog.data, editingId]);

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.strategies });
  }

  function openCreate() {
    setEditingId(null);
    setError("");
    setEditorOpen(true);
  }

  function openEdit(strategy: Strategy) {
    setEditingId(strategy.id);
    setError("");
    setEditorOpen(true);
  }

  const publish = useMutation({
    mutationFn: (id: string) => api.publishStrategy(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const unpublish = useMutation({
    mutationFn: (id: string) => api.unpublishStrategy(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteStrategy(id),
    onSuccess: async (_, id) => {
      if (selectedId === id) {
        setSelectedId(null);
        setResult(null);
      }
      await invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const subscribe = useMutation({
    mutationFn: (id: string) => api.subscribeStrategy(id),
    onSuccess: async (strategy) => {
      setSelectedId(strategy.id);
      setTab("subscribed");
      await invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const unsubscribe = useMutation({
    mutationFn: (id: string) => api.unsubscribeStrategy(id),
    onSuccess: async (_, id) => {
      if (selectedId === id) setResult(null);
      await invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const run = useMutation({
    mutationFn: (id: string) => api.runStrategy(id),
    onSuccess: (payload) => {
      setResult(payload);
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });
  const watch = useMutation({
    mutationFn: async (strategy: Strategy) => {
      if (strategy.monitoring) await api.stopStrategyMonitor(strategy.id);
      else await api.startStrategyMonitor(strategy.id);
    },
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const acceptUpdate = useMutation({
    mutationFn: (id: string) => api.updateStrategySubscription(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const runResearch = useMutation({
    mutationFn: (id: string) => api.researchStrategy(id),
    onSuccess: (payload) => {
      setResearch(payload);
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });
  const mine = useMutation({
    mutationFn: () => api.mineStrategies(),
    onSuccess: (payload) => {
      setResearch(payload);
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const columns = result?.rows[0] ? Object.keys(result.rows[0]) : [];
  const busy =
    run.isPending || publish.isPending || subscribe.isPending || watch.isPending || acceptUpdate.isPending;

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">策略</h1>
          <p className="page-desc">公式即策略。写 close &gt; ts_mean(close, 120) 就是站上均线。发布后别人可订阅。</p>
        </div>
        <div className="sort-row">
          <button type="button" className="btn btn-ghost" onClick={() => mine.mutate()} disabled={mine.isPending}>
            {mine.isPending ? "挖掘中…" : "挖掘"}
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            新建策略
          </button>
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      {editorOpen && (
        <StrategyEditor
          strategy={editing}
          options={options.data}
          onClose={() => setEditorOpen(false)}
          onSaved={async (strategy) => {
            setEditorOpen(false);
            setSelectedId(strategy.id);
            setTab("mine");
            await invalidate();
          }}
        />
      )}

      <nav className="settings-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-tab${tab === item.id ? " is-active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {catalog.data ? ` ${catalog.data[item.id].length}` : ""}
          </button>
        ))}
      </nav>


      {catalog.isLoading && <div className="text-sm text-[var(--ds-color-text-placeholder)]">加载中…</div>}
      {!catalog.isLoading && items.length === 0 && (
        <div className="card p-6 text-sm text-[var(--ds-color-text-placeholder)]">
          {tab === "mine" && "还没有策略。点右上角新建，写布尔公式选股。"}
          {tab === "subscribed" && "还没有订阅。到市场里订阅他人发布的策略。"}
          {tab === "market" && "暂无已发布策略。"}
        </div>
      )}

      {items.length > 0 && (
        <div className="strat-grid">
          {items.map((strategy) => {
            const active = selectedId === strategy.id;
            return (
            <div
              key={strategy.id}
              className={`strat-card${active ? " is-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelectedId(strategy.id);
                if (selectedId !== strategy.id) {
                  setResult(null);
                  setResearch(null);
                }
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedId(strategy.id);
                }
              }}
            >
              <div className="strat-card-top">
                <span className="strat-card-name">{strategy.name}</span>
                <span className={`badge ${strategy.status === "published" ? "badge-on" : "badge-off"}`}>
                  {strategy.status === "published" ? "已发布" : "草稿"}
                </span>
                {strategy.has_unpublished_changes && tab === "mine" && (
                  <span className="badge badge-off">未发布改动</span>
                )}
                {strategy.update_available && tab === "subscribed" && (
                  <span className="badge badge-on">有更新</span>
                )}
              </div>
              <div className="strat-meta">
                {strategy.is_owner ? "我" : strategy.owner_username} · 订阅 {strategy.subscriber_count}
                {strategy.monitoring ? " · 监控中" : ""}
                {strategy.kind === "composite" ? " · 叠加" : strategy.kind === "formula" ? " · 公式" : ""}
              </div>
              <div className="strat-conds">
                {strategy.kind === "composite" ? (
                  <div>
                    {strategy.merge_mode === "intersect" ? "交集" : "并集"} ·{" "}
                    {(strategy.children ?? []).map((child) => child.name || child.strategy_id).join(" + ") || "未选子策略"}
                  </div>
                ) : strategy.kind === "formula" ? (
                  <div>{strategy.formula}</div>
                ) : (
                  <>
                    {strategy.conditions.slice(0, active ? 8 : 3).map((condition, index) => (
                      <div key={index}>{conditionText(condition, options.data)}</div>
                    ))}
                    {!active && strategy.conditions.length > 3 && <div>…共 {strategy.conditions.length} 条</div>}
                  </>
                )}
              </div>
              {active && (
                <div className="strat-card-actions" onClick={(event) => event.stopPropagation()}>
                  {tab === "market" && strategy.is_owner && (
                    <button type="button" className="btn btn-ghost" onClick={() => unpublish.mutate(strategy.id)}>
                      撤回
                    </button>
                  )}
                  {tab === "market" && !strategy.is_owner && !strategy.subscribed && (
                    <button type="button" className="btn btn-primary" onClick={() => subscribe.mutate(strategy.id)}>
                      订阅
                    </button>
                  )}
                  {tab === "market" && !strategy.is_owner && strategy.subscribed && (
                    <button type="button" className="btn btn-ghost" onClick={() => unsubscribe.mutate(strategy.id)}>
                      取消订阅
                    </button>
                  )}
                  {tab !== "market" && (strategy.is_owner || strategy.subscribed) && (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run.mutate(strategy.id)}>
                        {run.isPending ? "扫描中…" : "运行"}
                      </button>
                      <button
                        type="button"
                        className={strategy.monitoring ? "btn btn-ghost" : "btn btn-primary"}
                        disabled={watch.isPending}
                        onClick={() => watch.mutate(strategy)}
                      >
                        {strategy.monitoring ? "取消监控" : "监控"}
                      </button>
                      {strategy.kind === "formula" && (
                        <button type="button" className="btn btn-ghost" disabled={runResearch.isPending} onClick={() => runResearch.mutate(strategy.id)}>
                          {runResearch.isPending ? "回测中…" : "回测"}
                        </button>
                      )}
                    </>
                  )}
                  {tab === "subscribed" && strategy.update_available && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={acceptUpdate.isPending}
                      onClick={() => acceptUpdate.mutate(strategy.id)}
                    >
                      {acceptUpdate.isPending ? "更新中…" : "更新"}
                    </button>
                  )}
                  {tab === "mine" && strategy.is_owner && (
                    <>
                      <button type="button" className="btn btn-ghost" onClick={() => openEdit(strategy)}>
                        编辑
                      </button>
                      {strategy.status === "published" && strategy.has_unpublished_changes && (
                        <button type="button" className="btn btn-ghost" onClick={() => publish.mutate(strategy.id)}>
                          发布更新
                        </button>
                      )}
                      {strategy.status === "published" ? (
                        <button type="button" className="btn btn-ghost" onClick={() => unpublish.mutate(strategy.id)}>
                          撤回
                        </button>
                      ) : (
                        <button type="button" className="btn btn-ghost" onClick={() => publish.mutate(strategy.id)}>
                          发布
                        </button>
                      )}
                      <button type="button" className="btn btn-danger" onClick={() => remove.mutate(strategy.id)}>
                        删除
                      </button>
                    </>
                  )}
                  {tab === "subscribed" && (
                    <button type="button" className="btn btn-ghost" onClick={() => unsubscribe.mutate(strategy.id)}>
                      取消订阅
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
      {result && result.strategy_id === selectedId && (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span>
              {result.as_of ?? "无日期"} · {result.total} 只 · {result.elapsed_ms} ms
            </span>
          </div>
          {result.warnings.map((warning) => (
            <div key={warning} className="err mx-4 mb-3">
              {warning}
            </div>
          ))}
          {result.rows.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-[var(--ds-color-text-placeholder)]">无命中。检查条件或先同步数据。</div>
          ) : (
            <div className="overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column}>{COLUMN_LABELS[column] ?? column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={String(row.symbol ?? index)}>
                      {columns.map((column) => (
                        <td key={column} className={pctClass(column, row[column])}>
                          {fmtCell(column, row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {research && (
        <section className="card p-4 text-sm">
          <div className="builder-section-head">回测 / 挖掘</div>
          {research.warning && <div className="muted">{research.warning}</div>}
          {research.ok && research.avg_return != null && (
            <div className="muted">
              平均收益 {research.avg_return} · 胜率 {research.hit_rate} · 日均命中 {research.avg_names}
            </div>
          )}
          {research.items && research.items.length > 0 && (
            <div className="cond-list">
              {research.items.map((item, index) => (
                <div key={index} className="preview-line">
                  {String(item.name || item.formula)} · {String(item.avg_return ?? item.ic ?? "")}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

    </div>
  );
}

