import { createApp } from 'vue'
import App from './App.vue'
import { createMemoryApi, createTauriApi } from './api'

const builtins = [
  {id:'com.nextleek.dashboard',name:'仪表盘',version:'1.0.0',entry:'ui/index.html',description:'NextLeek 基础运行仪表盘',author:'NextLeek',minCreatorVersion:'0.1.0',capabilities:[],permissions:[],navigation:{enabled:true,label:'仪表盘',order:10}}
]
const isTauri = '__TAURI_INTERNALS__' in window
const api = isTauri ? await createTauriApi() : createMemoryApi(builtins.map(manifest => ({manifest, builtin:false, trusted:true, source:'user-created' as const})))
createApp(App,{api}).mount('#app')
