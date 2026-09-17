import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, DataStatus, PipelineJob, TableStats } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

const TABLES: Array<{ key: keyof DataStatus; label: string }> = [
  { key: "instruments", label: "个股维表" },
  { key: "daily", label: "日K" },
  { key: "adj_factor", label: "除权因子" },
  { key: "enriched", label: "Enriched" },
  { key: "index_instruments", label: "指数维表" },
  { key: "index_daily", label: "指数日K" },
  { key: "index_enriched", label: "指数 Enriched" },
  { key: "etf_instruments", label: "ETF 维表" },
  { key: "etf_daily", label: "ETF 日K" },
  { key: "etf_enriched", label: "ETF Enriched" },
  { key: "minute", label: "分钟K" },
  { key: "financials", label: "财务" },
];

function fmt(value: unknown) {
  if (value == null || value === "") return "—";
  return String(value);
}

function tableRows(stats: TableStats) {
  if (!stats) return "无数据";
  if (typeof stats.rows === "number") return stats.rows.toLocaleString();
  if (typeof stats.symbols === "number") return `${stats.symbols.toLocaleString()} 只`;
  return "有";
}

function tableRange(stats: TableStats) {
  if (!stats) return "—";
  const min = stats.min_date ?? stats.days;
  const max = stats.max_date;
  if (min && max) return `${fmt(min)} → ${fmt(max)}`;
  if (min) return fmt(min);
  return "—";
}

export function Data() {
  const qc = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [extendValue, setExtendValue] = useState(6);
  const [extendUnit, setExtendUnit] = useState<"day" | "month" | "year">("month");
  const [repairDate, setRepairDate] = useState("");
  const [error, setError] = useState("");

  const status = useQuery({
    queryKey: queryKeys.dataStatus,
    queryFn: api.dataStatus,
    refetchInterval: (query) => {
      if (activeJobId || query.state.data?.indicators_ready === false) return 2000;
      return 30000;
    },
  });
  const prefs = useQuery({ queryKey: queryKeys.preferences, queryFn: api.preferences });
  const history = useQuery({
    queryKey: queryKeys.pipelineJobs,
    queryFn: () => api.pipelineJobs(15),
    refetchInterval: activeJobId ? false : 60000,
  });
  const job = useQuery({
    queryKey: queryKeys.pipelineJob(activeJobId ?? ""),
    queryFn: () => api.pipelineJob(activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: (q) => {
      const current = q.state.data as PipelineJob | undefined;
      return current && (current.status === "succeeded" || current.status === "failed") ? false : 1000;
    },
  });

  function attachJob(id: string) {
    setActiveJobId(id);
    setError("");
  }

  const startSync = useMutation({
    mutationFn: api.pipelineRun,
    onSuccess: ({ job_id }) => attachJob(job_id),
    onError: (err: Error) => setError(err.message),
  });
  const stopSync = useMutation({
    mutationFn: () => api.pipelineJobCancel(activeJobId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pipelineJob(activeJobId!) }),
    onError: (err: Error) => setError(err.message),
  });
  const clearData = useMutation({
    mutationFn: api.dataClear,
    onSuccess: async () => {
      await qc.invalidateQueries();
    },
    onError: (err: Error) => setError(err.message),
  });
  const extendHistory = useMutation({
    mutationFn: () => api.extendHistory(extendValue, extendUnit),
    onSuccess: ({ job_id }) => attachJob(job_id),
    onError: (err: Error) => setError(err.message),
  });
  const repairDaily = useMutation({
    mutationFn: () => api.repairDaily(repairDate),
    onSuccess: ({ job_id }) => attachJob(job_id),
    onError: (err: Error) => setError(err.message),
  });
  const rebuild = useMutation({
    mutationFn: api.rebuildEnriched,
    onSuccess: ({ job_id }) => attachJob(job_id),
    onError: (err: Error) => setError(err.message),
  });
  const updateSchedule = useMutation({
    mutationFn: ({ hour, minute }: { hour: number; minute: number }) => api.updatePipelineSchedule(hour, minute),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.preferences });
      await qc.invalidateQueries({ queryKey: queryKeys.dataStatus });
    },
    onError: (err: Error) => setError(err.message),
  });
  const updateInstSchedule = useMutation({
    mutationFn: ({ hour, minute }: { hour: number; minute: number }) =>
      api.updateInstrumentsSchedule(hour, minute),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.preferences });
      await qc.invalidateQueries({ queryKey: queryKeys.dataStatus });
    },
    onError: (err: Error) => setError(err.message),
  });
  const updatePull = useMutation({
    mutationFn: api.updatePipelinePullTypes,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.preferences });
    },
    onError: (err: Error) => setError(err.message),
  });
  const updateMinute = useMutation({
    mutationFn: api.updateMinuteSync,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.preferences });
    },
    onError: (err: Error) => setError(err.message),
  });
  const updateRealtime = useMutation({
    mutationFn: api.updateRealtimeQuotes,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.preferences });
    },
    onError: (err: Error) => setError(err.message),
  });

  useEffect(() => {
    const current = job.data;
    if (!current) return;
    if (current.status === "succeeded" || current.status === "failed") {
      void qc.invalidateQueries({ queryKey: queryKeys.dataStatus });
      void qc.invalidateQueries({ queryKey: queryKeys.pipelineJobs });
      const timer = setTimeout(() => setActiveJobId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [job.data, qc]);

  const pipelineSched = (prefs.data?.pipeline_schedule as { hour: number; minute: number } | undefined) ?? {
    hour: 15,
    minute: 30,
  };
  const instrumentsSched = (prefs.data?.instruments_schedule as { hour: number; minute: number } | undefined) ?? {
    hour: 9,
    minute: 10,
  };
  const storage = status.data?.storage as Record<string, number | string> | undefined;
  const latestLog = useMemo(() => {
    const logs = job.data?.log ?? [];
    return logs.length ? logs[logs.length - 1] : null;
  }, [job.data]);

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">数据</h1>
          <p className="page-desc">盘后管道、历史扩展、修正与本地 Parquet 画像。逻辑与 TSP 一致，未裁剪取数阶段。</p>
        </div>
        <div className="flex gap-2">
          <Link to="/settings/data" className="btn btn-ghost">
            数据源
          </Link>
          <button className="btn btn-primary" disabled={startSync.isPending} onClick={() => startSync.mutate()}>
            {startSync.isPending ? "启动中…" : "同步"}
          </button>
        </div>
      </div>

      {error && <div className="card px-4 py-3 text-sm text-[#f87171]">{error}</div>}

      <div className="kpi-strip">
        <div className="kpi-cell">
          <div className="kpi-label">个股</div>
          <div className="kpi-value">{tableRows(status.data?.instruments ?? null)}</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">日K 区间</div>
          <div className="kpi-value truncate">{tableRange(status.data?.daily ?? null)}</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">指标缓存</div>
          <div className="kpi-value">{status.data?.indicators_ready === false ? "预热中" : "就绪"}</div>
        </div>
      </div>

      {job.data && (
        <section className="card p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-[var(--ds-color-text-primary)]">
                {job.data.stage} · {job.data.progress ?? 0}%
              </div>
              <div className="text-xs text-[var(--ds-color-text-placeholder)]">
                {latestLog?.msg ?? job.data.msg ?? job.data.status}
              </div>
            </div>
            {(job.data.status === "pending" || job.data.status === "running") && (
              <button className="btn btn-danger" onClick={() => stopSync.mutate()} disabled={stopSync.isPending}>
                停止
              </button>
            )}
            {job.data.status === "failed" && <span className="badge badge-off">失败</span>}
            {job.data.status === "succeeded" && <span className="badge badge-on">完成</span>}
          </div>
          {job.data.error && <div className="text-xs text-[#f87171]">{job.data.error}</div>}
        </section>
      )}

      <section className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>数据集</th>
              <th>规模</th>
              <th>区间</th>
            </tr>
          </thead>
          <tbody>
            {TABLES.map((table) => {
              const stats = (status.data?.[table.key] as TableStats) ?? null;
              return (
                <tr key={table.key}>
                  <td>{table.label}</td>
                  <td>{tableRows(stats)}</td>
                  <td>{tableRange(stats)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card p-4 space-y-3">
        <div className="text-sm text-[var(--ds-color-text-primary)]">拉取范围 / 调度</div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(prefs.data?.pipeline_pull_a_share ?? true)}
              onChange={(event) => updatePull.mutate({ pipeline_pull_a_share: event.target.checked })}
            />
            A股日K
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(prefs.data?.pipeline_pull_etf ?? false)}
              onChange={(event) => updatePull.mutate({ pipeline_pull_etf: event.target.checked })}
            />
            ETF
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(prefs.data?.pipeline_pull_index ?? true)}
              onChange={(event) => updatePull.mutate({ pipeline_pull_index: event.target.checked })}
            />
            指数
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(prefs.data?.minute_sync_enabled ?? false)}
              onChange={(event) =>
                updateMinute.mutate({
                  minute_sync_enabled: event.target.checked,
                  minute_sync_days: Number(prefs.data?.minute_sync_days ?? 5),
                })
              }
            />
            分钟K
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(prefs.data?.realtime_quotes_enabled ?? false)}
              onChange={(event) => updateRealtime.mutate(event.target.checked)}
            />
            实时行情
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-[var(--ds-color-text-placeholder)]">
            盘后管道
            <input
              className="field mt-1"
              type="time"
              value={`${String(pipelineSched.hour).padStart(2, "0")}:${String(pipelineSched.minute).padStart(2, "0")}`}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(":").map(Number);
                updateSchedule.mutate({ hour, minute });
              }}
            />
            <div className="mt-1">下次 {fmt(status.data?.next_pipeline_run)} · 上次 {fmt(status.data?.last_pipeline_run)}</div>
          </label>
          <label className="text-xs text-[var(--ds-color-text-placeholder)]">
            盘前维表
            <input
              className="field mt-1"
              type="time"
              value={`${String(instrumentsSched.hour).padStart(2, "0")}:${String(instrumentsSched.minute).padStart(2, "0")}`}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(":").map(Number);
                updateInstSchedule.mutate({ hour, minute });
              }}
            />
            <div className="mt-1">下次 {fmt(status.data?.next_instruments_run)} · 上次 {fmt(status.data?.last_instruments_run)}</div>
          </label>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <div className="text-sm text-[var(--ds-color-text-primary)]">补数 / 修正 / 重算</div>
        <div className="flex flex-wrap items-end gap-2">
          <input
            className="field w-24"
            type="number"
            min={1}
            value={extendValue}
            onChange={(event) => setExtendValue(Number(event.target.value))}
          />
          <select className="field w-28" value={extendUnit} onChange={(event) => setExtendUnit(event.target.value as "day" | "month" | "year")}>
            <option value="day">天</option>
            <option value="month">月</option>
            <option value="year">年</option>
          </select>
          <button className="btn btn-ghost" onClick={() => extendHistory.mutate()} disabled={extendHistory.isPending}>
            向前扩展
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input className="field w-44" type="date" value={repairDate} onChange={(event) => setRepairDate(event.target.value)} />
          <button className="btn btn-ghost" onClick={() => repairDaily.mutate()} disabled={!repairDate || repairDaily.isPending}>
            从该日修正
          </button>
          <button className="btn btn-ghost" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
            重算 Enriched
          </button>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 text-xs font-medium text-[var(--ds-color-text-placeholder)]">同步历史</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>状态</th>
              <th>阶段</th>
              <th>进度</th>
              <th>开始</th>
            </tr>
          </thead>
          <tbody>
            {(history.data?.jobs ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.status}</td>
                <td>{item.stage}</td>
                <td>{item.progress ?? 0}%</td>
                <td>{fmt(item.started_at)}</td>
              </tr>
            ))}
            {!history.data?.jobs?.length && (
              <tr>
                <td colSpan={4}>暂无任务</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-[var(--ds-color-text-placeholder)]">
          存储 {fmt(storage?.total_mb ?? storage?.total)} MB
        </div>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm("清除全部本地 Parquet？不可恢复。")) clearData.mutate();
          }}
          disabled={clearData.isPending}
        >
          清除本地数据
        </button>
      </section>
    </div>
  );
}
