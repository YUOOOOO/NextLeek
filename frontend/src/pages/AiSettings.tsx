import { FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "../lib/useAuth";

export function AiSettings() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.tickflowSettings });
  const [provider, setProvider] = useState("openai_compat");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!settings.data) return;
    setProvider(settings.data.ai_provider || "openai_compat");
    setBaseUrl(settings.data.ai_base_url || "");
    setModel(settings.data.ai_model || "");
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.saveAiSettings({
        provider,
        base_url: baseUrl,
        api_key: apiKey || undefined,
        model,
      }),
    onSuccess: async () => {
      setApiKey("");
      setError("");
      setMsg("已保存");
      await qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (err: Error) => {
      setMsg("");
      setError(err.message);
    },
  });
  const clear = useMutation({
    mutationFn: api.clearAiSettings,
    onSuccess: async () => {
      setApiKey("");
      setError("");
      setMsg("已清空");
      await qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (err: Error) => {
      setMsg("");
      setError(err.message);
    },
  });

  if (me.data && me.data.role !== "admin") {
    return <Navigate to="/settings" replace />;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="card p-4 space-y-4">
      <p className="page-desc">
        兼容 OpenAI Chat Completions。配好后，因子/策略编辑器里的「生成」才会工作。
      </p>
      <div className="kv-row">
        <span className="kv-key">当前状态</span>
        <span className="kv-val">
          {settings.data?.ai_configured ? "已配置" : "未配置"}
          {settings.data?.has_ai_key ? ` · Key ${settings.data.ai_api_key_masked}` : ""}
        </span>
      </div>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit}>
        <label className="builder-field">
          Provider
          <select className="field" value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="openai_compat">OpenAI 兼容</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label className="builder-field">
          模型
          <input className="field" value={model} placeholder="gpt-4.1-mini" onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="builder-field md:col-span-2">
          Base URL
          <input
            className="field"
            value={baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="builder-field md:col-span-2">
          API Key
          <input
            className="field"
            type="password"
            value={apiKey}
            placeholder={settings.data?.has_ai_key ? "留空则不改现有 Key" : "sk-..."}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {error && <div className="err md:col-span-2">{error}</div>}
        {msg && <div className="muted md:col-span-2">{msg}</div>}
        <div className="sort-row md:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? "保存中…" : "保存"}
          </button>
          <button type="button" className="btn btn-ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>
            清空
          </button>
        </div>
      </form>
    </section>
  );
}
