import type { SettingsPluginOptions } from './host'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, normalize } from 'node:path'
import type { SettingsDocuments } from './documents'

export interface LocalShortcut { id: string; name: string; alias?: string; path: string; type: 'file' | 'folder' | 'app'; icon?: string; addedAt: number }
export function createLocalShortcuts(documents: SettingsDocuments, changed: (key: string, value: unknown) => void, options: SettingsPluginOptions) {
  const getAll = (): LocalShortcut[] => { const value = documents.get('local-shortcuts'); return Array.isArray(value) ? value as LocalShortcut[] : [] }
  const save = (value: LocalShortcut[]) => { documents.put('local-shortcuts', value); changed('local-shortcuts', value) }
  async function addByPath(value: unknown, authorized = false) {
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw new TypeError('Invalid local shortcut path')
    const path = normalize(value)
    if (!authorized) {
      if (!options.dialogs) throw new Error('Native dialog unavailable')
      const approval = await options.dialogs.showMessageBox({ type: 'question', title: '添加本地启动项', message: '允许将此文件加入本地启动项？', detail: path, buttons: ['取消', '添加'], defaultId: 0, cancelId: 0 })
      if (approval.response !== 1) return { success: false, error: '用户取消选择' }
    }
    const metadata = await stat(path)
    const previous = getAll()
    if (previous.some(item => item.path.toLowerCase() === path.toLowerCase())) throw new Error('此路径已添加')
    const type = metadata.isDirectory() ? 'folder' : ['.exe', '.lnk', '.app'].includes(extname(path).toLowerCase()) ? 'app' : 'file'
    if (!options.fileIcon) throw new Error('Native file icon unavailable')
    const icon = await options.fileIcon(path)
    const shortcut: LocalShortcut = { id: randomUUID(), name: basename(path), path, type, icon, addedAt: Date.now() }
    save([...previous, shortcut]); return { success: true, shortcut }
  }
  return {
    getAll,
    async invoke(method: string, args: unknown[]) {
      if (method === 'getAll') return getAll()
      if (method === 'add') {
        if (args[0] !== 'file' && args[0] !== 'folder') throw new TypeError('Invalid shortcut type')
        if (!options.dialogs) throw new Error('Native dialog unavailable')
        const selection = await options.dialogs.showOpenDialog({ properties: [args[0] === 'folder' ? 'openDirectory' : 'openFile'] })
        if (selection.canceled || !selection.filePaths[0]) return { success: false, error: '用户取消选择' }
        return addByPath(selection.filePaths[0], true)
      }
      if (method === 'addByPath') return addByPath(args[0])
      const items = getAll()
      if (method === 'deleteWhenNotExist') {
        const kept: LocalShortcut[] = []
        for (const item of items) {
          try { await stat(item.path); kept.push(item) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        }
        save(kept); return { success: true, deletedCount: items.length - kept.length }
      }
      if (method === 'open') {
        const target = items.find(item => item.path === args[0]); if (!target) throw new Error('Local shortcut is not authorized')
        if (!options.openPath) throw new Error('Native path opener unavailable')
        const error = await options.openPath(target.path); if (error) throw new Error(error); return { success: true }
      }
      const target = items.find(item => item.id === args[0]); if (!target) throw new Error('Local shortcut is missing')
      if (method === 'updateAlias') {
        if (typeof args[1] !== 'string' || args[1].length > 512) throw new TypeError('Invalid shortcut alias')
        save(items.map(item => item.id === target.id ? { ...item, alias: args[1] as string } : item)); return { success: true }
      }
      if (method !== 'delete') throw new Error(`Unknown local shortcut action: ${method}`)
      save(items.filter(item => item.id !== target.id)); return { success: true }
    },
  }
}
