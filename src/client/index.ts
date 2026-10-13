import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from '../../plugins/settings/src/router'
import '../../plugins/settings/src/assets/styles/css/global.css'
import 'virtual:uno.css'

createApp(App).use(createPinia()).use(router).mount('#app')
