<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import type { AiSettings, GeneratePluginRequest, KernelApi, MarketCatalog, PackageArtifact, PluginManifest, PluginState, RuntimeLaunch, SettingsView } from './api'
import type { Update } from '@tauri-apps/plugin-updater'

interface AiMessage { role:'user'|'assistant'; content:string }
interface CreatorFile { path:string; content:string }

const props = defineProps<{ api: KernelApi }>()
const pages = ['仪表盘', '创造模式', '插件市场'] as const
type Page = typeof pages[number] | '设置'
const current = ref<Page>('仪表盘')
const plugins = ref<PluginState[]>([])
const pluginNavItems = computed(() => plugins.value.filter(plugin => plugin.manifest.navigation?.enabled && plugin.manifest.id!=='com.nextleek.dashboard').sort((left, right) => (left.manifest.navigation?.order ?? 100) - (right.manifest.navigation?.order ?? 100)))
const market = ref<MarketCatalog | null>(null)
const runtime = ref<RuntimeLaunch | null>(null)
const status = ref('')
const error = ref('')
const packageArtifact = ref<PackageArtifact | null>(null)
const aiPrompt = ref('')
const aiMessages = ref<AiMessage[]>([])
const aiLoading = ref(false)
const lastValidationErrors = ref<string[]>([])
const settings = ref<SettingsView | null>(null)
const availableUpdate = shallowRef<Update | null>(null)
const updateState = ref<'idle'|'checking'|'current'|'available'|'failed'>('idle')
const updating = ref(false)
const updateError = ref('')
const aiSettings = ref<AiSettings>({enabled:true,baseUrl:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1-mini',temperature:0.2})
const draft: PluginManifest = { id:'com.example.created', name:'我的插件', version:'0.1.0', entry:'ui/index.html', description:'由 NextLeek 创建的插件', author:'Me', minCreatorVersion:'0.1.0', capabilities:[], permissions:[], navigation:{enabled:false,order:100} }
const creatorFiles = ref<Record<string,string>>({'ui/index.html':'<main><h1>Hello NextLeek</h1></main>','ui/main.js':'','ui/style.css':'body{font-family:system-ui;padding:32px}'})
const activeCreatorFile = ref('ui/index.html')
const newCreatorFilePath = ref('ui/components/example.js')
const activeCreatorContent = computed({get:()=>creatorFiles.value[activeCreatorFile.value] ?? '',set:(value:string)=>{ creatorFiles.value[activeCreatorFile.value]=value }})
const creatorFileList = computed<CreatorFile[]>(()=>Object.entries(creatorFiles.value).sort(([left],[right])=>left.localeCompare(right)).map(([path,content])=>({path,content})))
const loading = ref(false)
const CREATOR_MODE_ENABLED = true
const installedById = computed(() => new Map(plugins.value.map(plugin => [plugin.manifest.id, plugin])))
const pageTitle = computed(() => runtime.value?.manifest.name || current.value)

async function selectPage(page:Page){
  current.value=page
  await closeRuntime()
  if(page==='仪表盘' && current.value==='仪表盘'){
    const dashboard=plugins.value.find(plugin=>plugin.manifest.id==='com.nextleek.dashboard')
    if(dashboard){ try { const launched=await props.api.launchPlugin(dashboard.manifest.id); if(current.value==='仪表盘') runtime.value=launched; else await props.api.closePlugin(launched.token) } catch(cause) { error.value=String(cause) } }
  }
}
// 首屏插件读取可能晚于用户切页；仅当仍停留在仪表盘时才挂载内置运行时，避免异步结果覆盖新页面。
async function loadPlugins(){
 plugins.value = await props.api.listPlugins()
 const dashboard=plugins.value.find(plugin=>plugin.manifest.id==='com.nextleek.dashboard')
 if(dashboard && current.value==='仪表盘' && !runtime.value){
  try {
   const launched=await props.api.launchPlugin(dashboard.manifest.id)
   if(current.value==='仪表盘' && !runtime.value) runtime.value=launched
   else await props.api.closePlugin(launched.token)
  } catch(cause) { error.value=String(cause) }
 }
}
async function loadMarket(){ loading.value=true; error.value=''; try { market.value=await props.api.refreshMarket() } catch(cause) { error.value=String(cause) } finally { loading.value=false } }
async function importLocalPackage(event:Event){
  const input=event.target as HTMLInputElement
  const file=input.files?.[0]
  input.value=''
  if(!file)return
  error.value=''; status.value=''
  if(!file.name.toLowerCase().endsWith('.nlplugin')){ error.value='请选择 .nlplugin 插件包'; return }
  try {
    const bytes=Array.from(new Uint8Array(await file.arrayBuffer()))
    await props.api.installLocalPackage(bytes)
    await loadPlugins()
    status.value=`已导入本地插件：${file.name}`
  } catch(cause) { error.value=String(cause) }
}
async function create(){ status.value=''; error.value=''; try { await props.api.createDraft('creator-draft',draft); for(const [path,content] of Object.entries(creatorFiles.value)) await props.api.writeDraftFile('creator-draft',path,content); const report=await props.api.validateDraft('creator-draft'); lastValidationErrors.value=report.errors; status.value=report.valid?'验证通过':report.errors.join(', ') } catch(cause) { error.value=String(cause) } }
async function pack(){ try { packageArtifact.value=await props.api.packageDraft('creator-draft'); status.value='已生成插件包' } catch(cause) { error.value=String(cause) } }
function currentDraft():GeneratePluginRequest['currentDraft'] { return {manifest:{...draft,navigation:draft.navigation ? {...draft.navigation} : undefined,capabilities:[...draft.capabilities],permissions:[...draft.permissions]},files:{...creatorFiles.value}} }
function addCreatorFile(){ const path=newCreatorFilePath.value.trim().replace(/\\/g,'/'); if(!path||!path.startsWith('ui/')||path.endsWith('/')){ error.value='文件路径必须位于 ui/ 目录下'; return } if(creatorFiles.value[path]===undefined) creatorFiles.value[path]=''; activeCreatorFile.value=path; newCreatorFilePath.value='ui/'; error.value='' }
function removeCreatorFile(path:string){ if(Object.keys(creatorFiles.value).length<=1)return; delete creatorFiles.value[path]; if(activeCreatorFile.value===path)activeCreatorFile.value=Object.keys(creatorFiles.value)[0] }
async function generate(){
  const instruction=aiPrompt.value.trim()
  if(!instruction){ error.value='请输入生成需求'; return }
  aiLoading.value=true; error.value=''
  aiMessages.value.push({role:'user',content:instruction})
  aiPrompt.value=''
  try {
    const conversation=aiMessages.value.map(message=>`${message.role==='user'?'用户':'AI'}：${message.content}`).join('\n')
    const response=await props.api.generatePlugin({instruction:`请基于当前插件草稿继续完成以下对话，并返回完整可运行文件。\n${conversation}`,currentDraft:currentDraft(),validationErrors:lastValidationErrors.value})
    Object.assign(draft,response.manifest)
    creatorFiles.value=structuredClone(response.files)
    activeCreatorFile.value=Object.keys(creatorFiles.value)[0] || 'ui/index.html'
    aiMessages.value.push({role:'assistant',content:`${response.explanation} 已直接同步到编辑器。`})
    status.value='AI 已更新编辑器，请保存并验证'
  } catch(cause) { aiMessages.value.push({role:'assistant',content:`生成失败：${String(cause)}`}); error.value=String(cause) } finally { aiLoading.value=false }
}
function clearAiChat(){ aiMessages.value=[]; aiPrompt.value='' }
async function saveSettings(){ if(!settings.value)return; try { const saved=await props.api.setMarketUrl(settings.value.settings.marketUrl); settings.value=saved; aiSettings.value=saved.settings.ai; status.value='设置已保存' } catch(cause) { error.value=String(cause) } }
// Vue ref 中的对象是响应式代理；跨 Tauri IPC 前显式构造纯数据，避免 structuredClone 失败。
async function saveAiSettings(){
  error.value=''; status.value=''
  const value:AiSettings={enabled:aiSettings.value.enabled,baseUrl:aiSettings.value.baseUrl,apiKey:aiSettings.value.apiKey,model:aiSettings.value.model,temperature:aiSettings.value.temperature}
  try { const saved=await props.api.setAiSettings(value); settings.value=saved; aiSettings.value=saved.settings.ai; status.value='AI 设置已保存' } catch(cause) { error.value=String(cause) }
}
async function revokeTrust(id:string){ try { settings.value=await props.api.setPluginTrust(id,false); await loadPlugins() } catch(cause) { error.value=String(cause) } }
// 市场列表项同样是响应式代理；安装命令只接收可序列化的清单快照。
async function install(plugin: NonNullable<MarketCatalog['plugins']>[number]){
  error.value=''; status.value=''
  const value={id:plugin.id,name:plugin.name,version:plugin.version,description:plugin.description,author:plugin.author,packageUrl:plugin.packageUrl,sha256:plugin.sha256,minCreatorVersion:plugin.minCreatorVersion,permissions:[...plugin.permissions],...(plugin.iconUrl?{iconUrl:plugin.iconUrl}:{})}
  try { const installed=await props.api.installMarketPlugin(value); plugins.value=[...plugins.value.filter(item=>item.manifest.id!==installed.manifest.id),installed] } catch(cause) { error.value=String(cause) }
}
// 卸载后始终重新读取插件列表，后端发生部分清理时界面也不会保留失效状态。
async function uninstall(id:string){ error.value=''; status.value=''; try { await props.api.uninstallPlugin(id); status.value='插件已卸载' } catch(cause) { const message=String(cause); error.value=`卸载失败：${message.includes('built-in plugins cannot be uninstalled')?'内置插件不能卸载':message}` } finally { try { await loadPlugins() } catch(cause) { error.value=`刷新插件列表失败：${String(cause)}` } } }
async function openPluginFromNavigation(id:string){ await openPlugin(id) }
async function openPlugin(id:string){ runtime.value=await props.api.launchPlugin(id); current.value='插件市场' }
async function closeRuntime(){ const active=runtime.value; runtime.value=null; if(active) await props.api.closePlugin(active.token) }
async function startDragging(event:MouseEvent){ if(event.button!==0)return; const { getCurrentWindow }=await import('@tauri-apps/api/window'); await getCurrentWindow().startDragging() }
async function minimizeWindow(){ const { getCurrentWindow }=await import('@tauri-apps/api/window'); await getCurrentWindow().minimize() }
async function toggleMaximize(){ const { getCurrentWindow }=await import('@tauri-apps/api/window'); await getCurrentWindow().toggleMaximize() }
async function closeWindow(){ const { getCurrentWindow }=await import('@tauri-apps/api/window'); await getCurrentWindow().close() }
function runtimeAsset(path:string, runtimeLaunch:NonNullable<typeof runtime.value>){ return runtimeLaunch.textAssets[path] ?? '' }
function runtimeSrcdoc(runtimeLaunch:NonNullable<typeof runtime.value>){
  let html=runtimeLaunch.entryHtml
  const css=runtimeAsset('ui/style.css',runtimeLaunch)
  const js=runtimeAsset('ui/main.js',runtimeLaunch)
  const bridge=`\x3cscript>window.nextleek={runtimeSummary:()=>Promise.resolve(${JSON.stringify({pluginCount:plugins.value.length,mode:'dual-trust',version:settings.value?.version ?? '0.1.0'})})}\x3c/script>`
  html=html.replace(/\x3clink[^>]+href=["']style\.css["'][^>]*>/i,`\x3cstyle>${css}\x3c/style>`)
  html=html.replace(/\x3cscript[^>]+src=["']main\.js["'][^>]*>\x3c\/script>/i,`${bridge}\x3cscript>${js}\x3c/script>`)
  return html
}
// 检查 GitHub 最新版本；启动失败时自动重试一次，手动检查则立即反馈结果。
async function checkForUpdates(retry=true){
  if(!('__TAURI_INTERNALS__' in window)) return
  updateState.value='checking'
  updateError.value=''
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({timeout:30000})
    availableUpdate.value = update
    updateState.value = update ? 'available' : 'current'
  } catch(cause) {
    console.warn('检查更新失败', cause)
    if(retry){
      window.setTimeout(()=>void checkForUpdates(false),10000)
      return
    }
    updateState.value='failed'
    updateError.value=`检查更新失败：${String(cause)}`
  }
}
// 下载签名更新包并安装，完成后重启进入新版本。
async function installUpdate(){
  if(!availableUpdate.value || updating.value) return
  updating.value=true
  updateError.value=''
  try {
    status.value='正在下载更新…'
    await availableUpdate.value.downloadAndInstall()
    status.value='更新安装完成，正在重启…'
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch(cause) {
    updateError.value=`更新失败：${String(cause)}`
    error.value=updateError.value
  } finally { updating.value=false }
}
function pluginAction(id:string){ return installedById.value.get(id) }
// 启动先让主界面完成首屏渲染，再并行读取本地数据与检查更新，避免任一慢接口阻塞白屏。
onMounted(()=>{
  void loadPlugins().catch(cause=>{ error.value=String(cause) })
  void props.api.readSettings().then(value=>{ settings.value=value; aiSettings.value=value.settings.ai }).catch(cause=>{ error.value=String(cause) })
  void checkForUpdates()
})
watch(current,page=>{if(page==='插件市场'&&!market.value)loadMarket(); if(page==='设置'&&!settings.value)props.api.readSettings().then(value=>{settings.value=value; aiSettings.value=value.settings.ai})})
</script>
<template>
<div class="app-shell">
<div v-if="current==='插件市场'" class="local-plugin-import"><label class="btn">导入本地插件<input data-test="import-local-plugin" type="file" accept=".nlplugin,application/octet-stream" hidden @change="importLocalPackage"></label></div>
<header class="titlebar">
  <div class="titlebar-drag" data-tauri-drag-region @mousedown="startDragging" @dblclick="toggleMaximize">
    <button class="titlebar-brand" tabindex="-1">NEXTLEEK</button>
    <strong class="titlebar-title">{{pageTitle}}</strong>
  </div>
  <div class="window-controls" @dblclick.stop>
    <button class="settings-control" aria-label="设置" data-test="settings" title="设置" @click.stop="selectPage('设置')"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19.14 12.94a7.49 7.49 0 0 0 .05-.94 7.49 7.49 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.36 7.36 0 0 0-1.63-.94L14.38 2.8a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.52c-.58.24-1.12.56-1.63.94L5.16 5.3a.5.5 0 0 0-.61.22L2.63 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.49 7.49 0 0 0-.05.94c0 .32.02.63.05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.5.38 1.05.7 1.63.94l.36 2.52a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.52a7.36 7.36 0 0 0 1.63-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg></button>
    <button aria-label="最小化" @click.stop="minimizeWindow">−</button>
    <button aria-label="最大化" @click.stop="toggleMaximize">□</button>
    <button class="close-control" aria-label="关闭" @click.stop="closeWindow">×</button>
  </div>
</header>
<div v-if="availableUpdate" class="update-banner" role="status"><span>发现新版本 v{{availableUpdate.version}}</span><button class="btn primary" @click="installUpdate">立即更新</button></div>
<div class="shell"><aside><nav aria-label="主导航"><button v-for="page in pages" :key="page" :data-page="page" :class="{active:current===page&&(page==='仪表盘'||!runtime)}" @click="selectPage(page)">{{page}}</button><button v-for="plugin in pluginNavItems" :key="plugin.manifest.id" class="plugin-nav" :data-page="plugin.manifest.name" :class="{active:runtime?.manifest.id===plugin.manifest.id}" @click="openPluginFromNavigation(plugin.manifest.id)">{{plugin.manifest.navigation?.label||plugin.manifest.name}}</button></nav><div class="sidebar-foot"><span data-test="version">v{{settings?.version||'0.1.0'}}</span><a class="github-link" href="https://github.com/YUOOOOO/NextLeek" target="_blank" rel="noreferrer" aria-label="GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.94 10.94 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg></a></div></aside><main :class="{'runtime-main':runtime}">
<section v-if="runtime" class="runtime-view"><div class="runtime-frame" :data-trusted="runtime.trusted"><iframe :title="runtime.manifest.name" sandbox="allow-scripts" :srcdoc="runtimeSrcdoc(runtime)" /></div></section>
<section v-else-if="current==='仪表盘'" class="hero"><p class="eyebrow">NEXTLEEK DASHBOARD</p><h1>仪表盘插件</h1><p>当前首页来自可编辑的仪表盘插件。</p><div class="metrics"><article><b>{{plugins.length}}</b><span>已安装插件</span></article><article><b>0</b><span>原生 Sidecar</span></article><article><b>100%</b><span>声明式</span></article></div></section>
<section v-else-if="current==='创造模式' && CREATOR_MODE_ENABLED" class="page-section creator-page"><div class="creator-heading"><div><p class="eyebrow">ISOLATED WORKSPACE</p><h1>创造模式</h1><p class="muted">支持插件目录中的多个 HTML、JavaScript、CSS 与资源文本文件。</p></div><div class="button-row"><button data-test="create" class="btn primary" @click="create">保存并验证</button><button data-test="package" class="btn" @click="pack">生成 .nlplugin</button></div></div><div class="creator-layout"><article class="creator-workspace"><div class="manifest-grid"><label>插件 ID<input v-model="draft.id"></label><label>名称<input v-model="draft.name"></label><label>版本<input v-model="draft.version"></label><label>作者<input v-model="draft.author"></label><label class="wide">描述<input v-model="draft.description"></label></div><div class="file-workspace"><aside class="file-sidebar"><h2>插件文件</h2><button v-for="file in creatorFileList" :key="file.path" class="file-entry" :class="{active:activeCreatorFile===file.path}" @click="activeCreatorFile=file.path"><span>{{file.path}}</span><b v-if="creatorFileList.length>1" title="删除文件" @click.stop="removeCreatorFile(file.path)">×</b></button><div class="file-add"><input v-model="newCreatorFilePath" placeholder="ui/components/panel.js" @keydown.enter.prevent="addCreatorFile"><button class="btn" @click="addCreatorFile">新增文件</button></div></aside><section class="code-editor"><header><code>{{activeCreatorFile}}</code><span>{{activeCreatorContent.length}} 字符</span></header><textarea v-model="activeCreatorContent" spellcheck="false"></textarea></section></div><strong v-if="status" class="success">{{status}}</strong><p v-if="error" class="error">{{error}}</p><pre v-if="packageArtifact" class="package-result">文件：{{packageArtifact.path}}
SHA-256：{{packageArtifact.sha256}}
大小：{{packageArtifact.size}} bytes
内容：{{packageArtifact.files.join(', ')}}</pre></article><aside class="ai-panel"><div class="ai-panel-head"><div><p class="eyebrow">CONVERSATION</p><h2>AI 创造助手</h2></div><button class="btn ghost" :disabled="!aiMessages.length" @click="clearAiChat">清空</button></div><div class="ai-messages" aria-live="polite"><p v-if="!aiMessages.length" class="muted">描述需求，AI 会基于完整文件树生成或修改多个文件。</p><div v-for="(message,index) in aiMessages" :key="`${message.role}-${index}`" class="ai-message" :class="message.role"><strong>{{message.role==='user'?'你':'AI'}}</strong><span>{{message.content}}</span></div></div><textarea v-model="aiPrompt" placeholder="请输入需求，按 Ctrl+Enter 发送" @keydown.ctrl.enter.prevent="generate"></textarea><button class="btn primary" data-test="ai-generate" :disabled="aiLoading||!aiSettings.enabled" @click="generate">{{aiLoading?'生成中…':'发送并更新文件树'}}</button></aside></div></section>
<section v-else-if="current==='插件市场'" class="page-section"><header class="section-head"><div><p class="eyebrow">GITHUB MARKETPLACE</p><h1>插件市场</h1></div><button class="btn ghost" :disabled="loading" @click="loadMarket">刷新市场</button></header><p v-if="error" class="error">{{error}}</p><div v-if="plugins.length" class="installed-strip"><h2>已安装</h2><span v-for="plugin in plugins" :key="plugin.manifest.id" class="pill">{{plugin.manifest.name}} · {{plugin.manifest.version}} · {{plugin.source || (plugin.builtin?'builtin':'local-import')}}</span></div><div v-if="!market" class="empty"><p>从 GitHub 加载官方和社区插件。</p><button class="btn primary" @click="loadMarket">加载市场</button></div><div v-else class="cards"><article v-for="plugin in market.plugins" :key="plugin.id" class="plugin-card"><div class="card-top"><div><h2>{{plugin.name}}</h2><code>{{plugin.id}}</code></div><span class="version">v{{plugin.version}}</span></div><p>{{plugin.description}}</p><small>{{plugin.author}} · {{plugin.permissions.join(' · ')||'无额外权限'}}</small><div class="card-actions"><template v-if="pluginAction(plugin.id)"><button class="btn primary" :data-test="`open-${plugin.id}`" @click="openPlugin(plugin.id)">打开</button><button class="btn" :data-test="`uninstall-${plugin.id}`" @click="uninstall(plugin.id)">卸载</button></template><button v-else class="btn primary" :data-test="`install-${plugin.id}`" @click="install(plugin)">安装</button></div></article></div></section>
<section v-else-if="current==='设置'" class="page-section settings-page">
  <header class="section-head"><div><p class="eyebrow">CREATOR CONFIGURATION</p><h1>设置</h1></div><button class="btn ghost" @click="selectPage('仪表盘')">返回仪表盘</button></header>
  <strong v-if="status" class="success">{{status}}</strong>
  <p v-if="error" class="error">{{error}}</p>
  <div v-if="settings" class="settings-grid">
    <article class="settings-card">
      <h2>版本更新</h2>
      <div class="version-row"><span>当前版本</span><strong>v{{settings.version}}</strong></div>
      <div class="version-row"><span>最新版本</span><strong>{{availableUpdate ? `v${availableUpdate.version}` : updateState==='current' ? `v${settings.version}` : '--'}}</strong></div>
      <p v-if="updateState==='checking'" class="update-state">正在检查最新版本...</p>
      <p v-else-if="updateState==='current'" class="update-state">当前已是最新版本</p>
      <p v-else-if="updateState==='available'" class="update-state">发现可用的新版本</p>
      <p v-else-if="updateState==='failed'" class="update-state error">{{updateError}}</p>
      <div class="button-row">
        <button class="btn" :disabled="updateState==='checking'||updating" @click="checkForUpdates(false)">重新检查</button>
        <button v-if="availableUpdate" class="btn primary" data-test="install-update" :disabled="updating" @click="installUpdate">{{updating?'正在下载安装...':'下载并安装'}}</button>
      </div>
      <p class="muted">本地数据目录：{{settings.dataDir}}</p>
    </article>
    <article class="settings-card"><h2>插件市场</h2><label>市场索引地址<input v-model="settings.settings.marketUrl"></label><div class="button-row"><button class="btn primary" data-test="save-market-settings" @click="saveSettings">保存市场地址</button><button class="btn" @click="loadMarket">刷新市场</button></div></article>
    <article class="settings-card"><h2>可信插件</h2><p v-if="!settings.settings.trustedPlugins.length" class="muted">暂无可信插件</p><div v-for="id in settings.settings.trustedPlugins" :key="id" class="trust-row"><code>{{id}}</code><button class="btn" :data-test="`revoke-${id}`" @click="revokeTrust(id)">撤销</button></div></article>
    <article class="settings-card"><div class="settings-card-head"><div><h2>AI 设置</h2><p class="muted">用于创造模式中的智能插件生成。</p></div><label class="switch-control"><input v-model="aiSettings.enabled" type="checkbox"><span class="switch-track" aria-hidden="true"><i></i></span><b>{{aiSettings.enabled?'已启用':'已停用'}}</b></label></div><label>Base URL<input v-model="aiSettings.baseUrl"></label><label>模型<input v-model="aiSettings.model"></label><label>API Key<input v-model="aiSettings.apiKey" type="password" autocomplete="off"></label><label>Temperature<input v-model.number="aiSettings.temperature" type="number" min="0" max="2" step="0.1"></label><button class="btn primary" data-test="save-ai-settings" @click="saveAiSettings">保存 AI 设置</button></article>
  </div>
  <p v-else class="muted">正在加载设置...</p>
</section>
</main></div>
</div>
</template>
<style src="./style.css"></style>
