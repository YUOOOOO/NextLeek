import { createApp } from 'vue'
import App from './App.vue'
import { createMemoryApi, createTauriApi } from './api'

const builtins = [
  {id:'com.nextleek.notes',name:'Notes',version:'1.0.0',entry:'ui/index.html',capabilities:['notes.read','notes.write'],permissions:['storage:local']},
  {id:'com.nextleek.stocks',name:'Stocks',version:'1.0.0',entry:'ui/index.html',capabilities:['stocks.quote.read','stocks.watchlist'],permissions:['network:https']}
]
const isTauri = '__TAURI_INTERNALS__' in window
const api = isTauri ? await createTauriApi() : createMemoryApi(builtins)
createApp(App,{api}).mount('#app')
