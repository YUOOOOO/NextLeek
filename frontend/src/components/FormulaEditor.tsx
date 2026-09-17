import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, FormulaExample, FormulaPreview } from "../lib/api";

type Kind = "strategy" | "factor";

type Props = {
  kind: Kind;
  formula: string;
  onChange: (value: string) => void;
  examples?: FormulaExample[];
  operators?: string[];
  onGenerated?: (payload: { name: string; formula: string; description: string; code?: string; direction?: string }) => void;
};

export function FormulaEditor({ kind, formula, onChange, examples = [], operators = [], onGenerated }: Props) {
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<FormulaPreview | null>(null);

  const compile = useMutation({
    mutationFn: () => (kind === "factor" ? api.compileFactor(formula) : api.compileStrategy(formula)),
    onSuccess: setPreview,
  });
  const generate = useMutation({
    mutationFn: () => (kind === "factor" ? api.generateFactor(prompt) : api.generateStrategy(prompt)),
    onSuccess: (payload) => {
      onChange(payload.formula);
      setPreview({
        ok: true,
        formula: payload.formula,
        warmup_bars: payload.warmup_bars ?? 1,
        dependencies: payload.dependencies ?? [],
        errors: [],
      });
      onGenerated?.(payload);
    },
  });

  const shown = examples.filter((item) => !item.kind || item.kind === kind);

  return (
    <div className="builder-section">
      <div className="builder-section-head">
        <span>公式</span>
        <span className="muted">直接写表达式，不是下拉框。MA120 = ts_mean(close, 120)</span>
      </div>
      <textarea
        className="formula-input"
        rows={5}
        value={formula}
        placeholder={kind === "factor" ? "ts_mean(close, 120)" : "close > ts_mean(close, 120) and volume > ts_mean(volume, 20)"}
        onChange={(event) => onChange(event.target.value)}
      />
      {shown.length > 0 && (
        <div className="template-row">
          {shown.map((item) => (
            <button key={item.formula} type="button" className="chip" onClick={() => onChange(item.formula)}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      {operators.length > 0 && <div className="muted formula-ops">算子 {operators.join(" ")}</div>}
      <div className="sort-row">
        <button type="button" className="btn btn-ghost" disabled={!formula.trim() || compile.isPending} onClick={() => compile.mutate()}>
          {compile.isPending ? "校验中…" : "校验公式"}
        </button>
        {preview && (
          <span className={preview.ok ? "muted" : "err"}>
            {preview.ok
              ? `通过 · 暖机 ${preview.warmup_bars} 日 · ${preview.dependencies.join(", ") || "无依赖列"}`
              : preview.errors[0]?.message || "公式无效"}
          </span>
        )}
      </div>
      <label className="builder-field">
        AI 生成
        <div className="sort-row">
          <input
            value={prompt}
            placeholder={kind === "factor" ? "例如 120日均线乖离" : "例如 站上120日均线且放量"}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!prompt.trim() || generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? "生成中…" : "生成"}
          </button>
        </div>
      </label>
      {generate.isError && <div className="err">{(generate.error as Error).message}</div>}
    </div>
  );
}
