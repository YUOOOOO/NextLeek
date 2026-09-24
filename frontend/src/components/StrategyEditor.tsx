import { FormEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, Search, Trash2, X } from "lucide-react";
import {
  api,
  type Strategy,
  type StrategyBasicFilter,
  type StrategyCondition,
  type StrategyFieldGroup,
  type StrategyKind,
  type StrategyOptions,
} from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { defaultBasicFilter, useUniverse } from "../lib/universe";
import { FormulaEditor } from "./FormulaEditor";

const BOARDS = ["沪主板", "深主板", "创业板", "科创板", "北交所"];
const DAY_PRESETS = [0, 1, 5, 10, 20, 60];
const RATIO_HINT: Record<string, true> = {
  change_pct: true,
  turnover_rate: true,
  amplitude: true,
  rsi_6: true,
  rsi_12: true,
  rsi_14: true,
  rsi_24: true,
};

const OP_LABELS: Record<string, string> = {
  ">": "大于",
  ">=": "大于等于",
  "<": "小于",
  "<=": "小于等于",
  "==": "等于",
  "!=": "不等于",
  contains: "包含",
  between: "介于",
};

const TEMPLATES: Array<{ label: string; conditions: StrategyCondition[] }> = [
  {
    label: "站上均线",
    conditions: [{ left: "close", op: ">", right: "field:ma20", leftDays: 0, rightDays: 0 }],
  },
  {
    label: "放量上涨",
    conditions: [
      { left: "change_pct", op: ">", right: 0.03, leftDays: 0, rightDays: 0 },
      { left: "volume", op: ">", right: "field:volume", leftDays: 0, rightDays: 5 },
    ],
  },
  {
    label: "RSI 超卖反弹",
    conditions: [
      { left: "rsi_14", op: "<", right: 30, leftDays: 1, rightDays: 0 },
      { left: "rsi_14", op: ">", right: 30, leftDays: 0, rightDays: 0 },
    ],
  },
  {
    label: "缩量回调",
    conditions: [
      { left: "change_pct", op: "<", right: 0, leftDays: 0, rightDays: 0 },
      { left: "volume", op: "<", right: "field:volume", leftDays: 0, rightDays: 5 },
    ],
  },
];


const EMPTY_CONDITION: StrategyCondition = {
  left: "change_pct",
  op: ">",
  right: 0.05,
  leftDays: 0,
  rightDays: 0,
};

type Props = {
  strategy: Strategy | null;
  options: StrategyOptions | undefined;
  onClose: () => void;
  onSaved: (strategy: Strategy) => void;
};

function isFieldRight(value: string | number): value is string {
  return typeof value === "string" && value.startsWith("field:");
}

function fieldLabel(options: StrategyOptions | undefined, key: string): string {
  return options?.fields.find((field) => field.key === key)?.label ?? key;
}

function daysText(days: number): string {
  if (!days) return "";
  return days === 1 ? "前1日" : `前${days}日`;
}

function conditionText(condition: StrategyCondition, options: StrategyOptions | undefined): string {
  const left = `${daysText(condition.leftDays ?? 0)}${fieldLabel(options, condition.left)}`;
  const op = OP_LABELS[condition.op] ?? condition.op;
  if (isFieldRight(condition.right)) {
    return `${left} ${op} ${daysText(condition.rightDays ?? 0)}${fieldLabel(options, condition.right.slice(6))}`;
  }
  return `${left} ${op} ${String(condition.right)}`;
}

function FieldPicker({
  value,
  fields,
  groups,
  onChange,
}: {
  value: string;
  fields: Array<{ key: string; label: string }>;
  groups: StrategyFieldGroup[];
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 280 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = fields.find((field) => field.key === value)?.label ?? value;
  const q = query.trim().toLowerCase();
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter(
        (field) => !q || field.label.toLowerCase().includes(q) || field.key.toLowerCase().includes(q),
      ),
    }))
    .filter((group) => group.fields.length > 0);
  const filteredFields = q
    ? fields.filter((field) => field.label.toLowerCase().includes(q) || field.key.toLowerCase().includes(q))
    : [];

  function openPicker() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.max(280, rect.width);
      const left = Math.min(rect.left, window.innerWidth - width - 12);
      const top = rect.bottom + 6;
      setPos({ top: Math.min(top, window.innerHeight - 360), left: Math.max(12, left), width });
    }
    setQuery("");
    setOpen(true);
  }

  function pick(key: string) {
    onChange(key);
    setOpen(false);
  }

  return (
    <>
      <button ref={buttonRef} type="button" className="field-btn" onClick={openPicker}>
        {selected}
      </button>
      {open &&
        createPortal(
          <>
            <button type="button" className="field-picker-mask" onClick={() => setOpen(false)} />
            <div className="field-picker" style={{ top: pos.top, left: pos.left, width: pos.width }}>
              <div className="field-picker-search">
                <Search size={14} />
                <input
                  autoFocus
                  value={query}
                  placeholder="搜索字段"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="field-picker-list">
                {filteredGroups.length === 0 && filteredFields.length === 0 ? (
                  <div className="field-picker-empty">无匹配字段</div>
                ) : q ? (
                  filteredFields.map((field) => (
                    <button
                      key={field.key}
                      type="button"
                      className={field.key === value ? "is-active" : ""}
                      onClick={() => pick(field.key)}
                    >
                      {field.label}
                      <span>{field.key}</span>
                    </button>
                  ))
                ) : (
                  filteredGroups.map((group) => (
                    <div key={group.key} className="field-picker-group">
                      <div className="field-picker-group-title">{group.label}</div>
                      {group.fields.map((field) => (
                        <button
                          key={field.key}
                          type="button"
                          className={field.key === value ? "is-active" : ""}
                          onClick={() => pick(field.key)}
                        >
                          {field.label}
                          <span>{field.key}</span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function DaysInput({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (days: number) => void;
}) {
  return (
    <select className="days-select" value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {DAY_PRESETS.filter((day) => day <= max).map((day) => (
        <option key={day} value={day}>
          {day === 0 ? "当日" : `前${day}日`}
        </option>
      ))}
      {!DAY_PRESETS.includes(value) && value <= max && <option value={value}>前{value}日</option>}
    </select>
  );
}

function RightValueInput({
  condition,
  fields,
  groups,
  maxDays,
  onChangeRight,
  onChangeDays,
}: {
  condition: StrategyCondition;
  fields: Array<{ key: string; label: string }>;
  groups: StrategyFieldGroup[];
  maxDays: number;
  onChangeRight: (value: string | number) => void;
  onChangeDays: (days: number) => void;
}) {
  const fieldMode = isFieldRight(condition.right);
  const fieldKey =
    typeof condition.right === "string" && condition.right.startsWith("field:")
      ? condition.right.slice(6)
      : "close";
  const numValue = fieldMode ? "" : String(condition.right);

  return (
    <div className="right-value">
      {fieldMode ? (
        <>
          <DaysInput value={condition.rightDays ?? 0} max={maxDays} onChange={onChangeDays} />
          <FieldPicker value={fieldKey} fields={fields} groups={groups} onChange={(key) => onChangeRight(`field:${key}`)} />
        </>
      ) : (
        <input
          className="value-input"
          value={numValue}
          placeholder={RATIO_HINT[condition.left] ? "0.05 = 5%" : "数值"}
          onChange={(event) => {
            const raw = event.target.value;
            const parsed = Number(raw);
            onChangeRight(raw === "" || Number.isNaN(parsed) ? raw : parsed);
          }}
        />
      )}
      <button
        type="button"
        className="mode-toggle"
        title={fieldMode ? "切换为数值" : "切换为字段"}
        onClick={() => onChangeRight(fieldMode ? 0 : `field:${condition.left}`)}
      >
        {fieldMode ? "123" : "字段"}
      </button>
    </div>
  );
}

export function StrategyEditor({ strategy, options, onClose, onSaved }: Props) {
  const { universe } = useUniverse();
  const catalog = useQuery({ queryKey: queryKeys.strategies(universe), queryFn: () => api.listStrategies(universe) });
  const [name, setName] = useState(strategy?.name ?? "");
  const [description, setDescription] = useState(strategy?.description ?? "");
  const [kind, setKind] = useState<StrategyKind>(strategy?.kind ?? "formula");
  const [formula, setFormula] = useState(strategy?.formula ?? "close > ts_mean(close, 120)");
  const [childIds, setChildIds] = useState<string[]>(
    (strategy?.children ?? []).map((item) => item.strategy_id).filter(Boolean),
  );
  const [mergeMode, setMergeMode] = useState<"union" | "intersect">(strategy?.merge_mode ?? "union");
  const [conditions, setConditions] = useState<StrategyCondition[]>(
    strategy?.conditions?.length ? strategy.conditions : [{ ...EMPTY_CONDITION }],
  );
  const [basic, setBasic] = useState<StrategyBasicFilter>(strategy?.basic_filter ?? defaultBasicFilter(universe));
  const [orderBy, setOrderBy] = useState(strategy?.order_by ?? "change_pct");
  const [descending, setDescending] = useState(strategy?.descending ?? true);
  const [limit, setLimit] = useState(strategy?.limit ?? 100);
  const [error, setError] = useState("");

  const fields = options?.fields ?? [];
  const groups = options?.groups ?? [];
  const maxDays = options?.maxDays ?? 20;
  const numberOps = options?.operators ?? [">", ">=", "<", "<=", "==", "!="];

  const overlayChoices = useMemo(() => {
    const rows = [...(catalog.data?.mine ?? []), ...(catalog.data?.subscribed ?? [])];
    const seen = new Set<string>();
    return rows.filter((item) => {
      if (item.id === strategy?.id) return false;
      if ((item.kind ?? "conditions") === "composite") return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [catalog.data, strategy?.id]);

  const preview = useMemo(
    () => conditions.map((condition) => conditionText(condition, options)).join(" 且 "),
    [conditions, options],
  );

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        kind,
        asset_type: universe,
        formula: kind === "formula" ? formula : "",
        conditions: kind === "conditions" ? conditions : [],
        children: kind === "composite" ? childIds.map((id) => ({ strategy_id: id, weight: 1 })) : [],
        merge_mode: mergeMode,
        basic_filter: basic,
        order_by: orderBy,
        descending,
        limit,
      };
      return strategy ? api.updateStrategy(strategy.id, payload) : api.createStrategy(payload);
    },
    onSuccess: onSaved,
    onError: (err: Error) => setError(err.message),
  });

  function patch(index: number, next: Partial<StrategyCondition>) {
    setConditions((prev) => prev.map((item, i) => (i === index ? { ...item, ...next } : item)));
  }

  function toggleChild(id: string) {
    setChildIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("请填写策略名称");
      return;
    }
    if (kind === "composite") {
      if (childIds.length < 2) {
        setError("叠加至少选择 2 个策略");
        return;
      }
    } else if (kind === "formula") {
      if (!formula.trim()) {
        setError("请填写策略公式");
        return;
      }
    } else if (!conditions.length) {
      setError("至少一条条件");
      return;
    }
    save.mutate();
  }

  return createPortal(
    <div className="builder-mask">
      <form className="builder" onSubmit={onSubmit}>
        <div className="builder-head">
          <div>
            <h2>{strategy ? "编辑策略" : "新建策略"}</h2>
            <p>{kind === "composite" ? "把已有策略并集或交集叠在一起。" : "写布尔公式选股，可引用自定义因子，例如 close > ts_mean(close, 120)。"}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="builder-body">
          <label className="builder-field">
            名称
            <input value={name} maxLength={40} placeholder="例如 放量突破" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="builder-field">
            说明
            <input
              value={description}
              maxLength={500}
              placeholder="给自己和其他订阅者看"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <div className="builder-section">
            <div className="builder-section-head">类型</div>
            <div className="template-row">
              <button type="button" className={`chip ${kind === "formula" ? "is-on" : ""}`} onClick={() => setKind("formula")}>
                公式
              </button>
              {(strategy?.kind === "conditions" || kind === "conditions") && (
                <button type="button" className={`chip ${kind === "conditions" ? "is-on" : ""}`} onClick={() => setKind("conditions")}>
                  条件
                </button>
              )}
              <button type="button" className={`chip ${kind === "composite" ? "is-on" : ""}`} onClick={() => setKind("composite")}>
                叠加
              </button>
            </div>
          </div>

          {kind === "formula" && (
            <FormulaEditor
              kind="strategy"
              formula={formula}
              onChange={setFormula}
              examples={options?.examples}
              operators={options?.formula_operators}
              onGenerated={(payload) => {
                setFormula(payload.formula);
                if (!name.trim()) setName(payload.name);
                if (!description.trim() && payload.description) setDescription(payload.description);
              }}
            />
          )}

          {kind === "composite" && (
            <div className="builder-section">
              <div className="builder-section-head">
                <span>子策略</span>
                <span className="muted">已选 {childIds.length} / 8</span>
              </div>
              <div className="template-row">
                <button type="button" className={`chip ${mergeMode === "union" ? "is-on" : ""}`} onClick={() => setMergeMode("union")}>
                  并集
                </button>
                <button type="button" className={`chip ${mergeMode === "intersect" ? "is-on" : ""}`} onClick={() => setMergeMode("intersect")}>
                  交集
                </button>
              </div>
              <div className="cond-list">
                {overlayChoices.length === 0 && (
                  <div className="muted">先建两条条件策略，或订阅别人的策略，才能叠加。</div>
                )}
                {overlayChoices.map((item) => {
                  const on = childIds.includes(item.id);
                  const full = !on && childIds.length >= 8;
                  return (
                    <label key={item.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={full}
                        onChange={() => toggleChild(item.id)}
                      />
                      {item.name}
                      <span className="muted">{item.is_owner ? "我的" : item.owner_username}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}


          {kind === "conditions" && (
          <div className="builder-section">
            <div className="builder-section-head">
              <span>条件</span>
              <span className="muted">全部 AND</span>
            </div>
            <div className="template-row">
              {TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  className="chip"
                  onClick={() => setConditions(template.conditions.map((item) => ({ ...item })))}
                >
                  {template.label}
                </button>
              ))}
            </div>
            <div className="cond-list">
              {conditions.map((condition, index) => (
                <div key={`${condition.left}-${index}`} className="cond-builder">
                  <DaysInput
                    value={condition.leftDays ?? 0}
                    max={maxDays}
                    onChange={(days) => patch(index, { leftDays: days })}
                  />
                  <FieldPicker
                    value={condition.left}
                    fields={fields}
                    groups={groups}
                    onChange={(key) => patch(index, { left: key })}
                  />
                  <select
                    className="op-select"
                    value={condition.op}
                    onChange={(event) => patch(index, { op: event.target.value })}
                  >
                    {numberOps.map((op) => (
                      <option key={op} value={op}>
                        {OP_LABELS[op] ?? op}
                      </option>
                    ))}
                  </select>
                  <RightValueInput
                    condition={condition}
                    fields={fields}
                    groups={groups}
                    maxDays={maxDays}
                    onChangeRight={(value) => patch(index, { right: value })}
                    onChangeDays={(days) => patch(index, { rightDays: days })}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={conditions.length <= 1}
                    onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            {conditions.length < 8 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConditions((prev) => [...prev, { ...EMPTY_CONDITION }])}
              >
                <Plus size={14} /> 添加条件
              </button>
            )}
            {preview && (
              <div className="preview-line">
                <ArrowRight size={12} />
                {preview}
              </div>
            )}
          </div>
          )}

          <div className="builder-section">
            <div className="builder-section-head">基础过滤</div>
            <div className="filter-grid">
              <label>
                最低价
                <input
                  type="number"
                  value={basic.price_min ?? ""}
                  onChange={(event) =>
                    setBasic((prev) => ({ ...prev, price_min: event.target.value === "" ? null : Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                最高价
                <input
                  type="number"
                  value={basic.price_max ?? ""}
                  onChange={(event) =>
                    setBasic((prev) => ({ ...prev, price_max: event.target.value === "" ? null : Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                最小市值（亿）
                <input
                  type="number"
                  value={basic.market_cap_min == null ? "" : basic.market_cap_min / 1e8}
                  onChange={(event) =>
                    setBasic((prev) => ({
                      ...prev,
                      market_cap_min: event.target.value === "" ? null : Number(event.target.value) * 1e8,
                    }))
                  }
                />
              </label>
              <label>
                最小成交额（万）
                <input
                  type="number"
                  value={basic.amount_min == null ? "" : basic.amount_min / 1e4}
                  onChange={(event) =>
                    setBasic((prev) => ({
                      ...prev,
                      amount_min: event.target.value === "" ? null : Number(event.target.value) * 1e4,
                    }))
                  }
                />
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={basic.exclude_st}
                onChange={(event) => setBasic((prev) => ({ ...prev, exclude_st: event.target.checked }))}
              />
              排除 ST / *ST
            </label>
            <div className="board-row">
              {BOARDS.map((board) => {
                const on = basic.boards.includes(board);
                return (
                  <button
                    key={board}
                    type="button"
                    className={`chip ${on ? "is-on" : ""}`}
                    onClick={() =>
                      setBasic((prev) => ({
                        ...prev,
                        boards: on ? prev.boards.filter((item) => item !== board) : [...prev.boards, board],
                      }))
                    }
                  >
                    {board}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="builder-section">
            <div className="builder-section-head">排序与条数</div>
            <div className="sort-row">
              <select value={orderBy} onChange={(event) => setOrderBy(event.target.value)}>
                {fields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
              <select value={descending ? "desc" : "asc"} onChange={(event) => setDescending(event.target.value === "desc")}>
                <option value="desc">从高到低</option>
                <option value="asc">从低到高</option>
              </select>
              <input
                type="number"
                min={1}
                max={500}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value) || 100)}
              />
            </div>
          </div>
        </div>

        {error && <div className="err">{error}</div>}
        <div className="builder-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
