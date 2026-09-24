import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Lock, Trash2 } from "lucide-react";
import {
  api,
  DisplaySignal,
  DisplaySignalWrite,
  DisplayTagTone,
  StrategyCondition,
} from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useUniverse } from "../lib/universe";
const EMPTY: StrategyCondition = { left: "close", op: ">", right: "field:ma20", leftDays: 0, rightDays: 0 };

function slugId(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return ascii || `s_${Math.random().toString(36).slice(2, 10)}`;
}

function conditionText(condition: StrategyCondition, fields: Array<{ key: string; label: string }>) {
  const label = (key: string) => fields.find((field) => field.key === key)?.label ?? key;
  const left = `${condition.leftDays ? `前${condition.leftDays}日` : ""}${label(condition.left)}`;
  if (typeof condition.right === "string" && condition.right.startsWith("field:")) {
    return `${left} ${condition.op} ${condition.rightDays ? `前${condition.rightDays}日` : ""}${label(condition.right.slice(6))}`;
  }
  return `${left} ${condition.op} ${String(condition.right)}`;
}

export function SignalWorkspace<W extends string>({
  workspace,
  workspaces,
  onWorkspace,
}: {
  workspace: W;
  workspaces: Array<{ id: W; label: string }>;
  onWorkspace: (next: W) => void;
}) {
  const queryClient = useQueryClient();
  const { universe } = useUniverse();
  const catalog = useQuery({ queryKey: queryKeys.displaySignals(universe), queryFn: () => api.listDisplaySignals(universe) });
  const options = useQuery({ queryKey: queryKeys.strategyOptions, queryFn: api.strategyOptions });
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [builtinOpen, setBuiltinOpen] = useState(false);
  const [name, setName] = useState("");
  const [tone, setTone] = useState<DisplayTagTone>("bull");
  const [conditions, setConditions] = useState<StrategyCondition[]>([{ ...EMPTY }]);
  const [error, setError] = useState("");
  useEffect(() => {
    setCreating(false);
    setSelectedId(null);
    setBuiltinOpen(false);
    setName("");
    setTone("bull");
    setConditions([{ ...EMPTY }]);
    setError("");
  }, [universe]);

  const fields = options.data?.fields ?? [];
  const operators = options.data?.operators ?? [">", ">=", "<", "<=", "==", "!="];
  const builtin = catalog.data?.builtin ?? [];
  const custom = catalog.data?.custom ?? [];
  const items = useMemo(() => [...builtin, ...custom], [builtin, custom]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const editing = creating || (selected != null && !selected.locked);
  const canSave = editing && name.trim().length > 0 && conditions.length > 0;

  const save = useMutation({
    mutationFn: (body: DisplaySignalWrite) => api.saveDisplaySignal(body),
    onSuccess: (_data, body) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.displaySignals(universe) });
      queryClient.invalidateQueries({ queryKey: queryKeys.monitor(universe) });
      queryClient.invalidateQueries({ queryKey: ["kline"] });
      setCreating(false);
      setSelectedId(body.id);
      setError("");
    },
    onError: (err: Error) => setError(err.message || "保存失败"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDisplaySignal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.displaySignals(universe) });
      queryClient.invalidateQueries({ queryKey: queryKeys.monitor(universe) });
      queryClient.invalidateQueries({ queryKey: ["kline"] });
      setSelectedId(null);
      setCreating(false);
    },
    onError: (err: Error) => setError(err.message || "删除失败"),
  });

  function openCreate() {
    setCreating(true);
    setSelectedId(null);
    setName("");
    setTone("bull");
    setConditions([{ ...EMPTY }]);
    setError("");
  }

  function select(item: DisplaySignal) {
    setCreating(false);
    setSelectedId(item.id);
    setName(item.name);
    setTone(item.tone);
    setConditions(item.conditions?.length ? item.conditions.map((row) => ({ ...row })) : [{ ...EMPTY }]);
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    const id = creating ? slugId(name) : selected?.id;
    if (!id) return;
    save.mutate({
      id,
      name: name.trim(),
      description: conditions.map((row) => conditionText(row, fields)).join(" 且 "),
      tone,
      enabled: true,
      conditions,
      asset_type: universe,
    });
  }

  return (
    <div className="ide">
      <aside className="ide-list">
        <div className="ide-ws-tabs" role="tablist" aria-label="工作区">
          {workspaces.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={workspace === item.id}
              className={`ide-ws-tab${workspace === item.id ? " is-on" : ""}`}
              onClick={() => onWorkspace(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ide-list-create">
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            新建
          </button>
        </div>
        <div className="ide-list-body">
          {catalog.isLoading ? <div className="ide-empty">加载中…</div> : null}
          {catalog.isError ? <div className="ide-empty">加载失败</div> : null}
          {builtin.length > 0 ? (
            <button
              type="button"
              className="sig-list-label"
              aria-expanded={builtinOpen}
              onClick={() => setBuiltinOpen((open) => !open)}
            >
              <ChevronRight size={12} className={builtinOpen ? "is-open" : undefined} />
              内置
              <span>{builtin.length}</span>
            </button>
          ) : null}
          {builtinOpen
            ? builtin.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`ide-row${selectedId === item.id && !creating ? " is-on" : ""}`}
                  onClick={() => select(item)}
                >
                  <div className="ide-row-top">
                    <span className="ide-row-name">{item.name}</span>
                    <span className={`kline-tag is-${item.tone}`}>{item.tone === "bear" ? "空" : item.tone === "bull" ? "多" : "中"}</span>
                  </div>
                  <div className="mon-pool-meta">默认订阅</div>
                </button>
              ))
            : null}
          <div className="sig-list-label">自定义</div>
          {custom.length === 0 && !catalog.isLoading ? <div className="ide-empty">还没有自定义信号</div> : null}
          {custom.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ide-row${selectedId === item.id && !creating ? " is-on" : ""}`}
              onClick={() => select(item)}
            >
              <div className="ide-row-top">
                <span className="ide-row-name">{item.name}</span>
                <span className={`kline-tag is-${item.tone}`}>{item.tone === "bear" ? "空" : item.tone === "bull" ? "多" : "中"}</span>
              </div>
              <div className="mon-pool-meta">
                {(item.conditions ?? []).map((row) => conditionText(row, fields)).join(" 且 ") || item.description}
              </div>
            </button>
          ))}
        </div>
      </aside>
      <section className="ide-editor">
        {!creating && !selected ? (
          <div className="ide-empty">从左侧打开信号，或新建一条。命中后会出现在监控列表和个股弹窗。</div>
        ) : (
          <form className="sig-editor" onSubmit={submit}>
            <div className="ide-editor-head">
              <input
                className="ide-name"
                value={name}
                maxLength={40}
                disabled={!editing}
                placeholder="信号名称"
                onChange={(event) => setName(event.target.value)}
              />
              <select
                className="ide-cond-op"
                value={tone}
                disabled={!editing}
                onChange={(event) => setTone(event.target.value as DisplayTagTone)}
              >
                <option value="bull">看多</option>
                <option value="bear">看空</option>
                <option value="neutral">中性</option>
              </select>
              {editing ? (
                <button type="submit" className="btn btn-primary" disabled={!canSave || save.isPending}>
                  {save.isPending ? "保存中…" : "保存"}
                </button>
              ) : (
                <span className="sig-lock" title="默认订阅，不可取消">
                  <Lock size={12} />
                  已订阅
                </span>
              )}
              {selected && !selected.locked ? (
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(selected.id)}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              ) : null}
            </div>
            {error ? <div className="kline-err">{error}</div> : null}
            {selected?.locked ? (
              <p className="page-desc">{selected.description}</p>
            ) : (
              <>
                {conditions.map((condition, index) => (
                  <div className="ide-cond-row" key={`${condition.left}-${index}`}>
                    <select
                      value={condition.left}
                      onChange={(event) =>
                        setConditions((prev) => prev.map((item, i) => (i === index ? { ...item, left: event.target.value } : item)))
                      }
                    >
                      {(fields.length ? fields : [{ key: condition.left, label: condition.left }]).map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="ide-cond-op"
                      value={condition.op}
                      onChange={(event) =>
                        setConditions((prev) => prev.map((item, i) => (i === index ? { ...item, op: event.target.value } : item)))
                      }
                    >
                      {operators.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                    <input
                      value={String(condition.right)}
                      onChange={(event) =>
                        setConditions((prev) => prev.map((item, i) => (i === index ? { ...item, right: event.target.value } : item)))
                      }
                      placeholder="30 或 field:ma20"
                    />
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={conditions.length <= 1}
                      onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
                    >
                      删
                    </button>
                  </div>
                ))}
                <div className="sig-form-row">
                  <button type="button" className="btn-quiet" onClick={() => setConditions((prev) => [...prev, { ...EMPTY }])}>
                    加条件
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
