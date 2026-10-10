import type { Context } from '@deepseek-ai/cordis'
import type { App } from 'electron'
import type { EventEmitter } from 'node:events'
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DesktopEvent, UpdateState } from '../shared/contracts'

interface UpdateInfo { version: string }
interface UpdateResult { cancellationToken?: { cancel(): void } }
export interface UpdaterPort extends Pick<EventEmitter, 'on' | 'removeListener'> {
  checkForUpdates(): Promise<UpdateResult | null>
  downloadUpdate(): Promise<string[]>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
}
export interface OnlineUpdater {
  getState(): UpdateState
  check(): Promise<UpdateState>
  download(): Promise<UpdateState>
  install(): Promise<UpdateState>
}

export function updateSupport(environment: { isPackaged: boolean; platform: string; installed: boolean }): string | undefined {
  if (!environment.isPackaged) return '开发模式不支持在线更新，请使用 Windows 安装版。'
  if (environment.platform !== 'win32') return '在线更新仅支持 Windows NSIS 安装版；macOS/Linux 请手动下载新版本，未签名 macOS 不支持自动安装。'
  if (!environment.installed) return '便携 ZIP 不支持在线安装更新。请从 GitHub Releases 下载 Setup.exe 并安装，以启用增量在线更新。'
}

export function createUpdateController(ctx: Context, options: {
  currentVersion: string
  unsupportedReason?: string
  updater?: UpdaterPort
  emit(event: DesktopEvent): void
  prepareInstall(): Promise<void>
  app?: Pick<EventEmitter, 'on' | 'removeListener'>
}): OnlineUpdater {
  const updater = options.updater
  const supported = !!updater && !options.unsupportedReason
  let state: UpdateState = {
    status: supported ? 'idle' : 'unsupported', currentVersion: options.currentVersion, supported,
    message: options.unsupportedReason ?? '从 GitHub Releases 检查更新；仅在确认后下载和重启安装。',
  }
  let disposed = false
  let installing = false
  let cancellationToken: UpdateResult['cancellationToken']
  let releaseListeners = () => {}
  const getState = (): UpdateState => ({ ...state, ...(state.progress ? { progress: { ...state.progress } } : {}) })
  function publish(patch: Partial<UpdateState>) {
    state = { ...state, ...patch }
    if (!disposed) options.emit({ type: 'update', update: getState() })
  }
  function fail(error: unknown) {
    publish({ status: 'error', progress: undefined, message: error instanceof Error ? error.message : String(error) })
    if (disposed) console.error('Update installation failed', error)
  }
  function assertActive() { if (disposed) throw new Error('Updater is shutting down') }
  const busy = () => ['checking', 'downloading', 'installing'].includes(state.status)

  ctx.effect(() => {
    const listeners: Array<[string, (() => void) | ((info: UpdateInfo) => void) | ((progress: NonNullable<UpdateState['progress']>) => void) | ((error: unknown) => void)]> = [
      ['checking-for-update', () => publish({ status: 'checking', version: undefined, progress: undefined, message: '正在检查 GitHub Releases…' })],
      ['update-available', (info: UpdateInfo) => publish({ status: 'available', version: info.version, message: `发现新版本 ${info.version}，可下载更新。` })],
      ['update-not-available', (info: UpdateInfo) => publish({ status: 'not-available', version: info.version, message: '当前已是最新版本。' })],
      ['download-progress', (progress: NonNullable<UpdateState['progress']>) => publish({ status: 'downloading', progress: { percent: progress.percent, transferred: progress.transferred, total: progress.total, bytesPerSecond: progress.bytesPerSecond }, message: '正在下载更新…' })],
      ['update-downloaded', (info: UpdateInfo) => publish({ status: 'downloaded', version: info.version, progress: undefined, message: '更新已下载并校验，点击重启安装。' })],
      ['error', fail],
    ]
    for (const [event, listener] of listeners) updater?.on(event, listener)
    // Keep Electron alive while prepareInstall closes windows and flushes storage.
    const keepAlive = () => {}
    options.app?.on('window-all-closed', keepAlive)
    releaseListeners = () => {
      for (const [event, listener] of listeners) updater?.removeListener(event, listener)
      options.app?.removeListener('window-all-closed', keepAlive)
    }
    return () => {
      disposed = true
      cancellationToken?.cancel()
      // quitAndInstall can synchronously emit an error: retain its handler until
      // the install handoff completes, even when prepareInstall disposes ctx.
      if (!installing) releaseListeners()
    }
  }, 'online updater events and installation lifecycle')

  return {
    getState,
    async check(): Promise<UpdateState> {
      assertActive()
      if (!supported || busy() || state.status === 'downloaded') return getState()
      publish({ status: 'checking', version: undefined, progress: undefined, message: '正在检查 GitHub Releases…' })
      try {
        const result = await updater!.checkForUpdates()
        cancellationToken = result?.cancellationToken
        if (disposed) cancellationToken?.cancel()
        if (!result && !disposed) fail(new Error('更新检查未返回结果。'))
      } catch (error) { if (!disposed) fail(error) }
      return getState()
    },
    async download(): Promise<UpdateState> {
      assertActive()
      if (!supported || busy() || state.status === 'downloaded') return getState()
      if (state.status !== 'available') throw new Error('Check for an available update before downloading')
      publish({ status: 'downloading', progress: undefined, message: '正在下载并校验更新…' })
      try { await updater!.downloadUpdate() }
      catch (error) { if (!disposed) fail(error) }
      return getState()
    },
    async install(): Promise<UpdateState> {
      assertActive()
      if (!supported || busy()) return getState()
      if (state.status !== 'downloaded') throw new Error('Download an update before installing')
      installing = true
      publish({ status: 'installing', message: '正在关闭应用并启动安装程序，完成后重新启动…' })
      try {
        await options.prepareInstall()
        updater!.quitAndInstall(true, true)
      } catch (error) { fail(error) }
      finally {
        installing = false
        if (disposed) releaseListeners()
      }
      return getState()
    },
  }
}

export async function createUpdater(ctx: Context, options: {
  app: App
  emit(event: DesktopEvent): void
  prepareInstall(): Promise<void>
}): Promise<OnlineUpdater> {
  let installed = false
  if (options.app.isPackaged && process.platform === 'win32') {
    try { await access(join(dirname(process.execPath), 'Uninstall NextLeek.exe')); installed = true } catch { /* ZIP builds have no NSIS uninstaller. */ }
  }
  const unsupportedReason = updateSupport({ isPackaged: options.app.isPackaged, platform: process.platform, installed })
  let updater: UpdaterPort | undefined
  if (!unsupportedReason) {
    // Construct a context-owned updater, never electron-updater's global singleton.
    const { default: updaterModule } = await import('electron-updater')
    const nsis = new updaterModule.NsisUpdater({ provider: 'github', owner: 'YUOOOOO', repo: 'NextLeek' })
    nsis.autoDownload = false
    nsis.autoInstallOnAppQuit = false
    nsis.autoRunAppAfterInstall = true
    nsis.allowPrerelease = false
    nsis.allowDowngrade = false
    updater = nsis
  }
  return createUpdateController(ctx, { ...options, currentVersion: options.app.getVersion(), updater, unsupportedReason })
}
