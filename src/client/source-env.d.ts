import type { SourceLauncherAPI } from '../../plugins/launcher/renderer/src/env'
import type { SourceSettingsAPI } from '../../plugins/settings/src/env'

declare global {
  var ztools: SourceLauncherAPI & SourceSettingsAPI
  interface Window {
    ztools: SourceLauncherAPI & SourceSettingsAPI
  }
}

export {}
