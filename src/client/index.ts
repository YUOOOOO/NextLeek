import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from '../../plugins/settings/src/router'
import '../../plugins/settings/src/assets/styles/css/global.css'
import 'virtual:uno.css'

// 集成入口替代原版 main.ts，挂载前仍需初始化平台类以启用原生材质样式。
function detectOS(): void {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('win') || userAgent.includes('windows')) {
    document.documentElement.classList.add('os-windows')
  } else if (platform.includes('mac') || userAgent.includes('mac')) {
    document.documentElement.classList.add('os-mac')
  } else if (platform.includes('linux') || userAgent.includes('linux')) {
    document.documentElement.classList.add('os-linux')
  }
}

detectOS()

createApp(App).use(createPinia()).use(router).mount('#app')
