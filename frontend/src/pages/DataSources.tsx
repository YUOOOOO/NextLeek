import { FormEvent, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, CustomSourceConfig, DataProviders } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "../lib/useAuth";

const PROVIDER_FIELDS: Array<{ key: keyof DataProviders; label: string }> = [
  { key: "daily_data_provider", label: "日K" },
  { key: "adj_factor_provider", label: "除权因子" },
  { key: "realtime_data_provider", label: "实时行情" },
  { key: "minute_data_provider", label: "分钟K" },
  { key: "full_minute_data_provider", label: "全量分钟" },
  { key: "financial_data_provider", label: "财务" },
  { key: "depth5_data_provider", label: "五档盘口" },
];

const EMPTY_SOURCE: CustomSourceConfig = {
  name: "",
  display_name: "",
  auth: { type: "none", token_env: "", header: "Authorization", param: "token" },
  datasets: {
    daily: {
      url: "http://127.0.0.1:3021/daily",
      method: "POST",
      batch: 100,
      rpm: 200,
      response_path: "data",
      field_map: {
        ts_code: "symbol",
        trade_date: "date",
        open: "open",
        high: "high",
        low: "low",
        close: "close",
        vol: "volume",
        amt: "amount",
      },
    },
  },
};

export function DataSources() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [source, setSource] = useState<CustomSourceConfig>(EMPTY_SOURCE);
  const [datasetsJson, setDatasetsJson] = useState(JSON.stringify(EMPTY_SOURCE.datasets, null, 2));
  const [testDataset, setTestDataset] = useState("daily");
  const [testResult, setTestResult] = useState("");

  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.tickflowSettings });
  const prefs = useQuery({ queryKey: queryKeys.preferences, queryFn: api.preferences });
  const sources = useQuery({ queryKey: queryKeys.dataSources, queryFn: api.dataSources });

  const providerOptions = useMemo(() => {
    const names: Record<string, true> = { tickflow: true };
    for (const item of sources.data?.custom ?? []) names[item.name] = true;
    for (const item of (sources.data?.plugins as Array<{ name?: string }> | undefined) ?? []) {
      if (item?.name) names[item.name] = true;
    }
    return Object.keys(names);
  }, [sources.data]);

  const datasetNames = useMemo(() => {
    try {
      return Object.keys(JSON.parse(datasetsJson || "{}") as Record<string, unknown>);
    } catch {
      return [];
    }
  }, [datasetsJson]);
  const saveKey = useMutation({
    mutationFn: () => api.saveTickflowKey(apiKey),
    onSuccess: async () => {
      setApiKey("");
      setError("");
      await qc.invalidateQueries({ queryKey: queryKeys.settings });
      await qc.invalidateQueries({ queryKey: queryKeys.capabilityMatrix });
    },
    onError: (err: Error) => setError(err.message),
  });
  const clearKey = useMutation({
    mutationFn: api.clearTickflowKey,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.settings });
      await qc.invalidateQueries({ queryKey: queryKeys.capabilityMatrix });
    },
    onError: (err: Error) => setError(err.message),
  });
  const updateProviders = useMutation({
    mutationFn: api.updateDataProviders,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.preferences });
      await qc.invalidateQueries({ queryKey: queryKeys.capabilityMatrix });
    },
    onError: (err: Error) => setError(err.message),
  });
  const saveSource = useMutation({
    mutationFn: async () => {
      const datasets = JSON.parse(datasetsJson) as CustomSourceConfig["datasets"];
      return api.saveDataSource({ ...source, datasets });
    },
    onSuccess: async () => {
      setError("");
      await qc.invalidateQueries({ queryKey: queryKeys.dataSources });
    },
    onError: (err: Error) => setError(err.message),
  });
  const deleteSource = useMutation({
    mutationFn: (name: string) => api.deleteDataSource(name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.dataSources });
      await qc.invalidateQueries({ queryKey: queryKeys.preferences });
    },
    onError: (err: Error) => setError(err.message),
  });
  const reloadSources = useMutation({
    mutationFn: api.reloadDataSources,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.dataSources });
    },
    onError: (err: Error) => setError(err.message),
  });
  const testSource = useMutation({
    mutationFn: async () => {
      const datasets = JSON.parse(datasetsJson) as CustomSourceConfig["datasets"];
      return api.testDataSource({
        provider: source.name || "draft",
        dataset: testDataset,
        config: { ...source, datasets },
      });
    },
    onSuccess: (payload) => setTestResult(JSON.stringify(payload, null, 2)),
    onError: (err: Error) => setError(err.message),
  });

  async function loadSource(name: string) {
    const cfg = await api.getDataSource(name);
    setSource({
      name: cfg.name,
      display_name: cfg.display_name ?? "",
      auth: cfg.auth ?? { type: "none" },
      datasets: cfg.datasets ?? {},
    });
    setDatasetsJson(JSON.stringify(cfg.datasets ?? {}, null, 2));
  }

  function onSaveKey(event: FormEvent) {
    event.preventDefault();
    saveKey.mutate();
  }
  if (!me.data || me.data.role !== "admin") {
    return me.isLoading ? null : <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5">
      {error && <div className="card px-4 py-3 text-sm text-[#f87171]">{error}</div>}

      <section className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-[var(--ds-color-text-primary)]">TickFlow</div>
            <div className="text-xs text-[var(--ds-color-text-placeholder)]">
              {settings.data?.tier_label ?? "—"} · {settings.data?.mode ?? "none"} · {settings.data?.current_endpoint}
            </div>
          </div>
          <span className={`badge ${settings.data?.has_tickflow_key ? "badge-on" : "badge-off"}`}>
            {settings.data?.has_tickflow_key ? settings.data.tickflow_api_key_masked : "无 Key"}
          </span>
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={onSaveKey}>
          <input
            className="field flex-1 min-w-[220px]"
            type="password"
            placeholder="TickFlow API Key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button className="btn btn-primary" disabled={!apiKey || saveKey.isPending}>
            保存并探测
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => clearKey.mutate()} disabled={clearKey.isPending}>
            清除
          </button>
        </form>
        {!!settings.data?.probe_log?.length && (
          <pre className="text-[11px] text-[var(--ds-color-text-placeholder)] whitespace-pre-wrap">
            {settings.data.probe_log.join("\n")}
          </pre>
        )}
      </section>

      <section className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-[var(--ds-color-text-primary)]">能力路由</div>
          <button className="btn btn-ghost" onClick={() => reloadSources.mutate()}>
            重新加载 YAML
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {PROVIDER_FIELDS.map((field) => (
            <label key={field.key} className="text-xs text-[var(--ds-color-text-placeholder)]">
              {field.label}
              <select
                className="field mt-1"
                value={String(prefs.data?.[field.key] ?? "tickflow")}
                onChange={(event) => updateProviders.mutate({ [field.key]: event.target.value })}
              >
                {providerOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 text-xs font-medium text-[var(--ds-color-text-placeholder)]">已加载源</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(sources.data?.builtin ?? []).map((item) => (
              <tr key={`b-${item.name}`}>
                <td>{item.display_name}</td>
                <td>内置</td>
                <td />
              </tr>
            ))}
            {(sources.data?.custom ?? []).map((item) => (
              <tr key={`c-${item.name}`}>
                <td>{item.display_name || item.name}</td>
                <td>自定义</td>
                <td className="space-x-3">
                  <button className="btn-quiet" onClick={() => void loadSource(item.name)}>
                    编辑
                  </button>
                  <button className="btn-quiet" onClick={() => deleteSource.mutate(item.name)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4 space-y-3">
        <div className="text-sm text-[var(--ds-color-text-primary)]">自定义数据源</div>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="field"
            placeholder="name"
            value={source.name}
            onChange={(event) => setSource({ ...source, name: event.target.value })}
          />
          <input
            className="field"
            placeholder="display_name"
            value={source.display_name}
            onChange={(event) => setSource({ ...source, display_name: event.target.value })}
          />
          <select
            className="field"
            value={source.auth?.type ?? "none"}
            onChange={(event) => setSource({ ...source, auth: { ...source.auth, type: event.target.value } })}
          >
            <option value="none">none</option>
            <option value="bearer">bearer</option>
            <option value="header">header</option>
            <option value="query">query</option>
          </select>
          <input
            className="field"
            placeholder="token_env"
            value={source.auth?.token_env ?? ""}
            onChange={(event) => setSource({ ...source, auth: { ...source.auth, token_env: event.target.value } })}
          />
        </div>
        <textarea
          className="field h-56 py-2 font-mono text-xs"
          value={datasetsJson}
          onChange={(event) => setDatasetsJson(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <select className="field w-36" value={testDataset} onChange={(event) => setTestDataset(event.target.value)}>
            {datasetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost" type="button" onClick={() => testSource.mutate()} disabled={testSource.isPending}>
            试拉
          </button>
          <button className="btn btn-primary" type="button" onClick={() => saveSource.mutate()} disabled={!source.name || saveSource.isPending}>
            保存 YAML
          </button>
        </div>
        {testResult && <pre className="text-[11px] text-[var(--ds-color-text-placeholder)] whitespace-pre-wrap">{testResult}</pre>}
      </section>
    </div>
  );
}
