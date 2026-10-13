// Adapted from ZTools systemSettings, MIT licensed. Enumeration and launch policy belong to this plugin.
import { spawn } from 'node:child_process'
import { join, win32 } from 'node:path'
import { WINDOWS_SETTINGS, type ConfirmDialogOptions, type SystemSetting } from './windowsSettings'

export interface SystemSettingsPorts {
  platform?: NodeJS.Platform
  windowsDirectory?: string
  openExternal(uri: string): Promise<void>
  confirm(options: ConfirmDialogOptions): Promise<boolean>
}

export function getSystemSettings(platform: NodeJS.Platform = process.platform): SystemSetting[] {
  return platform === 'win32' ? WINDOWS_SETTINGS.map(setting => ({ ...setting, confirmDialog: setting.confirmDialog ? { ...setting.confirmDialog, buttons: setting.confirmDialog.buttons?.slice() } : undefined })) : []
}

function execute(file: string, args: string[], waitForExit = false): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const child = spawn(file, args, { windowsHide: false, shell: false, stdio: 'ignore' })
  child.once('error', reject)
  if (waitForExit) child.once('exit', code => code === 0 ? resolve() : reject(new Error(`System setting operation failed (${code})`)))
  else child.once('spawn', () => { child.unref(); resolve() })
  return promise
}

// Never accept arbitrary command lines from a renderer. Every executable and argument originates in the copied catalogue.
export async function launchSystemSetting(uri: string, ports: SystemSettingsPorts): Promise<{ success: boolean; canceled?: boolean }> {
  if ((ports.platform ?? process.platform) !== 'win32') throw new Error('Windows system settings are not available on this platform')
  if (typeof uri !== 'string') throw new TypeError('Invalid system setting URI')
  const setting = WINDOWS_SETTINGS.find(item => item.uri === uri)
  if (!setting) throw new TypeError('System setting is not in the allowed catalogue')
  if (setting.confirmDialog && !await ports.confirm(setting.confirmDialog)) return { success: false, canceled: true }
  if (/^ms-settings(?:-connectabledevices)?:/.test(uri)) {
    await ports.openExternal(uri)
    return { success: true }
  }
  const windows = ports.windowsDirectory ?? process.env.SystemRoot ?? 'C:\\Windows'
  const system32 = win32.join(windows, 'System32')
  if (uri === 'shell:RecycleBinFolder') await execute(win32.join(windows, 'explorer.exe'), [uri])
  else if (uri === 'PowerShell.exe -NoProfile -Command "Clear-RecycleBin -Force"') await execute(win32.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', 'Clear-RecycleBin -Force'], true)
  else if (uri === 'powershell.exe') await execute(win32.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [])
  else if (uri === 'wt.exe') await execute(join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe'), [])
  else if (uri === 'rundll32 sysdm.cpl,EditEnvironmentVariables') await execute(win32.join(system32, 'rundll32.exe'), ['sysdm.cpl,EditEnvironmentVariables'])
  else if (uri === 'rundll32 shell32.dll,#61') await execute(win32.join(system32, 'rundll32.exe'), ['shell32.dll,#61'])
  else if (uri === 'control.exe keyboard') await execute(win32.join(system32, 'control.exe'), ['keyboard'])
  else if (uri === 'msdt.exe -id PCWDiagnostic') await execute(win32.join(system32, 'msdt.exe'), ['-id', 'PCWDiagnostic'])
  else if (/^[\w]+\.cpl$/i.test(uri)) await execute(win32.join(system32, 'control.exe'), [win32.join(system32, uri)])
  else if (/^[\w]+\.msc$/i.test(uri)) await execute(win32.join(system32, 'mmc.exe'), [win32.join(system32, uri)])
  else if (/^[\w]+\.exe$/i.test(uri)) await execute(win32.join(system32, uri), [])
  else throw new Error('No launch primitive exists for this system setting')
  return { success: true }
}
