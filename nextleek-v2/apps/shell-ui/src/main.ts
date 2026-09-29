import { createApp } from 'vue'
import App from './App.vue'
import { createMemoryApi, createTauriApi } from './api'
import dashboardHtml from '../../../plugins/builtin/dashboard/ui/index.html?raw'
import dashboardScript from '../../../plugins/builtin/dashboard/ui/main.js?raw'
import dashboardStyle from '../../../plugins/builtin/dashboard/ui/style.css?raw'

const builtins = [
  {
    id: 'com.nextleek.dashboard',
    name: '仪表盘',
    version: '1.0.0',
    entry: 'ui/index.html',
    description: 'NextLeek 基础运行仪表盘',
    author: 'NextLeek',
    minCreatorVersion: '0.1.0',
    capabilities: [],
    permissions: [],
    cmds: [{ code: 'open', label: '仪表盘', matches: ['仪表盘', 'dashboard', 'home'] }],
  },
]
const isTauri = '__TAURI_INTERNALS__' in window
const api = isTauri
  ? await createTauriApi()
  : createMemoryApi(
      builtins.map(manifest => ({ manifest, builtin: true, trusted: true, source: 'builtin' as const })),
      { 'com.nextleek.dashboard': { 'ui/index.html': dashboardHtml, 'ui/main.js': dashboardScript, 'ui/style.css': dashboardStyle } },
    )
createApp(App, { api }).mount('#app')
