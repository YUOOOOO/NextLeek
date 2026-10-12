/** 市场已发布版本的更新日志，不包含审核记录和提交者信息。 */
export interface PluginReleaseHistoryItem {
  id: number
  pluginName: string
  version: string
  sourceType: 'open_source' | 'closed_source'
  releaseNotes: string
  releaseUrl?: string
  publishedAt: number
}

export interface PluginReleaseHistoryResult {
  name: string
  currentVersion: string
  items: PluginReleaseHistoryItem[]
  error?: string
  nextOffset?: number
}
