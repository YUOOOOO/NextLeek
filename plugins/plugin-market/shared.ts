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
}

export interface InstalledPlugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
}

export interface OpenPlugin { id: string; name: string; html: string }
export interface MarketRuntimeSummary { version: string; platform: string; mode: 'desktop'; status: 'ready'; installed: number; enabled: number }
