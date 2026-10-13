import type { App, BrowserWindow, Dialog, NativeImage, Session } from 'electron'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { release } from 'node:os'
import type { SettingsNative } from '../../../plugins/settings/native-contract'
import { getSystemSettings } from '../../../plugins/native-system-settings/host'

export type SettingsNativeBaseline = Pick<SettingsNative,
  'setWindowOpacity' | 'setWindowDefaultHeight' | 'setWindowMaterial' | 'setTrayIconVisible' |
  'setLaunchAtLogin' | 'getLaunchAtLogin' | 'setProxyConfig' | 'selectAvatar' |
  'selectSearchWallpaper' | 'setAcrylicOpacity' | 'getSystemSettings'>

export interface SettingsNativeEnvironment {
  window: BrowserWindow
  app: Pick<App, 'setLoginItemSettings' | 'getLoginItemSettings' | 'getPath'>
  session: Pick<Session, 'setProxy' | 'clearCache' | 'closeAllConnections'>
  // Include plugin and auxiliary partitions so proxy changes do not only affect the launcher.
  sessions?: () => Array<Pick<Session, 'setProxy' | 'clearCache' | 'closeAllConnections'>>
  dialog: Pick<Dialog, 'showOpenDialog'>
  nativeImage: { createFromPath(path: string): NativeImage }
  setTrayIconVisible(visible: boolean): void | Promise<void>
  setWindowDefaultHeight(height: number): void | Promise<void>
  broadcast(name: 'update-window-material' | 'update-acrylic-opacity', payload: unknown): void
  platform?: NodeJS.Platform
  osRelease?: string
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${name}`)
  return value
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${name}`)
  return value
}

// Only OS primitives live here. Persistence of settings documents and feature lifecycles stays in Cordis plugins.
export function createSettingsNativeBaseline(env: SettingsNativeEnvironment): SettingsNativeBaseline {
  const platform = env.platform ?? process.platform
  const liveWindow = () => {
    if (env.window.isDestroyed()) throw new Error('Settings window is no longer available')
    return env.window
  }
  const selectImage = async (wallpaper: boolean): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const window = liveWindow()
      const selected = await env.dialog.showOpenDialog(window, {
        title: wallpaper ? '选择主搜索窗口壁纸' : '选择头像图片',
        filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
        properties: ['openFile'],
      })
      if (!window.isDestroyed()) window.show()
      if (selected.canceled || selected.filePaths.length === 0) return { success: false, error: '未选择文件' }
      const originalPath = selected.filePaths[0]
      const info = await stat(originalPath)
      if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('请选择小于 32MB 的图片文件')
      let image = env.nativeImage.createFromPath(originalPath)
      if (image.isEmpty()) throw new Error('无法读取所选图片')
      const size = image.getSize()
      if (size.width <= 0 || size.height <= 0 || size.width * size.height > 100_000_000) throw new Error('所选图片尺寸无效或过大')
      if (wallpaper && size.width > 1920) image = image.resize({ width: 1920, quality: 'best' })
      if (image.isEmpty()) throw new Error('图片压缩失败')
      // Rasterize even SVG: data:image/png is safe under the renderer CSP and cannot retain external file references.
      const bytes = image.toPNG()
      if (!bytes.length) throw new Error('图片转换失败')
      const directory = join(env.app.getPath('userData'), 'settings', 'images')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, wallpaper ? 'search-wallpaper.png' : 'avatar.png'), bytes)
      // SettingsDocuments persists this data URL, so reloads never depend on file: access or a temporary path.
      return { success: true, path: `data:image/png;base64,${bytes.toString('base64')}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }
  return {
    setWindowOpacity(value) { liveWindow().setOpacity(Math.max(0.3, Math.min(1, finite(value, 'window opacity')))) },
    setWindowDefaultHeight(value) {
      const height = finite(value, 'window default height')
      if (height > 10000) throw new RangeError('Window default height is too large')
      return env.setWindowDefaultHeight(Math.max(200, Math.round(height)))
    },
    setWindowMaterial(value) {
      if (!['none', 'mica', 'acrylic'].includes(value)) throw new TypeError('Invalid window material')
      if (value !== 'none' && (platform !== 'win32' || !(Number((env.osRelease ?? release()).split('.')[2]) >= 22621))) throw new Error('Window material requires Windows 11 build 22621 or later')
      const window = liveWindow()
      window.setBackgroundMaterial(value)
      window.setBackgroundColor(value === 'none' ? '#f4f4f4' : '#00000000')
      env.broadcast('update-window-material', value)
    },
    setTrayIconVisible(value) { return env.setTrayIconVisible(boolean(value, 'tray visibility')) },
    setLaunchAtLogin(value) { env.app.setLoginItemSettings({ openAtLogin: boolean(value, 'launch at login'), openAsHidden: true }) },
    getLaunchAtLogin() { return env.app.getLoginItemSettings().openAtLogin },
    async setProxyConfig(value) {
      if (!value || typeof value !== 'object') throw new TypeError('Invalid proxy configuration')
      const enabled = boolean(value.enabled, 'proxy enabled')
      if (typeof value.url !== 'string' || value.url.length > 2048 || /[\r\n\0]/.test(value.url)) throw new TypeError('Invalid proxy URL')
      let rules = ''
      if (enabled) {
        const url = new URL(value.url)
        if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol) || !url.hostname || url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) throw new TypeError('Unsupported proxy URL')
        const port = url.port || (url.protocol === 'https:' ? '443' : url.protocol.startsWith('socks') ? '1080' : '80')
        rules = url.protocol.startsWith('socks') ? `${url.protocol}//${url.hostname}:${port}` : `${url.hostname}:${port}`
      }
      const sessions = new Set([env.session, ...(env.sessions?.() ?? [])])
      for (const session of sessions) {
        if (enabled) await session.clearCache()
        await session.setProxy(enabled ? { mode: 'fixed_servers', proxyRules: rules, proxyBypassRules: 'localhost,127.0.0.1,::1,<local>' } : { mode: 'system' })
        await session.closeAllConnections()
      }
    },
    selectAvatar() { return selectImage(false) },
    selectSearchWallpaper() { return selectImage(true) },
    setAcrylicOpacity(light, dark) {
      const lightOpacity = finite(light, 'light acrylic opacity')
      const darkOpacity = finite(dark, 'dark acrylic opacity')
      if (lightOpacity < 0 || lightOpacity > 100 || darkOpacity < 0 || darkOpacity > 100) throw new RangeError('Acrylic opacity must be between 0 and 100')
      env.broadcast('update-acrylic-opacity', { lightOpacity, darkOpacity })
    },
    getSystemSettings() { return getSystemSettings(platform) },
  }
}
