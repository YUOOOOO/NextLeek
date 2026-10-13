import type { Context } from '@deepseek-ai/cordis'
import path from 'node:path'
import { createNativeContext, type NativeContextDependencies, type NativeContextService } from './index'
import { createClipboardFileStore, readGeneralSettings } from './file-store'
import type { BlockedApplication } from './foreground'

import { createImageAnalyzer, type ImageAnalysisResult } from './image-analysis'
export interface NativeContextPluginOptions extends Omit<NativeContextDependencies, 'database' | 'getSettings' | 'onDispose'> {
  database?: NativeContextDependencies['database']
  settingsDocumentsPath: string
  imageRoot: string
  getSettings?: NativeContextDependencies['getSettings']
}

export interface NativeContextHostService extends NativeContextService {
  analyzeImage(imagePath: string): Promise<ImageAnalysisResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context { nativeContext: NativeContextHostService }
}

/** Clipboard history, foreground policies and native monitor lifetimes are one Cordis-owned service. */
export function createNativeContextPlugin(options: NativeContextPluginOptions) {
  return {
    name: 'native-context', inject: ['desktop'],
    async apply(ctx: Context) {
      const getSettings = options.getSettings ?? (() => readGeneralSettings(options.settingsDocumentsPath))
      const service = await createNativeContext({
        ...options,
        database: options.database ?? createClipboardFileStore(path.join(options.clipboardPath, 'history')),
        getSettings,
        onDispose(dispose) { ctx.effect(() => dispose, 'native clipboard and foreground monitors') },
      })
      const settings = await getSettings()
      if (settings && typeof settings === 'object') {
        const config = settings as Record<string, unknown>
        service.setIgnoreHotkeysOnFullscreen(config.ignoreHotkeysOnFullscreen === true)
        for (const [key, setter] of [
          ['wakeupBlacklist', service.updateWakeupBlacklist],
          ['superPanelBlockedApps', service.updateSuperPanelBlockedApps],
        ] as const) {
          const list = config[key]
          if (Array.isArray(list)) setter(list.filter((item): item is BlockedApplication => item && typeof item.app === 'string' && (item.bundleId === undefined || typeof item.bundleId === 'string')))
        }
      }
      ctx.provide('nativeContext', { ...service, analyzeImage: createImageAnalyzer(ctx, options.imageRoot, options.nativeImage) })
    },
  }
}
