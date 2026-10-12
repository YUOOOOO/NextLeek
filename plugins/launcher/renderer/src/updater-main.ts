import './style.css'
import { createApp } from 'vue'
import UpdateWindow from './components/updater/UpdateWindow.vue'

// 检测操作系统并添加类名到 html 元素
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

// 在应用初始化前检测操作系统
detectOS()

const app = createApp(UpdateWindow)
app.mount('#updater-app')
