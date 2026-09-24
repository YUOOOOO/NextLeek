import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { queueAiApply, resolveApplyIntent, resolveMonitorPlan, useAiChat, type ChatMsg } from "../lib/aiChat";
import { defaultBasicFilter, parseUniverse, readStoredUniverse } from "../lib/universe";

const APPLY_LABEL = {
  strategy: "新建策略",
  factor: "新建因子",
  condition: "新建条件",
} as const;

export function AiDock({ mode = "workspace" }: { mode?: "workspace" | "monitor" | "news" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const { chat, prompt, setPrompt, pending, ask } = useAiChat();
  const kind = params.get("ws") === "factor" ? "factor" : "strategy";
  const universe = parseUniverse(params.get("universe") ?? readStoredUniverse());
  const [started, setStarted] = useState<Record<number, string>>({});

  const createWatch = useMutation({
    mutationFn: async ({ msg, plan }: { msg: ChatMsg; plan: "single" | "composite"; index: number }) => {
      if (plan === "single") {
        if (!msg.strategy_id) throw new Error("没有可监控的策略");
        return api.startStrategyMonitor(msg.strategy_id);
      }
      const children = (msg.children || [])
        .map((child) => ({ strategy_id: child.strategy_id, weight: child.weight ?? 1 }))
        .filter((child) => child.strategy_id);
      if (children.length < 2) throw new Error("叠加至少选择 2 个策略");
      const created = await api.createStrategy({
        name: (msg.name || "AI叠加").trim(),
        description: (msg.description || "").trim(),
        kind: "composite",
        asset_type: universe,
        formula: "",
        conditions: [],
        children,
        merge_mode: msg.merge_mode || "union",
        min_confirm: msg.min_confirm || 1,
        basic_filter: defaultBasicFilter(universe),
        order_by: "change_pct",
        descending: true,
        limit: 50,
      });
      await api.startStrategyMonitor(created.id);
      return created;
    },
    onSuccess: async (created, vars) => {
      setStarted((prev) => ({ ...prev, [vars.index]: created.name }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.monitor(universe) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.strategies(universe) });
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    ask(kind);
  }

  function apply(msg: ChatMsg, intent: "strategy" | "factor" | "condition") {
    if (!msg.formula) return;
    queueAiApply({
      formula: msg.formula,
      intent,
      name: msg.name,
      description: msg.description,
    });
    const search = new URLSearchParams();
    if (intent !== "strategy") search.set("ws", intent);
    if (universe === "etf") search.set("universe", "etf");
    search.set("create", "1");
    navigate(`/strategies?${search.toString()}`);
  }

  return (
    <>
      <div className="ide-ai-log">
        {chat.map((msg, index) => {
          const intent = resolveApplyIntent(msg);
          const plan = resolveMonitorPlan(msg);
          return (
            <div key={index} className="ide-msg-block">
              <div className={`ide-msg ${msg.role}${msg.pending ? " is-pending" : ""}`}>{msg.text}</div>
              {mode === "monitor" && plan && !msg.pending ? (
                <div className="ai-apply-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={createWatch.isPending || Boolean(started[index])}
                    onClick={() => createWatch.mutate({ msg, plan, index })}
                  >
                    {started[index] ? "监控中" : createWatch.isPending ? "接入中…" : plan === "single" ? "开始监控" : "叠加并监控"}
                  </button>
                </div>
              ) : null}
              {mode === "workspace" && intent && !msg.pending ? (
                <div className="ai-apply-row">
                  <button type="button" className="btn btn-primary" onClick={() => apply(msg, intent)}>
                    {APPLY_LABEL[intent]}
                  </button>
                </div>
              ) : null}
              {createWatch.error && createWatch.variables?.index === index ? (
                <div className="err">{createWatch.error.message}</div>
              ) : null}
            </div>
          );
        })}
      </div>
      <form className="ide-ai-form" onSubmit={onSubmit}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={mode === "monitor" ? "例如：监控我的突破策略，或把均线和量能叠加" : mode === "news" ? "追问这些快讯，或直接描述你想看的影响…" : "描述你的策略、因子或量化问题…"}
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "生成中…" : "发送"}
        </button>
      </form>
    </>
  );
}
