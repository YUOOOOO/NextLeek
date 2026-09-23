import { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { queueAiApply, resolveApplyIntent, useAiChat, type ChatMsg } from "../lib/aiChat";

const APPLY_LABEL = {
  strategy: "新建策略",
  factor: "新建因子",
  condition: "新建条件",
} as const;

export function AiDock() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { chat, prompt, setPrompt, pending, ask } = useAiChat();
  const kind = params.get("ws") === "factor" ? "factor" : "strategy";

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
    navigate(`/strategies?ws=${intent}&create=1`);
  }

  return (
    <>
      <div className="ide-ai-log">
        {chat.map((msg, index) => {
          const intent = resolveApplyIntent(msg);
          return (
            <div key={index} className="ide-msg-block">
              <div className={`ide-msg ${msg.role}${msg.pending ? " is-pending" : ""}`}>{msg.text}</div>
              {intent && !msg.pending ? (
                <div className="ai-apply-row">
                  <button type="button" className="btn btn-primary" onClick={() => apply(msg, intent)}>
                    {APPLY_LABEL[intent]}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <form className="ide-ai-form" onSubmit={onSubmit}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="描述你的策略、因子或量化问题…"
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "生成中…" : "发送"}
        </button>
      </form>
    </>
  );
}
