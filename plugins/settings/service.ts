import type { Context } from '@deepseek-ai/cordis'
import { writeFileSync } from 'node:fs'
import type { SettingsNative } from './native-contract'
import { SettingsDocuments } from './documents'
import { HttpServer } from './http-server'
import { createLocalShortcuts } from './local-shortcuts'
import type { SettingsPluginOptions } from './host'

const preferenceFields: Record<string, string> = {
  updatePlaceholder: 'placeholder', updateAvatar: 'avatar', updateAutoPaste: 'autoPaste', updateWindowPositionStrategy: 'windowPositionStrategy', updateShowRecentInSearch: 'showRecentInSearch', updateMatchRecommendation: 'showMatchRecommendation', updateLocalAppSearch: 'localAppSearch', updateRecentRows: 'recentRows', updatePinnedRows: 'pinnedRows', updateSearchMode: 'searchMode', updateSpaceOpenCommand: 'spaceOpenCommand', updateTabTarget: 'tabTargetCommand', updateTabKeyFunction: 'tabKeyFunction', updateFloatingBallDoubleClickCommand: 'floatingBallDoubleClickCommand', updateSearchWallpaper: 'searchWallpaper', setCompactMainWindowHeader: 'compactMainWindowHeader', updateGlobalShortcutConfig: 'globalShortcutConfig',
}

export function installSettingsEndpoints(ctx: Context, documents: SettingsDocuments, changed: (key: string, value: unknown) => void, options: SettingsPluginOptions): () => Promise<void> {
  const native = new Proxy({} as SettingsNative, { get(_target, key) {
    const capability = ctx.desktop.settingsNative
    if (!capability) throw new Error('Native settings unavailable')
    const handler: unknown = Reflect.get(capability, key)
    if (typeof handler !== 'function') throw new Error(`Native settings method unavailable: ${String(key)}`)
    return handler.bind(capability)
  } })
  const logEntries: Array<{ id: number; timestamp: number; level: string; source: string; message: string }> = []
  let logEnabled = false
  let logSubscribed = false
  let nextLogId = 0
  const persist = (key: string, value: unknown) => { documents.put(key, value); changed(key, value) }
  const localShortcuts = createLocalShortcuts(documents, changed, options)
  const http = new HttpServer({ get: key => documents.get(key), put: persist,
    show: text => native.showMainWindow(text), hide: () => ctx.desktop.hide(), toggle: () => native.toggleMainWindow(),
    async launch(body) {
      if (body.type && body.type !== 'text') throw new Error('Restricted packages accept declared text commands only')
      const command = ctx.commands.list().find(item => item.pluginId === body.pluginName && (item.id === body.code || item.id.endsWith(`.${String(body.code)}`)))
      if (!command) throw new Error('Plugin command is not registered')
      if (body.payload !== undefined && body.payload !== '') throw new Error('This command does not declare an external payload contract')
      return ctx.commands.run(command.id)
    },
  })
  let pendingStartup: Promise<void> | undefined
  let disposed = false
  // Cordis 并发释放独立 effect；HTTP 清理必须等待启动，防止关闭后又开始监听。
  ctx.effect(() => async () => {
    disposed = true
    try { await pendingStartup }
    finally { await http.stop() }
  }, 'settings HTTP service')
  ctx.effect(() => {
    const releases: Array<() => void> = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const original = console[level]
      const listener = (...args: unknown[]) => {
        original.apply(console, args)
        if (!logEnabled) return
        const entry = { id: ++nextLogId, timestamp: Date.now(), level, source: 'main', message: args.map(value => {
          if (typeof value === 'string') return value
          if (value instanceof Error) return value.stack || value.message
          try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
        }).join(' ') }
        logEntries.push(entry); if (logEntries.length > 1000) logEntries.shift()
        if (logSubscribed) ctx.desktop.emit({ type: 'source-event', name: 'log-entries', payload: [entry] })
      }
      console[level] = listener
      releases.push(() => { if (console[level] === listener) console[level] = original })
    }
    return () => { for (const release of releases) release() }
  }, 'settings debug log capture')
  ctx.pluginEndpoints.register(ctx, 'settings', async (method, input) => {
    const args = Array.isArray(input) ? input : []
    const value = args[0]
    if (method === 'selectPluginFile') {
      if (!options.dialogs) throw new Error('Native dialog unavailable')
      const result = await options.dialogs.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Trusted static plugin', extensions: ['nlplugin'] }] })
      return result.canceled || !result.filePaths[0] ? { success: false, canceled: true } : { success: true, filePath: result.filePaths[0] }
    }
    if (method === 'dbGet' || method === 'dbPut') {
      if (!input || typeof input !== 'object' || !('key' in input) || typeof input.key !== 'string') throw new TypeError('Invalid document request')
      if (method === 'dbGet') return documents.get(input.key)
      if (!('value' in input)) throw new TypeError('Document value is missing')
      persist(input.key, input.value); return true
    }
    if (method === 'getLocalShortcuts') return localShortcuts.getAll()
    if (method === 'openLocalShortcut') {
      if (!input || typeof input !== 'object' || !('path' in input) || typeof input.path !== 'string') throw new TypeError('Invalid shortcut request')
      return localShortcuts.invoke('open', [input.path])
    }
    if (method.startsWith('localShortcuts.')) return localShortcuts.invoke(method.slice(15), args)
    if (method === 'getSystemSettings') return native.getSystemSettings()
    if (method === 'launchSystemSetting') {
      const uri = input && typeof input === 'object' && 'uri' in input ? input.uri : value
      if (typeof uri !== 'string') throw new TypeError('System settings URI required')
      return native.launchSystemSetting(uri)
    }
    if (method === 'getCurrentShortcut') return ctx.storage.read().settings.hotkey
    if (method === 'getAppVersion') return options.version
    if (method === 'getPlatform') return process.platform
    if (method === 'updateShortcut') { await ctx.settings.update({ hotkey: String(value) }); return { success: true } }
    if (method === 'setTheme') { await ctx.settings.update({ theme: value as 'light' | 'dark' | 'system' }); return { success: true } }
    if (method === 'getLaunchAtLogin') return native.getLaunchAtLogin()
    if (method === 'setLaunchAtLogin') { await ctx.settings.update({ autostart: !!value }); return { success: true } }
    if (method === 'selectAvatar') return native.selectAvatar()
    if (method === 'selectSearchWallpaper') { const selected = await native.selectSearchWallpaper(); return { ...selected, url: selected.path } }
    if (method === 'getCurrentWindowInfo') return native.getCurrentWindowInfo()
    if (method === 'setWindowOpacity') return native.setWindowOpacity(Number(value))
    if (method === 'setWindowDefaultHeight') return native.setWindowDefaultHeight(Number(value))
    if (method === 'setWindowMaterial') return native.setWindowMaterial(value as 'mica' | 'acrylic' | 'none')
    if (method === 'setTrayIconVisible') return native.setTrayIconVisible(!!value)
    if (method === 'setProxyConfig') return native.setProxyConfig(value as Parameters<SettingsNative['setProxyConfig']>[0])
    if (method === 'setIgnoreHotkeysOnFullscreen') return native.setIgnoreHotkeysOnFullscreen(!!value)
    if (method === 'setFloatingBallEnabled') return native.setFloatingBallEnabled(!!value)
    if (method === 'setFloatingBallLetter') return native.setFloatingBallLetter(String(value))
    if (method === 'updateSuperPanelConfig') return native.updateSuperPanelConfig(value as Parameters<SettingsNative['updateSuperPanelConfig']>[0])
    if (method === 'updateClipboardConfig') return native.updateClipboardConfig(value as Parameters<SettingsNative['updateClipboardConfig']>[0])
    if (method === 'updateWakeupBlacklist') return native.updateWakeupBlacklist(value as Parameters<SettingsNative['updateWakeupBlacklist']>[0])
    if (method === 'updateSuperPanelBlockedApps') return native.updateSuperPanelBlockedApps(value as Parameters<SettingsNative['updateSuperPanelBlockedApps']>[0])
    if (method === 'updateAcrylicOpacity') return native.setAcrylicOpacity(Number(value), Number(args[1]))
    if (method === 'updatePrimaryColor') { const previous = documents.get('settings-general') as Record<string, unknown> | null; persist('settings-general', { ...previous, primaryColor: value, customColor: args[1] }); return { success: true } }
    if (preferenceFields[method]) { const previous = documents.get('settings-general') as Record<string, unknown> | null; persist('settings-general', { ...previous, [preferenceFields[method]]: value }); return { success: true } }
    if (method === 'notifyDisabledCommandsChanged' || method === 'updateCommandAliases') { ctx.desktop.emit({ type: 'source-event', name: method === 'updateCommandAliases' ? 'command-aliases-changed' : 'disabled-commands-changed' }); return }
    if (method === 'logEnable') { logEnabled = true; logSubscribed = true; return { success: true } }
    if (method === 'logDisable') { logEnabled = false; logSubscribed = false; return { success: true } }
    if (method === 'logIsEnabled') return logEnabled
    if (method === 'logGetBuffer') return [...logEntries]
    if (method === 'logSubscribe') { logSubscribed = true; return { success: true } }
    if (method === 'httpServerGetConfig') return { success: true, config: http.getConfig() }
    if (method === 'httpServerStatus') return { success: true, running: http.isRunning() }
    if (method === 'httpServerRegenerateKey') { const config = await http.saveConfig({ apiKey: http.generateApiKey() }); return { success: true, apiKey: config.apiKey } }
    if (method === 'httpServerSaveConfig') {
      const config = value as { enabled: boolean; port: number; apiKey: string }
      if (!config || typeof config.enabled !== 'boolean' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || typeof config.apiKey !== 'string' || config.apiKey.length < 16) throw new TypeError('Invalid HTTP service configuration')
      const previous = http.getConfig()
      await http.saveConfig(config)
      try { await http.stop(); if (config.enabled) await http.start() }
      catch (error) { await http.saveConfig(previous); if (previous.enabled) await http.start(); throw error }
      return { success: true, config: http.getConfig() }
    }
    if (method === 'getPluginReadme') return { success: false, error: '受信任静态 .nlplugin 包协议未声明 README 文档，无法提供该插件的说明文件。' }
    if (method === 'getPluginReleaseHistory') return { items: [], currentVersion: '', error: '受信任静态 .nlplugin 包协议未声明历史发布日志，无法提供版本历史。' }
    if (method === 'getPluginDataStats') return { success: true, data: [{ pluginName: 'ZTOOLS', pluginTitle: 'NextTools', isDevelopment: false, docCount: documents.keys().length, attachmentCount: 0, logo: null }] }
    if (method === 'getPluginDocKeys') { if (value !== 'ZTOOLS') throw new Error('受信任静态 .nlplugin 包未开放私有数据库检查接口；仅可查看宿主设置文档。'); return { success: true, data: documents.keys().map(key => ({ key, type: 'document' })) } }
    if (method === 'getPluginDoc' || method === 'deletePluginDoc' || method === 'exportPluginDoc') {
      if (value !== 'ZTOOLS') throw new Error('受信任静态 .nlplugin 包未开放私有数据库检查、导出或删除接口。')
      const key = String(args[1])
      if (method === 'getPluginDoc') return { success: true, data: documents.get(key), type: 'document' }
      if (method === 'deletePluginDoc') { documents.delete(key); changed(key, null); return { success: true } }
      if (!options.dialogs) throw new Error('Native dialog unavailable')
      const selection = await options.dialogs.showSaveDialog({ defaultPath: `${key}.json`, filters: [{ name: 'JSON document', extensions: ['json'] }] })
      if (selection.canceled || !selection.filePath) return { success: false, canceled: true }
      writeFileSync(selection.filePath, JSON.stringify(documents.get(key), null, 2)); return { success: true, filePath: selection.filePath }
    }
    if (method === 'clearPluginData') throw new Error(value === 'ZTOOLS' ? '不能清空宿主设置文档。' : '受信任静态 .nlplugin 包未开放清空私有数据库接口。')
    throw new Error(`Unknown settings method: ${method}`)
  })
  return () => {
    if (disposed) return Promise.reject(new Error('Settings service disposed'))
    return pendingStartup ??= (async () => {
    const stored = documents.get('settings-general')
    if (ctx.desktop.settingsNative && stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const preferences = stored as Record<string, unknown>
      if (typeof preferences.opacity === 'number') await native.setWindowOpacity(preferences.opacity)
      if (typeof preferences.windowDefaultHeight === 'number') await native.setWindowDefaultHeight(preferences.windowDefaultHeight)
      if (preferences.windowMaterial === 'mica' || preferences.windowMaterial === 'acrylic' || preferences.windowMaterial === 'none') await native.setWindowMaterial(preferences.windowMaterial)
      if (typeof preferences.showTrayIcon === 'boolean') await native.setTrayIconVisible(preferences.showTrayIcon)
      if (typeof preferences.ignoreHotkeysOnFullscreen === 'boolean') await native.setIgnoreHotkeysOnFullscreen(preferences.ignoreHotkeysOnFullscreen)
      if (typeof preferences.floatingBallEnabled === 'boolean') await native.setFloatingBallEnabled(preferences.floatingBallEnabled)
      if (typeof preferences.floatingBallLetter === 'string') await native.setFloatingBallLetter(preferences.floatingBallLetter)
      if (typeof preferences.acrylicLightOpacity === 'number' && typeof preferences.acrylicDarkOpacity === 'number') await native.setAcrylicOpacity(preferences.acrylicLightOpacity, preferences.acrylicDarkOpacity)
      if (typeof preferences.superPanelEnabled === 'boolean') await native.updateSuperPanelConfig({ enabled: preferences.superPanelEnabled, mouseButton: typeof preferences.superPanelMouseButton === 'string' ? preferences.superPanelMouseButton : 'middle', longPressMs: typeof preferences.superPanelLongPressMs === 'number' ? preferences.superPanelLongPressMs : 500 })
      if (typeof preferences.clipboardRetentionDays === 'number') await native.updateClipboardConfig({ retentionDays: preferences.clipboardRetentionDays })
      if (Array.isArray(preferences.wakeupBlacklist)) await native.updateWakeupBlacklist(preferences.wakeupBlacklist)
      if (Array.isArray(preferences.superPanelBlockedApps)) await native.updateSuperPanelBlockedApps(preferences.superPanelBlockedApps)
    }
    await http.init()
    })()
  }
}
