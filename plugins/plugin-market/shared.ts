export interface DataSourceMethod {
  name: string
  method: 'GET' | 'POST'
  path: string
  timeoutMs: number
  parameters?: Record<string, 'string' | 'number' | 'boolean'>
}

export interface DataSourceDeclaration {
  id: string
  version: string
  baseUrl: string
  methods: DataSourceMethod[]
  authentication?: { path: string; passwordField: string; cookieName: string }
}

export interface SourceAuthentication {
  cookie: string
  expiresAt: number | null
}

export interface CapabilityRequirement {
  sourcePluginId: string
  sourceId: string
  minVersion: string
  methods: string[]
}

export interface MarketCommandDeclaration {
  id: string
  title: string
  description?: string
  keywords: string[]
}
export interface MarketManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  minCreatorVersion: string
  permissions: string[]
  capabilities?: string[]
  dataSources?: DataSourceDeclaration[]
  requires?: CapabilityRequirement[]
  commands?: MarketCommandDeclaration[]
  entry: string
}

export interface MarketEntry {
  id: string
  name: string
  version: string
  description: string
  author: string
  sha256: string
  packageUrl: string
  minCreatorVersion: string
  permissions: string[]
  dataSources?: DataSourceDeclaration[]
  requires?: CapabilityRequirement[]
  commands?: MarketCommandDeclaration[]
}

export interface InstalledPlugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  deploymentManaged?: boolean
  dependencyErrors?: string[]
  dataSources?: DataSourceDeclaration[]
  requires?: CapabilityRequirement[]
  commands?: MarketCommandDeclaration[]
  authenticatedSources?: string[]
}

// html 仅保留宿主静态验证合同；客户端必须用 session 定位原生视图，不执行该文档。
export interface OpenPlugin { id: string; name: string; html: string; session: string; commandId?: string }
export interface MarketRuntimeSummary { version: string; platform: string; mode: 'desktop'; status: 'ready'; installed: number; enabled: number }

export interface RunningPlugin { id: string; name: string; session: string }
export interface MarketExportResult { path: string; count: number }
export interface MarketDownloadProgress {
  pluginName: string
  taskId: string
  status: 'downloading' | 'installing' | 'success' | 'error' | 'cancelled'
  progress: number | null
  receivedBytes?: number
  totalBytes?: number
  error?: string
}
