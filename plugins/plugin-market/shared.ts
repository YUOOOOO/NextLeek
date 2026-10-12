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
}

export interface InstalledPlugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  dependencyErrors?: string[]
  dataSources?: DataSourceDeclaration[]
  requires?: CapabilityRequirement[]
  authenticatedSources?: string[]
}

export interface OpenPlugin { id: string; name: string; html: string; session: string }
export interface MarketRuntimeSummary { version: string; platform: string; mode: 'desktop'; status: 'ready'; installed: number; enabled: number }
