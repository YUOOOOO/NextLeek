import { open } from 'lmdb'
import type { Context } from '@deepseek-ai/cordis'
import { defaultSettings, settingsPatch, identifier, boolean } from '../../shared/validation'
import type { PersistentState, StorageService } from './contracts'

export function storagePlugin(path: string) {
  return {
    name: 'storage',
    apply(ctx: Context) {
      ctx.effect(function* () {
        const db = open<PersistentState, string>({ path, compression: true })
        yield () => db.close()
        ctx.provide('storage', {
          read() {
            const saved = db.get('state:v1')
            if (!saved) return { settings: { ...defaultSettings }, recent: [], pinned: [], enabled: {} }
            const settings = { ...defaultSettings, ...settingsPatch(saved.settings) }
            const recent = saved.recent.map(identifier).slice(0, 50)
            const pinned = saved.pinned.map(identifier)
            const enabled = Object.fromEntries(Object.entries(saved.enabled).map(([id, value]) => [identifier(id), boolean(value)]))
            return { settings, recent, pinned, enabled }
          },
          write(state) { db.putSync('state:v1', state) },
        } satisfies StorageService)
      }, 'LMDB environment')
    },
  }
}
