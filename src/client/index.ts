import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles.css'
import '../../plugins/settings/src/assets/styles/css/global.css'
import 'virtual:uno.css'

createApp(App).use(createPinia()).mount('#app')
