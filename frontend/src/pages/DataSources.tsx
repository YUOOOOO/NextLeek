import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, DataProviders } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "../lib/useAuth";

type Capability = {
  id: string;
  label: string;
  field: keyof DataProviders | null;
  current: string;
  current_display: string;
  usable: boolean;
  candidates: Array<{ name: string; display: string }>;
  pending: Array<{ name: string; display: string; note?: string }>;
};

type Matrix = { capabilities: Capability[] };

export function DataSources() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [pluginKeys, setPluginKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.tickflowSettings });
  const sources = useQuery({ queryKey: queryKeys.dataSources, queryFn: api.dataSources });
  const matrix = useQuery({ queryKey: queryKeys.capabilityMatrix, queryFn: api.capabilityMatrix });
  const capabilities = (matrix.data as Matrix | undefined)?.capabilities ?? [];
  const plugins = sources.data?.plugins ?? [];

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.settings }),
      qc.invalidateQueries({ queryKey: queryKeys.dataSources }),
      qc.invalidateQueries({ queryKey: queryKeys.preferences }),
      qc.invalidateQueries({ queryKey: queryKeys.capabilityMatrix }),
    ]);
  };
  const saveKey = useMutation({
    mutationFn: () => api.saveTickflowKey(apiKey.trim()),
    onSuccess: async () => { setApiKey(""); setError(""); await refresh(); },
    onError: (err: Error) => setError(err.message),
  });
  const clearKey = useMutation({
    mutationFn: api.clearTickflowKey,
    onSuccess: refresh,
    onError: (err: Error) => setError(err.message),
  });
  const savePluginKey = useMutation({
    mutationFn: async (name: string) => {
      const result = await api.savePluginKey(name, pluginKeys[name]?.trim() ?? "") as { ok: boolean; error?: string };
      if (!result.ok) throw new Error(result.error || "Key 验证失败，未保存");
      return name;
    },
    onSuccess: async (name) => {
      setPluginKeys((keys) => ({ ...keys, [name]: "" }));
      setError("");
      await refresh();
    },
    onError: (err: Error) => setError(err.message),
  });
  const clearPluginKey = useMutation({
    mutationFn: api.clearPluginKey,
    onSuccess: refresh,
    onError: (err: Error) => setError(err.message),
  });
  const switchProviders = useMutation({
    mutationFn: (updates: Partial<DataProviders>) => api.updateDataProviders(updates),
    onSuccess: async () => { setError(""); await refresh(); },
    onError: (err: Error) => setError(err.message),
  });

  const applySource = (name: string) => {
    const updates: Partial<DataProviders> = {};
    for (const cap of capabilities) {
      if (cap.field && cap.candidates.some((candidate) => candidate.name === name)) {
        updates[cap.field] = name;
      }
    }
    if (Object.keys(updates).length) switchProviders.mutate(updates);
  };

  if (!me.data || me.data.role !== "admin") {
    return me.isLoading ? null : <Navigate to="/settings" replace />;
  }

  return (
    <div className="w-full max-w-none space-y-5">
      {error && <div role="alert" className="card px-4 py-3 text-sm text-[#f87171]">{error}</div>}

      <section className="card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--ds-color-text-primary)]">数据源</h2>
          <p className="mt-1 text-xs text-[var(--ds-color-text-placeholder)]">TickFlow 和扶摇按能力独立路由；配置 Key 不会自动切换，点击「接管可用能力」或在下方逐项切换。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--ds-color-border-default)] bg-[var(--ds-color-bg-muted)] p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[var(--ds-color-text-primary)]">TickFlow</div>
                <div className="mt-1 text-xs text-[var(--ds-color-text-placeholder)]">{settings.data?.tier_label ?? "—"} · {settings.data?.mode ?? "none"}</div>
              </div>
              <span className={`badge shrink-0 ${settings.data?.has_tickflow_key ? "badge-on" : "badge-off"}`}>
                {settings.data?.has_tickflow_key ? settings.data.tickflow_api_key_masked : "免费模式"}
              </span>
            </div>
            <div className="text-xs text-[var(--ds-color-text-placeholder)]">{capabilities.filter((cap) => cap.usable && cap.current === "tickflow").length} 项能力服务中</div>
            <form className="flex flex-wrap gap-2" onSubmit={(event: FormEvent) => { event.preventDefault(); saveKey.mutate(); }}>
              <input className="field min-w-0 flex-1" type="password" autoComplete="off" placeholder="TickFlow API Key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
              <button className="btn btn-primary shrink-0" disabled={!apiKey.trim() || saveKey.isPending}>保存并探测</button>
              {settings.data?.has_tickflow_key && <button className="btn btn-ghost shrink-0" type="button" onClick={() => clearKey.mutate()} disabled={clearKey.isPending}>清除</button>}
            </form>
            <button className="btn btn-primary" type="button" disabled={switchProviders.isPending || !capabilities.some((cap) => cap.field && cap.candidates.some((c) => c.name === "tickflow"))} onClick={() => applySource("tickflow")}>切换到 TickFlow</button>
          </div>
          {plugins.map((plugin) => (
            <div key={plugin.name} className="rounded-lg border border-[var(--ds-color-border-default)] bg-[var(--ds-color-bg-muted)] p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ds-color-text-primary)]">{plugin.display_name || plugin.name}</div>
                  <div className="mt-1 text-xs text-[var(--ds-color-text-placeholder)]">{plugin.datasets?.join(" · ") || "未声明能力"}</div>
                </div>
                <span className={`badge shrink-0 ${plugin.available ? "badge-on" : "badge-off"}`}>
                  {plugin.available ? plugin.api_key_masked || "已就绪" : "未就绪"}
                </span>
              </div>
              <div className="text-xs text-[var(--ds-color-text-placeholder)]">{plugin.available ? `${capabilities.filter((cap) => cap.usable && cap.current === plugin.name).length} 项能力服务中` : plugin.status || "请配置 API Key"}</div>
              {plugin.api_key_env && (
                <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); savePluginKey.mutate(plugin.name); }}>
                  <input className="field min-w-0 flex-1" type="password" autoComplete="off" placeholder={`${plugin.api_key_env} API Key`} value={pluginKeys[plugin.name] ?? ""} onChange={(event) => setPluginKeys((keys) => ({ ...keys, [plugin.name]: event.target.value }))} />
                  <button className="btn btn-primary shrink-0" disabled={!pluginKeys[plugin.name]?.trim() || savePluginKey.isPending}>保存并探测</button>
                  {plugin.api_key_masked && <button className="btn btn-ghost shrink-0" type="button" onClick={() => clearPluginKey.mutate(plugin.name)} disabled={clearPluginKey.isPending}>清除</button>}
                </form>
              )}
              <button className="btn btn-primary" type="button" disabled={!plugin.available || switchProviders.isPending || !capabilities.some((cap) => cap.field && cap.candidates.some((c) => c.name === plugin.name))} onClick={() => applySource(plugin.name)}>{plugin.available ? `切换到 ${plugin.display_name || plugin.name}` : "先配置 API Key"}</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--ds-color-text-primary)]">能力路由</h2>
          <p className="mt-1 text-xs text-[var(--ds-color-text-placeholder)]">当前生效源与可切换源；未就绪或档位不足的能力不提供切换选项。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map((cap) => (
            <div key={cap.id} className="rounded-lg border border-[var(--ds-color-border-default)] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-[var(--ds-color-text-primary)]">{cap.label}</span>
                <span className={cap.usable ? "text-[var(--ds-color-text-secondary)]" : "text-amber-400"}>当前：{cap.current_display}{cap.usable ? "" : "（不可用）"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {cap.candidates.map((candidate) => (
                  <button key={candidate.name} type="button" className={`btn ${cap.current === candidate.name ? "btn-primary" : "btn-ghost"}`} disabled={!cap.field || switchProviders.isPending} onClick={() => cap.field && cap.current !== candidate.name && switchProviders.mutate({ [cap.field]: candidate.name })}>
                    {cap.current === candidate.name ? `当前：${candidate.display}` : `切换到 ${candidate.display}`}
                  </button>
                ))}
                {cap.pending.map((candidate) => <span key={candidate.name} className="badge badge-off" title={candidate.note}>{candidate.display} 未就绪</span>)}
                {!cap.candidates.length && !cap.pending.length && <span className="text-xs text-[var(--ds-color-text-placeholder)]">暂无可用源</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
