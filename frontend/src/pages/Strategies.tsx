import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, Rss, Store } from "lucide-react";
import {
  api,
  ResearchResult,
  Strategy,
  StrategyBasicFilter,
  StrategyCondition,
  StrategyOptions,
  StrategyRunResult,
} from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { StrategyEditor } from "../components/StrategyEditor";

type Tab = "mine" | "subscribed" | "market";

type ChatMsg = { role: "user" | "bot"; text: string; formula?: string };

const TABS: Array<{ id: Tab; label: string; icon: typeof Folder }> = [
  { id: "mine", label: "我的", icon: Folder },
  { id: "subscribed", label: "已订阅", icon: Rss },
  { id: "market", label: "市场", icon: Store },
];

const DEFAULT_FILTER: StrategyBasicFilter = {
  price_min: 3,
  price_max: 300,
  market_cap_min: 10e8,
  amount_min: 0.2e8,
  exclude_st: true,
  boards: ["沪主板", "深主板", "创业板", "科创板", "北交所"],
};

const DEFAULT_FORMULA = "close > ts_mean(close, 120) and volume > ts_mean(volume, 20)";

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
  const [creating, setCreating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formula, setFormula] = useState(DEFAULT_FORMULA);
  const [result, setResult] = useState<StrategyRunResult | null>(null);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: "bot", text: "用中文描述选股条件。生成的是 DSL 公式，不是完整 Python。点「应用」写入左侧编辑器。" },
  ]);

  const items = catalog.data?.[tab] ?? [];
  const selected = useMemo(() => {
    if (creating || !selectedId || !catalog.data) return null;
    return items.find((item) => item.id === selectedId) ?? null;
  }, [catalog.data, creating, items, selectedId]);

  const formulaEditable = creating || (selected?.is_owner === true && selected.kind === "formula" && tab === "mine");
  const editorValue = creating || formulaEditable || selected?.kind === "formula" ? formula : sourceText(selected, options.data);

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: queryKeys.strategies });
  }

  function openCreate() {
    setCreating(true);
    setSelectedId(null);
    setName("");
    setDescription("");
    setFormula(DEFAULT_FORMULA);
    setResult(null);
    setResearch(null);
    setError("");
    setTab("mine");
  }

  function selectRow(strategy: Strategy) {
    setCreating(false);
    setSelectedId(strategy.id);
    setName(strategy.name);
    setDescription(strategy.description);
    setFormula(strategy.formula || DEFAULT_FORMULA);
    setResult(null);
    setResearch(null);
    setError("");
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
        setCreating(false);
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
    onSuccess: async () => {
      setResult(null);
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
  const compile = useMutation({
    mutationFn: () => api.compileStrategy(formula),
    onError: (err: Error) => setError(err.message),
  });
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        kind: "formula" as const,
        formula,
        conditions: [] as StrategyCondition[],
        children: [],
        merge_mode: "union" as const,
        basic_filter: selected?.basic_filter ?? DEFAULT_FILTER,
        order_by: selected?.order_by ?? "change_pct",
        descending: selected?.descending ?? true,
        limit: selected?.limit ?? 100,
      };
      return creating || !selected ? api.createStrategy(payload) : api.updateStrategy(selected.id, payload);
    },
    onSuccess: async (strategy) => {
      setCreating(false);
      setSelectedId(strategy.id);
      setTab("mine");
      await invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const generate = useMutation({
    mutationFn: () => api.generateStrategy(prompt.trim()),
    onSuccess: (payload) => {
      setChat((prev) => [
        ...prev,
        {
          role: "bot",
          text: `${payload.name}\n${payload.description || ""}\n${payload.formula}`.trim(),
          formula: payload.formula,
        },
      ]);
      setPrompt("");
    },
    onError: (err: Error) => {
      setChat((prev) => [...prev, { role: "bot", text: err.message }]);
    },
  });

  const columns = result?.rows[0] ? Object.keys(result.rows[0]) : [];
  const busy = run.isPending || publish.isPending || subscribe.isPending || watch.isPending || acceptUpdate.isPending || save.isPending;

  function onAsk(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || generate.isPending) return;
    setChat((prev) => [...prev, { role: "user", text }]);
    generate.mutate();
  }

  function applyFormula(next: string) {
    setFormula(next);
    setError("");
  }

  return (
    <div className="ide">
      <nav className="ide-activity" aria-label="策略目录">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ide-act${tab === item.id ? " is-on" : ""}`}
            onClick={() => {
              setTab(item.id);
              setCreating(false);
            }}
          >
            <item.icon size={18} />
            {item.label}
            <span className="ide-act-count">{catalog.data ? catalog.data[item.id].length : ""}</span>
          </button>
        ))}
      </nav>

      <aside className="ide-list">
        <div className="ide-list-head">
          <span>{TABS.find((item) => item.id === tab)?.label}</span>
          {tab === "mine" && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              新建
            </button>
          )}
        </div>
        <div className="ide-list-body">
          {catalog.isLoading && <div className="ide-empty">加载中…</div>}
          {!catalog.isLoading && items.length === 0 && (
            <div className="ide-empty">
              {tab === "mine" && "还没有策略。点新建写公式。"}
              {tab === "subscribed" && "还没有订阅。"}
              {tab === "market" && "暂无已发布策略。"}
            </div>
          )}
          {items.map((strategy) => (
            <button
              key={strategy.id}
              type="button"
              className={`ide-row${selectedId === strategy.id && !creating ? " is-on" : ""}`}
              onClick={() => selectRow(strategy)}
            >
              <div className="ide-row-top">
                <span className="ide-row-name">{strategy.name}</span>
                <span className={`badge ${strategy.status === "published" ? "badge-on" : "badge-off"}`}>
                  {strategy.status === "published" ? "已发布" : "草稿"}
                </span>
              </div>
              <div className="strat-meta">
                {strategy.is_owner ? "我" : strategy.owner_username}
                {strategy.monitoring ? " · 监控中" : ""}
                {strategy.kind === "formula" ? " · 公式" : strategy.kind === "composite" ? " · 叠加" : ""}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="ide-editor">
        {!creating && !selected ? (
          <div className="ide-empty">从左侧打开策略，或新建一条公式策略。</div>
        ) : (
          <>
            <div className="ide-editor-head">
              <input
                className="ide-name"
                value={name}
                maxLength={40}
                disabled={!formulaEditable}
                placeholder="策略名称"
                onChange={(event) => setName(event.target.value)}
              />
              {selected && tab !== "market" && (selected.is_owner || selected.subscribed) && (
                <>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run.mutate(selected.id)}>
                    {run.isPending ? "扫描中…" : "运行"}
                  </button>
                  <button
                    type="button"
                    className={selected.monitoring ? "btn btn-ghost" : "btn btn-primary"}
                    disabled={watch.isPending}
                    onClick={() => watch.mutate(selected)}
                  >
                    {selected.monitoring ? "取消监控" : "监控"}
                  </button>
                  {selected.kind === "formula" && (
                    <button type="button" className="btn btn-ghost" disabled={runResearch.isPending} onClick={() => runResearch.mutate(selected.id)}>
                      {runResearch.isPending ? "回测中…" : "回测"}
                    </button>
                  )}
                </>
              )}
              {tab === "market" && selected && selected.is_owner && (
                <button type="button" className="btn btn-ghost" onClick={() => unpublish.mutate(selected.id)}>
                  撤回
                </button>
              )}
              {tab === "market" && selected && !selected.is_owner && !selected.subscribed && (
                <button type="button" className="btn btn-primary" onClick={() => subscribe.mutate(selected.id)}>
                  订阅
                </button>
              )}
              {tab === "market" && selected && !selected.is_owner && selected.subscribed && (
                <button type="button" className="btn btn-ghost" onClick={() => unsubscribe.mutate(selected.id)}>
                  取消订阅
                </button>
              )}
              {tab === "subscribed" && selected?.update_available && (
                <button type="button" className="btn btn-primary" disabled={acceptUpdate.isPending} onClick={() => acceptUpdate.mutate(selected.id)}>
                  更新
                </button>
              )}
              {tab === "subscribed" && selected && (
                <button type="button" className="btn btn-ghost" onClick={() => unsubscribe.mutate(selected.id)}>
                  取消订阅
                </button>
              )}
              {tab === "mine" && selected?.is_owner && selected.kind !== "formula" && (
                <button type="button" className="btn btn-ghost" onClick={() => setEditorOpen(true)}>
                  高级编辑
                </button>
              )}
              {tab === "mine" && selected?.is_owner && selected.status === "published" && (
                <button type="button" className="btn btn-ghost" onClick={() => unpublish.mutate(selected.id)}>
                  撤回
                </button>
              )}
              {tab === "mine" && selected?.is_owner && selected.status !== "published" && (
                <button type="button" className="btn btn-ghost" onClick={() => publish.mutate(selected.id)}>
                  发布
                </button>
              )}
              {tab === "mine" && selected?.is_owner && selected.status === "published" && selected.has_unpublished_changes && (
                <button type="button" className="btn btn-ghost" onClick={() => publish.mutate(selected.id)}>
                  发布更新
                </button>
              )}
              {tab === "mine" && selected?.is_owner && (
                <button type="button" className="btn btn-danger" onClick={() => remove.mutate(selected.id)}>
                  删除
                </button>
              )}
            </div>
            <textarea
              className="ide-code"
              value={editorValue}
              spellCheck={false}
              disabled={!formulaEditable}
              placeholder={DEFAULT_FORMULA}
              onChange={(event) => setFormula(event.target.value)}
            />
            {formulaEditable && (
              <div className="ide-editor-foot">
                <button type="button" className="btn btn-ghost" disabled={!formula.trim() || compile.isPending} onClick={() => compile.mutate()}>
                  {compile.isPending ? "校验中…" : "校验"}
                </button>
                {compile.data && (
                  <span className={compile.data.ok ? "muted" : "err"}>
                    {compile.data.ok
                      ? `通过 · 暖机 ${compile.data.warmup_bars} 日`
                      : compile.data.errors[0]?.message || "公式无效"}
                  </span>
                )}
                <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !formula.trim()} onClick={() => save.mutate()}>
                  {save.isPending ? "保存中…" : "保存"}
                </button>
                {error && <span className="err">{error}</span>}
              </div>
            )}
            {error && !formulaEditable && <div className="err" style={{ padding: "8px 10px" }}>{error}</div>}
            {result && selected && result.strategy_id === selected.id && (
              <div className="ide-result">
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>
                    {result.as_of ?? "无日期"} · {result.total} 只 · {result.elapsed_ms} ms
                  </span>
                </div>
                {result.rows.length === 0 ? (
                  <div className="px-4 pb-3 text-sm text-[var(--ds-color-text-placeholder)]">无命中。</div>
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
              </div>
            )}
            {research && (
              <div className="ide-result" style={{ maxHeight: "18%" }}>
                <div className="px-4 py-2 text-sm muted">
                  {research.warning ||
                    (research.ok
                      ? `平均收益 ${research.avg_return} · 胜率 ${research.hit_rate} · 日均命中 ${research.avg_names}`
                      : "回测无结果")}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <aside className="ide-ai">
        <div className="ide-ai-head">AI · 生成公式</div>
        <div className="ide-ai-log">
          {chat.map((msg, index) => (
            <div key={index} className={`ide-msg ${msg.role}`}>
              {msg.text}
              {msg.formula && formulaEditable && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-primary" onClick={() => applyFormula(msg.formula!)}>
                    应用
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <form className="ide-ai-form" onSubmit={onAsk}>
          <textarea value={prompt} placeholder="例如 站上120日均线且放量" onChange={(event) => setPrompt(event.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!prompt.trim() || generate.isPending}>
            {generate.isPending ? "…" : "发送"}
          </button>
        </form>
      </aside>

      {editorOpen && selected && (
        <StrategyEditor
          strategy={selected}
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
    </div>
  );
}

function sourceText(strategy: Strategy | null, options?: StrategyOptions) {
  if (!strategy) return "";
  if (strategy.kind === "formula") return strategy.formula || "";
  if (strategy.kind === "composite") {
    const mode = strategy.merge_mode === "intersect" ? "交集" : "并集";
    const kids = (strategy.children ?? []).map((child) => child.name || child.strategy_id).join(" + ");
    return `${mode}\n${kids || "未选子策略"}`;
  }
  return strategy.conditions.map((condition) => conditionText(condition, options)).join("\n");
}
