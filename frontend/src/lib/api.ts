export type UserRole = "admin" | "user";

export type User = {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SetupStatus = {
  configured: boolean;
};

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie("nextleek_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : `请求失败 (${response.status})`;
    throw new Error(detail);
  }
  return payload as T;
}

export type TableStats = {
  rows?: number;
  symbols?: number;
  min_date?: string | null;
  max_date?: string | null;
  days?: number;
  fields?: string[];
  [key: string]: unknown;
} | null;

export type DataStatus = {
  daily: TableStats;
  enriched: TableStats;
  index_daily: TableStats;
  index_enriched: TableStats;
  index_instruments: TableStats;
  etf_daily: TableStats;
  etf_enriched: TableStats;
  etf_instruments: TableStats;
  minute: TableStats;
  adj_factor: TableStats;
  instruments: TableStats;
  financials: TableStats;
  storage: Record<string, unknown>;
  next_instruments_run?: string | null;
  next_pipeline_run?: string | null;
  last_instruments_run?: string | null;
  last_pipeline_run?: string | null;
  checked_at?: string;
  indicators_ready?: boolean;
};

export type PipelineJob = {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  stage?: string;
  progress?: number;
  stage_pct?: number;
  msg?: string;
  log?: Array<{ ts?: string; stage?: string; msg?: string; pct?: number }>;
  error?: string | null;
  result?: Record<string, unknown>;
  started_at?: string | null;
  finished_at?: string | null;
};

export type TickflowSettings = {
  mode: string;
  tickflow_api_key_masked: string;
  has_tickflow_key: boolean;
  tier_label: string;
  current_endpoint: string;
  probe_log: string[];
  missing_caps: string[];
  extras_caps: string[];
};

export type DataProviders = {
  daily_data_provider: string;
  adj_factor_provider: string;
  minute_data_provider: string;
  full_minute_data_provider: string;
  depth5_data_provider: string;
  realtime_data_provider: string;
  financial_data_provider: string;
};

export type CustomSourceConfig = {
  name: string;
  display_name?: string;
  auth?: {
    type?: string;
    token_env?: string | null;
    header?: string;
    param?: string;
  };
  datasets?: Record<string, Record<string, unknown>>;
};

export const api = {
  health: () => request<{ status: string; version: string }>("/api/health"),
  authStatus: () => request<SetupStatus>("/api/auth/status"),
  me: () => request<User>("/api/auth/me"),
  setup: (body: { email: string; username: string; password: string }) =>
    request<{ user: User }>("/api/auth/setup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  listUsers: () => request<User[]>("/api/users"),
  createUser: (body: { email: string; username: string; password: string; role: UserRole }) =>
    request<User>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: { username?: string; role?: UserRole; is_active?: boolean }) =>
    request<User>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetPassword: (id: string, password: string) =>
    request<User>(`/api/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  deleteUser: (id: string) => request<void>(`/api/users/${id}`, { method: "DELETE" }),

  dataStatus: () => request<DataStatus>("/api/data/status"),
  dataClear: () => request<{ deleted_files: number }>("/api/data/clear", { method: "POST" }),
  dataSchema: (table: string) => request<Array<{ name: string; type: string; desc?: string }>>(`/api/data/schema/${table}`),
  dataRefreshCache: () => request<{ ok: boolean }>("/api/data/refresh-cache", { method: "POST" }),

  pipelineRun: () => request<{ job_id: string; reused: boolean }>("/api/pipeline/run", { method: "POST" }),
  pipelineJobs: (limit = 15) => request<{ jobs: PipelineJob[] }>(`/api/pipeline/jobs?limit=${limit}`),
  pipelineJob: (id: string) => request<PipelineJob>(`/api/pipeline/jobs/${id}`),
  pipelineJobCancel: (id: string) => request<{ cancelled: string }>(`/api/pipeline/jobs/${id}/cancel`, { method: "POST" }),

  extendHistory: (value: number, unit: "day" | "month" | "year") =>
    request<{ status: string; job_id: string }>("/api/kline/extend_history", {
      method: "POST",
      body: JSON.stringify({ value, unit }),
    }),
  repairDaily: (start_date: string) =>
    request<{ status: string; job_id: string }>("/api/kline/repair_daily", {
      method: "POST",
      body: JSON.stringify({ start_date }),
    }),
  rebuildEnriched: () =>
    request<{ status: string; job_id: string }>("/api/kline/rebuild_enriched", { method: "POST" }),
  syncIndexDaily: (days: number) =>
    request<unknown>(`/api/index/sync_daily?days=${days}`, { method: "POST" }),

  tickflowSettings: () => request<TickflowSettings>("/api/settings"),
  saveTickflowKey: (api_key: string) =>
    request<TickflowSettings>("/api/settings/tickflow-key", { method: "POST", body: JSON.stringify({ api_key }) }),
  clearTickflowKey: () => request<TickflowSettings>("/api/settings/tickflow-key", { method: "DELETE" }),
  switchEndpoint: (url: string) =>
    request<unknown>("/api/settings/switch_endpoint", { method: "POST", body: JSON.stringify({ url }) }),
  listEndpoints: () => request<{ endpoints?: Array<{ url: string; name?: string }> } | Record<string, unknown>>("/api/settings/endpoints"),
  preferences: () => request<Record<string, unknown>>("/api/settings/preferences"),
  dataSources: () =>
    request<{
      builtin: Array<{ name: string; display_name: string; datasets: string[] }>;
      plugins: unknown[];
      custom: Array<{ name: string; display_name?: string; datasets?: string[] }>;
      errors: unknown;
      config_dir: string;
    }>("/api/settings/data-sources"),
  getDataSource: (name: string) => request<CustomSourceConfig>(`/api/settings/data-sources/${name}`),
  saveDataSource: (body: CustomSourceConfig) =>
    request<unknown>("/api/settings/data-sources", { method: "POST", body: JSON.stringify(body) }),
  deleteDataSource: (name: string) => request<unknown>(`/api/settings/data-sources/${name}`, { method: "DELETE" }),
  reloadDataSources: () => request<unknown>("/api/settings/data-sources/reload", { method: "POST" }),
  testDataSource: (body: { provider: string; dataset: string; symbols?: string[]; config?: CustomSourceConfig }) =>
    request<unknown>("/api/settings/data-sources/test", { method: "POST", body: JSON.stringify(body) }),
  capabilityMatrix: () => request<Record<string, unknown>>("/api/settings/capability-matrix"),
  updateDataProviders: (body: Partial<DataProviders>) =>
    request<DataProviders>("/api/settings/preferences/data-providers", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  updatePipelineSchedule: (hour: number, minute: number) =>
    request<unknown>("/api/settings/preferences/pipeline-schedule", {
      method: "PUT",
      body: JSON.stringify({ hour, minute }),
    }),
  updateInstrumentsSchedule: (hour: number, minute: number) =>
    request<unknown>("/api/settings/preferences/instruments-schedule", {
      method: "PUT",
      body: JSON.stringify({ hour, minute }),
    }),
  updatePipelinePullTypes: (body: {
    pipeline_pull_a_share?: boolean;
    pipeline_pull_etf?: boolean;
    pipeline_pull_index?: boolean;
  }) =>
    request<unknown>("/api/settings/preferences/pipeline-pull-types", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  updateMinuteSync: (body: {
    minute_sync_enabled: boolean;
    minute_sync_days?: number;
    minute_sync_segment_days?: number | null;
  }) =>
    request<unknown>("/api/settings/preferences/minute-sync", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  updateRealtimeQuotes: (realtime_quotes_enabled: boolean) =>
    request<unknown>("/api/settings/preferences/realtime-quotes", {
      method: "PUT",
      body: JSON.stringify({ realtime_quotes_enabled }),
    }),
};
