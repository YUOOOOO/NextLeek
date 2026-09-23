import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type AiMessage } from "./api";
import { queryKeys } from "./queryKeys";

export type ChatMsg = AiMessage & { pending?: boolean };

type AiResult = {
  intent?: "strategy" | "factor" | "condition" | "chat";
  response?: string;
  name: string;
  description: string;
  formula: string;
};

export function resolveApplyIntent(msg: ChatMsg): "strategy" | "factor" | "condition" | null {
  if (!msg.formula) return null;
  if (msg.intent === "strategy" || msg.intent === "factor" || msg.intent === "condition") return msg.intent;
  return /[<>!=]|\band\b|\bor\b/.test(msg.formula) ? "strategy" : "factor";
}

type AiChat = {
  chat: ChatMsg[];
  prompt: string;
  setPrompt: (value: string) => void;
  pending: boolean;
  ask: (kind: "strategy" | "factor") => void;
};

const INTRO: ChatMsg = {
  role: "bot",
  text: "你好。我可以生成选股策略或数值因子，也可以回答量化相关问题。",
};

const AiChatContext = createContext<AiChat | null>(null);

export type AiApplyPayload = {
  formula: string;
  intent: "strategy" | "factor" | "condition";
  name?: string;
  description?: string;
};

export const AI_APPLY_EVENT = "nextleek-ai-apply";

export function queueAiApply(payload: AiApplyPayload) {
  sessionStorage.setItem("nextleek_ai_apply", JSON.stringify(payload));
  window.dispatchEvent(new Event(AI_APPLY_EVENT));
}

export function takeAiApply(): AiApplyPayload | null {
  const raw = sessionStorage.getItem("nextleek_ai_apply");
  if (!raw) return null;
  sessionStorage.removeItem("nextleek_ai_apply");
  try {
    const parsed = JSON.parse(raw) as AiApplyPayload;
    if (!parsed.formula || (parsed.intent !== "strategy" && parsed.intent !== "factor" && parsed.intent !== "condition")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistable(messages: ChatMsg[]): AiMessage[] {
  return messages
    .filter((item) => !item.pending)
    .map(({ role, text, formula, intent, name, description }) => ({
      role,
      text,
      ...(formula ? { formula } : {}),
      ...(intent ? { intent } : {}),
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    }));
}

export function AiChatProvider({ children }: { children: ReactNode }) {
  const [chat, setChat] = useState<ChatMsg[]>([INTRO]);
  const [prompt, setPrompt] = useState("");
  const hydrated = useRef(false);
  const history = useQuery({
    queryKey: queryKeys.aiConversation("global"),
    queryFn: () => api.getAiConversation("global"),
  });
  const save = useMutation({
    mutationFn: (messages: ChatMsg[]) => api.saveAiConversation("global", persistable(messages)),
  });
  const generate = useMutation({
    mutationFn: async ({ text, kind }: { text: string; kind: "strategy" | "factor" }) => {
      const payload: AiResult = kind === "factor" ? await api.generateFactor(text) : await api.generateStrategy(text);
      return { payload, kind };
    },
    onSuccess: ({ payload, kind }) => {
      const intent = payload.intent || kind;
      const message: ChatMsg =
        intent === "chat"
          ? { role: "bot", text: payload.response || "" }
          : {
              role: "bot",
              text: `${payload.name}\n${payload.description || ""}\n${payload.formula}`.trim(),
              formula: payload.formula,
              intent,
              name: payload.name,
              description: payload.description,
            };
      setChat((prev) => {
        const next = [...prev.filter((item) => !item.pending), message];
        save.mutate(next);
        return next;
      });
    },
    onError: (error: Error) => {
      setChat((prev) => {
        const next: ChatMsg[] = [...prev.filter((item) => !item.pending), { role: "bot", text: error.message }];
        save.mutate(next);
        return next;
      });
    },
  });

  useEffect(() => {
    if (hydrated.current || generate.isPending) return;
    if (history.data === undefined) return;
    hydrated.current = true;
    if (chat.some((item) => item.role === "user" || item.pending)) return;
    setChat(history.data.messages.length ? history.data.messages : [INTRO]);
  }, [history.data, generate.isPending, chat]);

  function ask(kind: "strategy" | "factor") {
    const text = prompt.trim();
    if (!text || generate.isPending) return;
    hydrated.current = true;
    setPrompt("");
    setChat((prev) => {
      const next: ChatMsg[] = [...prev, { role: "user", text }, { role: "bot", text: "正在生成…", pending: true }];
      save.mutate(next);
      return next;
    });
    generate.mutate({ text, kind });
  }

  return (
    <AiChatContext.Provider value={{ chat, prompt, setPrompt, pending: generate.isPending, ask }}>
      {children}
    </AiChatContext.Provider>
  );
}

export function useAiChat() {
  const value = useContext(AiChatContext);
  if (!value) throw new Error("useAiChat must be used within AiChatProvider");
  return value;
}
