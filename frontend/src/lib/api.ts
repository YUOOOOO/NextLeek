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
  symbols_covered?: number;
  trading_days?: number;
  earliest_date?: string | null;
  latest_date?: string | null;
  latest_as_of?: string | null;
  min_date?: string | null;
  max_date?: string | null;
  days?: number;
  fields?: number | string[];
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

export type OverviewIndex = {
  symbol: string;
  name: string;
  last_price: number | null;
  change_pct: number | null;
  change_amount: number | null;
};

export type OverviewStock = {
  symbol: string;
  name?: string | null;
  close: number | null;
  change_pct: number | null;
  amount: number | null;
  turnover_rate: number | null;
  board?: string;
};

export type OverviewRankItem = {
  name: string;
  count: number;
  avg_pct: number;
  leader?: { symbol?: string | null; name?: string | null; change_pct?: number | null };
};

export type OverviewMarket = {
  as_of: string | null;
  quote_status: {
    enabled?: boolean;
    running?: boolean;
    quote_age_ms?: number | null;
    is_trading_hours?: boolean;
    mode?: string;
  };
  indices: OverviewIndex[];
  breadth: {
    total: number;
    up: number;
    down: number;
    flat: number;
    up_pct: number;
    down_pct: number;
    avg_pct?: number | null;
    median_pct?: number | null;
    strong_up?: number;
    strong_down?: number;
  };
  amount: { total: number; avg: number };
  limit: {
    limit_up: number;
    broken: number;
    limit_down: number;
    max_boards: number;
    seal_rate?: number;
    tiers: Array<{ boards: number; count: number; stocks?: Array<{ symbol: string; name?: string }> }>;
  };
  distribution: Array<{ label: string; count: number; pct: number }>;
  trend: {
    above_ma5_pct: number;
    above_ma20_pct: number;
    above_ma60_pct: number;
    new_high: number;
    new_low: number;
  };
  activity: { avg_turnover: number; high_turnover: number; high_vol_ratio: number; vol_ratio: number };
  radar: Array<{ key: string; label: string; value: number }>;
  emotion: { score: number; label: string };
  top_gainers: OverviewStock[];
  top_losers: OverviewStock[];
  turnover_leaders: OverviewStock[];
  active_leaders: OverviewStock[];
  concept_rank: { leading: OverviewRankItem[]; lagging: OverviewRankItem[] };
  industry_rank: { leading: OverviewRankItem[]; lagging: OverviewRankItem[] };
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
  ai_provider?: string;
  ai_base_url?: string;
  ai_api_key_masked?: string;
  has_ai_key?: boolean;
  ai_configured?: boolean;
  ai_model?: string;
  ai_openai_model?: string;
  ai_max_output_tokens?: number;
  ai_context_window?: number;
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

export type StrategyStatus = "draft" | "published";

export type StrategyCondition = {
  left: string;
  op: string;
  right: string | number;
  leftDays?: number;
  rightDays?: number;
};

export type StrategyBasicFilter = {
  price_min: number | null;
  price_max: number | null;
  market_cap_min: number | null;
  amount_min: number | null;
  exclude_st: boolean;
  boards: string[];
};

export type StrategyKind = "formula" | "conditions" | "composite";

export type StrategyChild = {
  strategy_id: string;
  name?: string;
  weight?: number;
};

export type StrategyWrite = {
  name: string;
  description: string;
  kind?: StrategyKind;
  formula?: string;
  conditions: StrategyCondition[];
  children?: StrategyChild[];
  merge_mode?: "union" | "intersect";
  min_confirm?: number;
  basic_filter: StrategyBasicFilter;
  order_by: string;
  descending: boolean;
  limit: number;
};

export type Strategy = {
  id: string;
  name: string;
  description: string;
  status: StrategyStatus;
  kind: StrategyKind;
  formula?: string;
  conditions: StrategyCondition[];
  children: StrategyChild[];
  merge_mode: "union" | "intersect";
  min_confirm: number;
  basic_filter: StrategyBasicFilter;
  order_by: string;
  descending: boolean;
  limit: number;
  owner_id: string;
  owner_username: string;
  subscriber_count: number;
  subscribed: boolean;
  is_owner: boolean;
  monitoring: boolean;
  version: number;
  has_unpublished_changes: boolean;
  update_available: boolean;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type StrategyCatalog = {
  mine: Strategy[];
  subscribed: Strategy[];
  market: Strategy[];
};

export type StrategyFieldGroup = {
  key: string;
  label: string;
  fields: Array<{ key: string; label: string }>;
};

export type FormulaExample = {
  label: string;
  formula: string;
  kind?: "factor" | "strategy";
  code?: string;
};

export type StrategyOptions = {
  fields: Array<{ key: string; label: string }>;
  groups: StrategyFieldGroup[];
  maxDays: number;
  operators: string[];
  stringOperators: string[];
  formula_operators?: string[];
  base_columns?: string[];
  examples?: FormulaExample[];
};

export type FormulaPreview = {
  ok: boolean;
  formula: string;
  warmup_bars: number;
  dependencies: string[];
  errors: Array<{ code?: string; message: string }>;
};

export type FactorStatus = "draft" | "published";

export type Factor = {
  id: string;
  code: string;
  name: string;
  description: string;
  formula: string;
  direction: "high" | "low" | "none";
  status: FactorStatus;
  owner_id: string;
  owner_username: string;
  subscriber_count: number;
  subscribed: boolean;
  is_owner: boolean;
  version: number;
  warmup_bars: number;
  has_unpublished_changes: boolean;
  update_available: boolean;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type FactorCatalog = {
  mine: Factor[];
  subscribed: Factor[];
  market: Factor[];
};

export type FactorWrite = {
  name: string;
  code?: string;
  description: string;
  formula: string;
  direction: "high" | "low" | "none";
};

export type StrategyResearchIn = {
  days?: number;
  horizon?: number;
  start?: string | null;
  end?: string | null;
  initial_capital?: number;
  commission_pct?: number;
  stamp_tax_pct?: number;
  slippage_bps?: number;
  max_positions?: number;
  max_exposure_pct?: number;
  holding_days?: number;
  entry_fill?: "close_t" | "open_t+1";
  exit_fill?: "close_t" | "open_t+1";
};

export type BacktestTrade = {
  symbol: string;
  name?: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  shares?: number;
  pnl?: number;
  pnl_pct?: number;
  hold_days?: number;
};

export type ResearchResult = {
  ok: boolean;
  warning?: string;
  formula?: string;
  days?: number;
  horizon?: number;
  ic?: number;
  ir?: number;
  avg_return?: number;
  hit_rate?: number;
  avg_names?: number;
  items?: Array<Record<string, unknown>>;
  start?: string;
  end?: string;
  initial_capital?: number;
  final_equity?: number;
  total_return?: number;
  annual_return?: number;
  max_drawdown?: number;
  sharpe?: number;
  win_rate?: number;
  trade_count?: number;
  equity_curve?: Array<{ date: string; value: number }>;
  trades?: BacktestTrade[];
};

export type StrategyRunResult = {
  as_of: string | null;
  strategy_id: string;
  rows: Array<Record<string, unknown>>;
  total: number;
  elapsed_ms: number;
  warnings: string[];
};

export type MonitorRow = {
  symbol: string;
  name: string;
  close?: number | null;
  change_pct?: number | null;
};

export type MonitorStrategy = {
  id: string;
  name: string;
  kind: StrategyKind;
  rows: MonitorRow[];
  total: number;
};

export type MonitorEvent = {
  ts: number;
  type: string;
  strategy_id?: string;
  symbol?: string;
  name?: string;
  message: string;
  price?: number | null;
  change_pct?: number | null;
};

export type MonitorSnapshot = {
  as_of: string | null;
  strategies: MonitorStrategy[];
  events: MonitorEvent[];
  watch_count: number;
  hit_count: number;
};

export type KlineDailyResponse = {
  symbol: string;
  name?: string | null;
  stock_info?: { name?: string | null; [key: string]: unknown };
  rows: Array<Record<string, unknown>>;
  source?: string;
};

export type FinancialStatus = {
  available: boolean;
  tables?: Record<string, { rows?: number; symbols?: number }>;
  last_sync?: Record<string, unknown>;
  syncing?: boolean;
};

export type FinancialMetricRecord = {
  symbol?: string;
  period_end?: string | null;
  [key: string]: unknown;
};


export const api = {
  health: () => request<{ status: string; version: string }>("/api/health"),
  authStatus: () => request<SetupStatus>("/api/auth/status"),
  me: () => request<User>("/api/auth/me"),
  setup: (body: { email: string; username: string; password: string }) =>
    request<{ user: User }>("/api/auth/setup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { account: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  changePassword: (body: { current_password: string; new_password: string }) =>
    request<User>("/api/auth/password", { method: "POST", body: JSON.stringify(body) }),
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
  overviewMarket: (asOf?: string) =>
    request<OverviewMarket>(asOf ? `/api/overview/market?as_of=${asOf}` : "/api/overview/market"),

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
    request<{ realtime_quotes_enabled: boolean; realtime_allowed?: boolean }>(
      "/api/settings/preferences/realtime-quotes",
      {
        method: "PUT",
        body: JSON.stringify({ realtime_quotes_enabled }),
      },
    ),

  strategyOptions: () => request<StrategyOptions>("/api/strategies/options"),
  listStrategies: () => request<StrategyCatalog>("/api/strategies"),
  createStrategy: (body: StrategyWrite) =>
    request<Strategy>("/api/strategies", { method: "POST", body: JSON.stringify(body) }),
  updateStrategy: (id: string, body: Partial<StrategyWrite>) =>
    request<Strategy>(`/api/strategies/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteStrategy: (id: string) => request<void>(`/api/strategies/${id}`, { method: "DELETE" }),
  publishStrategy: (id: string) => request<Strategy>(`/api/strategies/${id}/publish`, { method: "POST" }),
  unpublishStrategy: (id: string) => request<Strategy>(`/api/strategies/${id}/unpublish`, { method: "POST" }),
  subscribeStrategy: (id: string) => request<Strategy>(`/api/strategies/${id}/subscription`, { method: "POST" }),
  updateStrategySubscription: (id: string) =>
    request<Strategy>(`/api/strategies/${id}/subscription/update`, { method: "POST" }),
  unsubscribeStrategy: (id: string) => request<void>(`/api/strategies/${id}/subscription`, { method: "DELETE" }),
  runStrategy: (id: string) => request<StrategyRunResult>(`/api/strategies/${id}/run`, { method: "POST" }),
  startStrategyMonitor: (id: string) =>
    request<Strategy>(`/api/strategies/${id}/monitor`, { method: "POST" }),
  stopStrategyMonitor: (id: string) =>
    request<void>(`/api/strategies/${id}/monitor`, { method: "DELETE" }),
  compileStrategy: (formula: string) =>
    request<FormulaPreview>("/api/strategies/compile", { method: "POST", body: JSON.stringify({ formula }) }),
  generateStrategy: (prompt: string) =>
    request<{ name: string; formula: string; description: string; warmup_bars?: number; dependencies?: string[] }>(
      "/api/strategies/generate",
      { method: "POST", body: JSON.stringify({ prompt }) },
    ),
  mineStrategies: (body: { days?: number; horizon?: number } = {}) =>
    request<ResearchResult>("/api/strategies/mine", { method: "POST", body: JSON.stringify(body) }),
  researchStrategy: (id: string, body: StrategyResearchIn = {}) =>
    request<ResearchResult>(`/api/strategies/${id}/research`, { method: "POST", body: JSON.stringify(body) }),
  monitorSnapshot: () => request<MonitorSnapshot>("/api/monitor"),


  factorOptions: () => request<{ operators: string[]; base_columns: string[]; examples: FormulaExample[] }>("/api/factors/options"),
  listFactors: () => request<FactorCatalog>("/api/factors"),
  createFactor: (body: FactorWrite) => request<Factor>("/api/factors", { method: "POST", body: JSON.stringify(body) }),
  updateFactor: (id: string, body: Partial<FactorWrite>) =>
    request<Factor>(`/api/factors/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteFactor: (id: string) => request<void>(`/api/factors/${id}`, { method: "DELETE" }),
  publishFactor: (id: string) => request<Factor>(`/api/factors/${id}/publish`, { method: "POST" }),
  unpublishFactor: (id: string) => request<Factor>(`/api/factors/${id}/unpublish`, { method: "POST" }),
  subscribeFactor: (id: string) => request<Factor>(`/api/factors/${id}/subscription`, { method: "POST" }),
  updateFactorSubscription: (id: string) =>
    request<Factor>(`/api/factors/${id}/subscription/update`, { method: "POST" }),
  unsubscribeFactor: (id: string) => request<void>(`/api/factors/${id}/subscription`, { method: "DELETE" }),
  compileFactor: (formula: string) =>
    request<FormulaPreview>("/api/factors/compile", { method: "POST", body: JSON.stringify({ formula }) }),
  generateFactor: (prompt: string) =>
    request<{ name: string; formula: string; description: string; code?: string; direction?: string; warmup_bars?: number; dependencies?: string[] }>(
      "/api/factors/generate",
      { method: "POST", body: JSON.stringify({ prompt }) },
    ),
  mineFactors: (body: { days?: number; horizon?: number } = {}) =>
    request<ResearchResult>("/api/factors/mine", { method: "POST", body: JSON.stringify(body) }),
  researchFactor: (id: string, body: StrategyResearchIn = {}) =>
    request<ResearchResult>(`/api/factors/${id}/research`, { method: "POST", body: JSON.stringify(body) }),

  saveAiSettings: (body: {
    provider: string;
    base_url?: string;
    api_key?: string | null;
    model?: string;
    max_output_tokens?: number;
    context_window?: number;
  }) => request<TickflowSettings>("/api/settings/ai", { method: "POST", body: JSON.stringify(body) }),
  clearAiSettings: () => request<{ ok: boolean }>("/api/settings/ai", { method: "DELETE" }),
  klineDaily: (symbol: string, days = 250) =>
    request<KlineDailyResponse>(`/api/kline/daily?symbol=${encodeURIComponent(symbol)}&days=${days}`),
  financialStatus: () => request<FinancialStatus>("/api/financials/status"),
  financialMetrics: (symbol: string) =>
    request<{ data: FinancialMetricRecord[] }>(
      `/api/financials/metrics?symbol=${encodeURIComponent(symbol)}`,
    ),
};
