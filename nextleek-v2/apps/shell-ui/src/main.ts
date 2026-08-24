import { createApp } from 'vue'
import App from './App.vue'
import { createMemoryApi, createTauriApi } from './api'

const builtins = [
  {id:'com.nextleek.notes',name:'Notes',version:'1.0.0',entry:'ui/index.html',description:'安全保存本地笔记',author:'NextLeek',minCreatorVersion:'0.1.0',capabilities:['notes.read','notes.write'],permissions:['storage:local']},
  {id:'com.nextleek.stocks',name:'Stocks',version:'1.0.0',entry:'ui/index.html',description:'查看示例股票自选列表',author:'NextLeek',minCreatorVersion:'0.1.0',capabilities:['stocks.quote.read','stocks.watchlist'],permissions:['network:https']}
]
const isTauri = '__TAURI_INTERNALS__' in window
const api = isTauri ? await createTauriApi() : createMemoryApi(builtins.map(manifest => ({manifest, builtin:true, trusted:true})))
createApp(App,{api}).mount('#app')
