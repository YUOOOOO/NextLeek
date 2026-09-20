import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, LineChart, Sparkles } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  api,
  Factor,
  ResearchResult,
  Strategy,
  StrategyBasicFilter,
  StrategyCondition,
  StrategyOptions,
  StrategyRunResult,
} from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

type Tab = "mine" | "subscribed" | "market";
type Workspace = "strategy" | "factor" | "condition";
type ChatMsg = { role: "user" | "bot"; text: string; formula?: string; pending?: boolean };
type SidePane = "ai" | "research" | "docs";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "mine", label: "我的" },
  { id: "subscribed", label: "已订阅" },
  { id: "market", label: "市场" },
];

const WORKSPACES: Array<{ id: Workspace; label: string }> = [
  { id: "strategy", label: "策略" },
  { id: "factor", label: "因子" },
  { id: "condition", label: "条件" },
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
const DEFAULT_FACTOR_FORMULA = "ts_mean(close, 120)";
const EMPTY_CONDITION: StrategyCondition = {
  left: "change_pct",
  op: ">",
  right: 0.05,
  leftDays: 0,
  rightDays: 0,
};

const CHAT_INTRO: Record<Workspace, string> = {
  strategy: "用中文描述选股条件。生成的是 DSL 公式，不是完整 Python。点「应用」写入左侧编辑器。",
  factor: "用中文描述指标。生成的是 DSL 公式，比如 ts_mean(close, 120)。点「应用」写入左侧编辑器。",
  condition: "条件策略用字段比较，不写公式。左侧加条件后保存。",
};

const DSL_DOCS = `DSL 公式

策略必须是布尔表达式，例如:
close > ts_mean(close, 120) and volume > ts_mean(volume, 20)

因子必须是数值表达式，例如:
ts_mean(close, 120)
close / ts_mean(close, 120) - 1

基准列: open high low close volume amount turnover_rate prev_close
比较: > >= < <= == !=
逻辑: and or
窗口 n 必须是 2–512 的数字字面量。涨跌幅用小数，5% 写成 0.05。

常用算子:
ts_mean ts_std ts_sum ts_max ts_min ts_delay ts_delta
ts_rank ts_zscore ts_corr ts_cov decay_linear
rank zscore winsorize if_else min max log abs sign sqrt power clamp`;

const AI_SKILL = `AI 用法

用中文描述选股/因子逻辑，点发送。AI 只生成 DSL 公式，不是 Python。

好的描述:
- 收盘站上120日均线，并且成交量大于20日均量
- 20日涨幅超过10%，但不要用涨停板计数

生成后点「应用」写入左侧编辑器，再校验、保存，才能运行/发布/回测。

未配置 AI 时会提示去设置页填写接口。推理模型可能要等几十秒，对话里会显示「生成中」。`;

function parseWorkspace(value: string | null): Workspace {
  if (value === "factor" || value === "condition") return value;
  return "strategy";
}

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
  if (typeof value === "boolean") return value ? "是" : "否";
  const n = num(value);
  if (n == null) return String(value);
  if (key.endsWith("_pct") || key.includes("rate") || key.includes("return")) return `${(n * (Math.abs(n) <= 1 ? 100 : 1)).toFixed(2)}%`;
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function pctClass(key: string, value: unknown) {
  const n = num(value);
  if (n == null || !(key.endsWith("_pct") || key.includes("change"))) return "";
  return n > 0 ? "pos" : n < 0 ? "neg" : "";
}

const COLUMN_LABELS: Record<string, string> = {
  symbol: "代码",
  name: "名称",
  close: "收盘",
  change_pct: "涨跌幅",
  amount: "成交额",
  volume: "成交量",
};

function filterStrategies(items: Strategy[], workspace: Workspace) {
  if (workspace === "condition") return items.filter((item) => item.kind === "conditions");
  return items.filter((item) => item.kind !== "conditions");
}

function parseRight(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed === "") return raw;
  if (trimmed.startsWith("field:")) return trimmed;
  const n = Number(trimmed);
  return Number.isFinite(n) && trimmed !== "" ? n : raw;
}

function sameConditions(left: StrategyCondition[], right: StrategyCondition[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return (
      item.left === other.left &&
      item.op === other.op &&
      String(item.right) === String(other.right) &&
      (item.leftDays ?? 0) === (other.leftDays ?? 0) &&
      (item.rightDays ?? 0) === (other.rightDays ?? 0)
    );
  });
}

export function Strategies() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const workspace = parseWorkspace(params.get("ws"));
  const catalog = useQuery({ queryKey: queryKeys.strategies, queryFn: api.listStrategies });
  const factorCatalog = useQuery({ queryKey: queryKeys.factors, queryFn: api.listFactors });
  const options = useQuery({ queryKey: queryKeys.strategyOptions, queryFn: api.strategyOptions });
  const [tab, setTab] = useState<Tab>("mine");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sidePane, setSidePane] = useState<SidePane | null>(() =>
    localStorage.getItem("nextleek_ai_open") === "0" ? null : "ai",
  );
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formula, setFormula] = useState(workspace === "factor" ? DEFAULT_FACTOR_FORMULA : DEFAULT_FORMULA);
  const [conditions, setConditions] = useState<StrategyCondition[]>([{ ...EMPTY_CONDITION }]);
  const [direction, setDirection] = useState<"high" | "low" | "none">("none");
  const [result, setResult] = useState<StrategyRunResult | null>(null);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([{ role: "bot", text: CHAT_INTRO[workspace] }]);
  const [verifiedFormula, setVerifiedFormula] = useState<string | null>(null);

  const strategyItems = filterStrategies(catalog.data?.[tab] ?? [], workspace);
  const factorItems = factorCatalog.data?.[tab] ?? [];
  const selectedStrategy = useMemo(() => {
    if (workspace === "factor" || creating || !selectedId || !catalog.data) return null;
    return strategyItems.find((item) => item.id === selectedId) ?? null;
  }, [catalog.data, creating, selectedId, strategyItems, workspace]);
  const selectedFactor = useMemo(() => {
    if (workspace !== "factor" || creating || !selectedId || !factorCatalog.data) return null;
    return factorItems.find((item) => item.id === selectedId) ?? null;
  }, [creating, factorCatalog.data, factorItems, selectedId, workspace]);

  const formulaEditable =
    creating ||
    (tab === "mine" &&
      ((workspace === "factor" && selectedFactor?.is_owner === true) ||
        (workspace === "strategy" && selectedStrategy?.is_owner === true && selectedStrategy.kind === "formula") ||
        (workspace === "condition" && selectedStrategy?.is_owner === true && selectedStrategy.kind === "conditions")));
  const editorValue = creating || formulaEditable
    ? formula
    : workspace === "factor"
      ? selectedFactor?.formula || ""
      : selectedStrategy?.kind === "formula"
        ? selectedStrategy.formula || ""
        : sourceText(selectedStrategy, options.data);

  const loading = workspace === "factor" ? factorCatalog.isLoading : catalog.isLoading;
  const loadError = workspace === "factor" ? factorCatalog.error : catalog.error;
  const itemsEmpty = workspace === "factor" ? factorItems.length === 0 : strategyItems.length === 0;

  function setWorkspace(next: Workspace) {
    const nextParams = new URLSearchParams(params);
    if (next === "strategy") nextParams.delete("ws");
    else nextParams.set("ws", next);
    setParams(nextParams, { replace: true });
    setCreating(false);
    setSelectedId(null);
    setName("");
    setDescription("");
    setFormula(next === "factor" ? DEFAULT_FACTOR_FORMULA : DEFAULT_FORMULA);
    setConditions([{ ...EMPTY_CONDITION }]);
    setDirection("none");
    setResult(null);
    setResearch(null);
    setError("");
    setPrompt("");
    setChat([{ role: "bot", text: CHAT_INTRO[next] }]);
    setVerifiedFormula(null);
  }

  function invalidate() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.strategies }),
      queryClient.invalidateQueries({ queryKey: queryKeys.factors }),
    ]);
  }

  function openCreate() {
    setCreating(true);
    setSelectedId(null);
    setName("");
    setDescription("");
    setFormula(workspace === "factor" ? DEFAULT_FACTOR_FORMULA : DEFAULT_FORMULA);
    setConditions([{ ...EMPTY_CONDITION }]);
    setDirection("none");
    setResult(null);
    setResearch(null);
    setError("");
    setTab("mine");
    setVerifiedFormula(null);
  }

  function selectStrategy(strategy: Strategy) {
    setCreating(false);
    setSelectedId(strategy.id);
    setName(strategy.name);
    setDescription(strategy.description);
    setFormula(strategy.formula || "");
    setConditions(strategy.conditions.length ? strategy.conditions : [{ ...EMPTY_CONDITION }]);
    setResult(null);
    setResearch(null);
    setError("");
    setVerifiedFormula(null);
  }

  function selectFactor(factor: Factor) {
    setCreating(false);
    setSelectedId(factor.id);
    setName(factor.name);
    setDescription(factor.description);
    setFormula(factor.formula || "");
    setDirection(factor.direction);
    setResult(null);
    setResearch(null);
    setError("");
    setVerifiedFormula(null);
  }

  const publish = useMutation({
    mutationFn: (id: string): Promise<Strategy | Factor> => (workspace === "factor" ? api.publishFactor(id) : api.publishStrategy(id)),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const unpublish = useMutation({
    mutationFn: (id: string): Promise<Strategy | Factor> => (workspace === "factor" ? api.unpublishFactor(id) : api.unpublishStrategy(id)),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => (workspace === "factor" ? api.deleteFactor(id) : api.deleteStrategy(id)),
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
    mutationFn: (id: string): Promise<Strategy | Factor> => (workspace === "factor" ? api.subscribeFactor(id) : api.subscribeStrategy(id)),
    onSuccess: async (item) => {
      setSelectedId(item.id);
      setTab("subscribed");
      await invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const unsubscribe = useMutation({
    mutationFn: (id: string) => (workspace === "factor" ? api.unsubscribeFactor(id) : api.unsubscribeStrategy(id)),
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
    mutationFn: (id: string): Promise<Strategy | Factor> =>
      workspace === "factor" ? api.updateFactorSubscription(id) : api.updateStrategySubscription(id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });
  const runResearch = useMutation({
    mutationFn: (id: string) => (workspace === "factor" ? api.researchFactor(id) : api.researchStrategy(id)),
    onSuccess: (payload) => {
      setResearch(payload);
      setError("");
      setSidePane("research");
    },
    onError: (err: Error) => setError(err.message),
  });
  const compile = useMutation({
    mutationFn: () => (workspace === "factor" ? api.compileFactor(formula) : api.compileStrategy(formula)),
    onSuccess: (preview) => {
      setVerifiedFormula(preview.ok ? formula : null);
      setError(preview.ok ? "" : preview.errors[0]?.message || "公式无效");
    },
    onError: (err: Error) => {
      setVerifiedFormula(null);
      setError(err.message);
    },
  });
  const save = useMutation({
    mutationFn: (): Promise<Strategy | Factor> => {
      if (workspace === "factor") {
        const payload = {
          name: name.trim(),
          description: description.trim(),
          formula,
          direction,
        };
        return creating || !selectedFactor ? api.createFactor(payload) : api.updateFactor(selectedFactor.id, payload);
      }
      const payload = {
        name: name.trim(),
        description: description.trim(),
        kind: (workspace === "condition" ? "conditions" : "formula") as "formula" | "conditions",
        formula: workspace === "condition" ? "" : formula,
        conditions: workspace === "condition" ? conditions : ([] as StrategyCondition[]),
        basic_filter: selectedStrategy?.basic_filter ?? DEFAULT_FILTER,
        order_by: selectedStrategy?.order_by ?? "change_pct",
        descending: selectedStrategy?.descending ?? true,
        limit: selectedStrategy?.limit ?? 100,
      };
      return creating || !selectedStrategy ? api.createStrategy(payload) : api.updateStrategy(selectedStrategy.id, payload);
    },
    onSuccess: async (item) => {
      setCreating(false);
      setSelectedId(item.id);
      setTab("mine");
      await invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const generate = useMutation({
    mutationFn: (text: string) => (workspace === "factor" ? api.generateFactor(text) : api.generateStrategy(text)),
    onSuccess: (payload) => {
      setChat((prev) => [
        ...prev.filter((msg) => !msg.pending),
        {
          role: "bot",
          text: `${payload.name}\n${payload.description || ""}\n${payload.formula}`.trim(),
          formula: payload.formula,
        },
      ]);
    },
    onError: (err: Error) => {
      setChat((prev) => [...prev.filter((msg) => !msg.pending), { role: "bot", text: err.message }]);
    },
  });

  const columns = result?.rows[0] ? Object.keys(result.rows[0]) : [];
  const busy =
    run.isPending || publish.isPending || subscribe.isPending || watch.isPending || acceptUpdate.isPending || save.isPending;
  const selected = workspace === "factor" ? selectedFactor : selectedStrategy;
  const noun = workspace === "factor" ? "因子" : workspace === "condition" ? "条件" : "策略";

  function togglePane(pane: SidePane) {
    setSidePane((prev) => {
      const next = prev === pane ? null : pane;
      localStorage.setItem("nextleek_ai_open", next === "ai" ? "1" : "0");
      return next;
    });
  }

  function onAsk(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || generate.isPending) return;
    setPrompt("");
    setSidePane("ai");
    setChat((prev) => [...prev, { role: "user", text }, { role: "bot", text: "正在生成公式…", pending: true }]);
    generate.mutate(text);
  }

  function applyFormula(next: string) {
    setFormula(next);
    setVerifiedFormula((prev) => (prev === next ? prev : null));
    setError("");
  }

  function updateCondition(index: number, patch: Partial<StrategyCondition>) {
    setConditions((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function tabCount(id: Tab) {
    if (workspace === "factor") return factorCatalog.data?.[id].length ?? 0;
    return filterStrategies(catalog.data?.[id] ?? [], workspace).length;
  }

  const dirty = Boolean(
    formulaEditable &&
      (creating ||
        (workspace === "factor"
          ? !selectedFactor ||
            name.trim() !== selectedFactor.name ||
            description.trim() !== selectedFactor.description ||
            formula !== selectedFactor.formula ||
            direction !== selectedFactor.direction
          : !selectedStrategy ||
            name.trim() !== selectedStrategy.name ||
            description.trim() !== selectedStrategy.description ||
            (workspace === "condition"
              ? !sameConditions(conditions, selectedStrategy.conditions)
              : formula !== (selectedStrategy.formula || "")))),
  );
  const compiledOk = workspace === "condition" || verifiedFormula === formula;
  const canOperate = Boolean(selected) && !creating && !dirty;
  const blockedReason = creating || !selected ? "请先保存" : dirty ? "请先保存当前修改" : "";
  const saveDisabled =
    busy ||
    compile.isPending ||
    !name.trim() ||
    (workspace === "condition" ? conditions.length === 0 : !formula.trim() || !compiledOk);

  return (
    <div className="ide">
      <aside className="ide-list">
        <div className="ide-ws-tabs" role="tablist" aria-label="工作区">
          {WORKSPACES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={workspace === item.id}
              className={`ide-ws-tab${workspace === item.id ? " is-on" : ""}`}
              onClick={() => setWorkspace(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ide-list-tabs" role="tablist" aria-label={`${noun}目录`}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`ide-tab${tab === item.id ? " is-on" : ""}`}
              onClick={() => {
                setTab(item.id);
                setCreating(false);
              }}
            >
              {item.label}
              {(workspace === "factor" ? factorCatalog.data : catalog.data) ? (
                <span className="ide-tab-count">{tabCount(item.id)}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="ide-list-create">
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            新建
          </button>
        </div>
        <div className="ide-list-body">
          {loading && <div className="ide-empty">加载中…</div>}
          {!loading && loadError && (
            <div className="ide-empty">加载失败：{(loadError as Error).message || "请重试"}</div>
          )}
          {!loading && !loadError && itemsEmpty && (
            <div className="ide-empty">
              {tab === "mine" && `还没有${noun}。点新建。`}
              {tab === "subscribed" && "还没有订阅。"}
              {tab === "market" && `暂无已发布${noun}。`}
            </div>
          )}
          {workspace === "factor"
            ? factorItems.map((factor) => (
                <button
                  key={factor.id}
                  type="button"
                  className={`ide-row${selectedId === factor.id && !creating ? " is-on" : ""}`}
                  onClick={() => selectFactor(factor)}
                >
                  <div className="ide-row-top">
                    <span className="ide-row-name">{factor.name}</span>
                    <span className={`badge ${factor.status === "published" ? "badge-on" : "badge-off"}`}>
                      {factor.status === "published" ? "已发布" : "草稿"}
                    </span>
                  </div>
                  <div className="strat-meta">
                    {factor.code} · {factor.is_owner ? "我" : factor.owner_username}
                  </div>
                </button>
              ))
            : strategyItems.map((strategy) => (
                <button
                  key={strategy.id}
                  type="button"
                  className={`ide-row${selectedId === strategy.id && !creating ? " is-on" : ""}`}
                  onClick={() => selectStrategy(strategy)}
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
                    {strategy.kind === "formula" ? " · 公式" : strategy.kind === "composite" ? " · 叠加" : " · 条件"}
                  </div>
                </button>
              ))}
        </div>
      </aside>

      <section className="ide-editor">
        {!creating && !selected ? (
          <div className="ide-empty">{`从左侧打开${noun}，或新建一条。`}</div>
        ) : (
          <>
            <div className="ide-editor-head">
              <input
                className="ide-name"
                value={name}
                maxLength={40}
                disabled={!formulaEditable}
                placeholder={`${noun}名称`}
                onChange={(event) => setName(event.target.value)}
              />
              {workspace === "factor" && formulaEditable && (
                <select
                  className="ide-cond-op"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as "high" | "low" | "none")}
                >
                  <option value="none">无方向</option>
                  <option value="high">越高越好</option>
                  <option value="low">越低越好</option>
                </select>
              )}
              {workspace !== "factor" && selectedStrategy && tab !== "market" && (selectedStrategy.is_owner || selectedStrategy.subscribed) && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !canOperate}
                    title={canOperate ? undefined : blockedReason}
                    onClick={() => run.mutate(selectedStrategy.id)}
                  >
                    {run.isPending ? "扫描中…" : "运行"}
                  </button>
                  <button
                    type="button"
                    className={selectedStrategy.monitoring ? "btn btn-ghost" : "btn btn-primary"}
                    disabled={watch.isPending || (!selectedStrategy.monitoring && !canOperate)}
                    title={!selectedStrategy.monitoring && !canOperate ? blockedReason : undefined}
                    onClick={() => watch.mutate(selectedStrategy)}
                  >
                    {selectedStrategy.monitoring ? "取消监控" : "监控"}
                  </button>
                  {selectedStrategy.kind === "formula" && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={runResearch.isPending || !canOperate}
                      title={canOperate ? undefined : blockedReason}
                      onClick={() => runResearch.mutate(selectedStrategy.id)}
                    >
                      {runResearch.isPending ? "回测中…" : "回测"}
                    </button>
                  )}
                </>
              )}
              {workspace === "factor" && selectedFactor && tab !== "market" && (selectedFactor.is_owner || selectedFactor.subscribed) && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={runResearch.isPending || !canOperate}
                  title={canOperate ? undefined : blockedReason}
                  onClick={() => runResearch.mutate(selectedFactor.id)}
                >
                  {runResearch.isPending ? "回测中…" : "回测"}
                </button>
              )}
              {tab === "market" && selected?.is_owner && (
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
              {tab === "mine" && selected?.is_owner && selected.status === "published" && (
                <button type="button" className="btn btn-ghost" onClick={() => unpublish.mutate(selected.id)}>
                  撤回
                </button>
              )}
              {tab === "mine" && selected?.is_owner && selected.status !== "published" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || !canOperate}
                  title={canOperate ? undefined : blockedReason}
                  onClick={() => publish.mutate(selected.id)}
                >
                  发布
                </button>
              )}
              {tab === "mine" && selected?.is_owner && selected.status === "published" && selected.has_unpublished_changes && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || !canOperate}
                  title={canOperate ? undefined : blockedReason}
                  onClick={() => publish.mutate(selected.id)}
                >
                  发布更新
                </button>
              )}
              {tab === "mine" && selected?.is_owner && (
                <button type="button" className="btn btn-danger" onClick={() => remove.mutate(selected.id)}>
                  删除
                </button>
              )}
            </div>
            {workspace === "condition" ? (
              <div className="ide-conds">
                {conditions.map((condition, index) => (
                  <div className="ide-cond-row" key={`${condition.left}-${index}`}>
                    <select
                      value={condition.left}
                      disabled={!formulaEditable}
                      onChange={(event) => updateCondition(index, { left: event.target.value })}
                    >
                      {(options.data?.fields ?? [{ key: condition.left, label: condition.left }]).map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="ide-cond-op"
                      value={condition.op}
                      disabled={!formulaEditable}
                      onChange={(event) => updateCondition(index, { op: event.target.value })}
                    >
                      {Object.entries(OP_LABELS).map(([op, label]) => (
                        <option key={op} value={op}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={String(condition.right)}
                      disabled={!formulaEditable}
                      onChange={(event) => updateCondition(index, { right: parseRight(event.target.value) })}
                    />
                    {formulaEditable && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={conditions.length <= 1}
                        onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
                      >
                        删
                      </button>
                    )}
                  </div>
                ))}
                {formulaEditable && (
                  <button type="button" className="btn btn-ghost" onClick={() => setConditions((prev) => [...prev, { ...EMPTY_CONDITION }])}>
                    加条件
                  </button>
                )}
              </div>
            ) : (
              <textarea
                className="ide-code"
                value={editorValue}
                spellCheck={false}
                disabled={!formulaEditable}
                placeholder={workspace === "factor" ? DEFAULT_FACTOR_FORMULA : DEFAULT_FORMULA}
                onChange={(event) => {
                  const next = event.target.value;
                  setFormula(next);
                  setVerifiedFormula((prev) => (prev === next ? prev : null));
                }}
              />
            )}
            {formulaEditable && (
              <div className="ide-editor-foot">
                {workspace !== "condition" && (
                  <>
                    <button type="button" className="btn btn-ghost" disabled={!formula.trim() || compile.isPending} onClick={() => compile.mutate()}>
                      {compile.isPending ? "校验中…" : "校验"}
                    </button>
                    {compiledOk && compile.data?.ok && (
                      <span className="muted">{`通过 · 暖机 ${compile.data.warmup_bars} 日`}</span>
                    )}
                    {compile.data && !compile.data.ok && compile.data.formula === formula && (
                      <span className="err">{compile.data.errors[0]?.message || "公式无效"}</span>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saveDisabled}
                  title={workspace !== "condition" && formula.trim() && !compiledOk ? "请先校验通过" : undefined}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? "保存中…" : "保存"}
                </button>
                {error && <span className="err">{error}</span>}
              </div>
            )}
            {error && !formulaEditable && (
              <div className="err" style={{ padding: "8px 10px" }}>
                {error}
              </div>
            )}
            {result && selectedStrategy && result.strategy_id === selectedStrategy.id && (
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
          </>
        )}
      </section>

      <aside className="ide-side">
        {sidePane && (
          <div className="ide-side-panel">
            <div className="ide-ai-head">
              <span>
                {sidePane === "research"
                  ? "回测"
                  : sidePane === "docs"
                    ? "文档"
                    : workspace === "factor"
                      ? "AI · 生成因子"
                      : workspace === "condition"
                        ? "AI"
                        : "AI · 生成公式"}
              </span>
            </div>
            {sidePane === "ai" && workspace !== "condition" && (
              <>
                <div className="ide-ai-log">
                  {chat.map((msg, index) => (
                    <div key={index} className={`ide-msg ${msg.role}${msg.pending ? " is-pending" : ""}`}>
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
                  <textarea
                    value={prompt}
                    placeholder={workspace === "factor" ? "例如 120日均线" : "例如 站上120日均线且放量"}
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                  <button type="submit" className="btn btn-primary" disabled={!prompt.trim() || generate.isPending}>
                    {generate.isPending ? "…" : "发送"}
                  </button>
                </form>
              </>
            )}
            {sidePane === "ai" && workspace === "condition" && (
              <div className="ide-ai-log">
                <div className="ide-msg bot">{CHAT_INTRO.condition}</div>
              </div>
            )}
            {sidePane === "research" && (
              <div className="ide-ai-log">
                {runResearch.isPending && <div className="ide-msg bot">回测中…</div>}
                {!runResearch.isPending && !research && (
                  <div className="ide-msg bot">先保存并通过校验，再点顶部「回测」或下面按钮。</div>
                )}
                {research && (
                  <div className="ide-msg bot">
                    {research.warning ||
                      (research.ok
                        ? `平均收益 ${research.avg_return} · 胜率 ${research.hit_rate} · 日均命中 ${research.avg_names}${
                            research.ic != null ? ` · IC ${research.ic}` : ""
                          }${research.ir != null ? ` · IR ${research.ir}` : ""}`
                        : "回测无结果")}
                  </div>
                )}
                {selected && tab !== "market" && (selected.is_owner || selected.subscribed) && workspace !== "condition" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={runResearch.isPending || !canOperate}
                    title={canOperate ? undefined : blockedReason}
                    onClick={() => runResearch.mutate(selected.id)}
                  >
                    {runResearch.isPending ? "回测中…" : "运行回测"}
                  </button>
                )}
              </div>
            )}
            {sidePane === "docs" && (
              <div className="ide-ai-log">
                <div className="ide-msg bot">{DSL_DOCS}</div>
                <div className="ide-msg bot">{AI_SKILL}</div>
              </div>
            )}
          </div>
        )}
        <nav className="ide-rail" aria-label="侧栏">
          <button
            type="button"
            className={`wb-icon-btn${sidePane === "ai" ? " is-on" : ""}`}
            aria-label="AI"
            title="AI"
            onClick={() => togglePane("ai")}
          >
            <Sparkles size={15} />
          </button>
          <button
            type="button"
            className={`wb-icon-btn${sidePane === "research" ? " is-on" : ""}`}
            aria-label="回测"
            title="回测"
            onClick={() => togglePane("research")}
          >
            <LineChart size={15} />
          </button>
          <button
            type="button"
            className={`wb-icon-btn${sidePane === "docs" ? " is-on" : ""}`}
            aria-label="文档"
            title="文档"
            onClick={() => togglePane("docs")}
          >
            <BookOpen size={15} />
          </button>
        </nav>
      </aside>
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
