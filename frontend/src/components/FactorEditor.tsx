import { FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api, Factor, FormulaExample } from "../lib/api";
import { FormulaEditor } from "./FormulaEditor";

type Props = {
  factor: Factor | null;
  examples?: FormulaExample[];
  operators?: string[];
  onClose: () => void;
  onSaved: (factor: Factor) => void;
};

export function FactorEditor({ factor, examples, operators, onClose, onSaved }: Props) {
  const [name, setName] = useState(factor?.name ?? "");
  const [code, setCode] = useState(factor?.code ?? "");
  const [description, setDescription] = useState(factor?.description ?? "");
  const [formula, setFormula] = useState(factor?.formula ?? "ts_mean(close, 120)");
  const [direction, setDirection] = useState<"high" | "low" | "none">(factor?.direction ?? "none");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        code: factor ? undefined : code.trim() || undefined,
        description: description.trim(),
        formula: formula.trim(),
        direction,
      };
      return factor ? api.updateFactor(factor.id, payload) : api.createFactor(payload);
    },
    onSuccess: onSaved,
    onError: (err: Error) => setError(err.message),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("请填写名称");
      return;
    }
    if (!formula.trim()) {
      setError("请填写公式");
      return;
    }
    save.mutate();
  }

  return createPortal(
    <div className="builder-mask">
      <form className="builder" onSubmit={onSubmit}>
        <div className="builder-head">
          <div>
            <h2>{factor ? "编辑因子" : "新建因子"}</h2>
            <p>公式即定义。MA120 写 ts_mean(close, 120)，发布后别人可订阅，策略公式里用代码引用。</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="builder-body">
          <label className="builder-field">
            名称
            <input value={name} maxLength={40} placeholder="例如 120日均线" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="builder-field">
            代码
            <input
              value={code}
              maxLength={40}
              disabled={Boolean(factor)}
              placeholder="ma120（策略里用这个名字）"
              onChange={(event) => setCode(event.target.value.toLowerCase())}
            />
          </label>
          <label className="builder-field">
            说明
            <input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="template-row">
            {(["none", "high", "low"] as const).map((item) => (
              <button key={item} type="button" className={`chip ${direction === item ? "is-on" : ""}`} onClick={() => setDirection(item)}>
                {item === "none" ? "无方向" : item === "high" ? "越大越好" : "越小越好"}
              </button>
            ))}
          </div>
          <FormulaEditor
            kind="factor"
            formula={formula}
            onChange={setFormula}
            examples={examples}
            operators={operators}
            onGenerated={(payload) => {
              setFormula(payload.formula);
              if (!name.trim()) setName(payload.name);
              if (!code.trim() && payload.code) setCode(payload.code);
              if (!description.trim() && payload.description) setDescription(payload.description);
              if (payload.direction === "high" || payload.direction === "low" || payload.direction === "none") {
                setDirection(payload.direction);
              }
            }}
          />
          {error && <div className="err">{error}</div>}
        </div>
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
