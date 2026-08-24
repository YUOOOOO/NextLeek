<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { AiSettings, GeneratePluginRequest, KernelApi, MarketCatalog, PackageArtifact, PluginManifest, PluginState, RuntimeLaunch, SettingsView } from './api'

interface AiMessage { role:'user'|'assistant'; content:string }

const props = defineProps<{ api: KernelApi }>()
const pages = ['首页', '创造模式', '插件市场'] as const
type Page = typeof pages[number] | '设置'
const current = ref<Page>('首页')
const plugins = ref<PluginState[]>([])
const pluginNavItems = computed(() => plugins.value.filter(plugin => plugin.manifest.navigation?.enabled).sort((left, right) => (left.manifest.navigation?.order ?? 100) - (right.manifest.navigation?.order ?? 100)))
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
const availableUpdate = ref<{version:string; downloadAndInstall:()=>Promise<void>} | null>(null)
const aiSettings = ref<AiSettings>({enabled:true,baseUrl:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1-mini',temperature:0.2})
const draft: PluginManifest = { id:'com.example.created', name:'我的插件', version:'0.1.0', entry:'ui/index.html', description:'由 NextLeek Creator 创建的插件', author:'Me', minCreatorVersion:'0.1.0', capabilities:[], permissions:[], navigation:{enabled:false,order:100} }
const editors = ref({html:'<main><h1>Hello NextLeek</h1></main>',js:'',css:'body{font-family:system-ui;padding:32px}'})
const loading = ref(false)
const installedById = computed(() => new Map(plugins.value.map(plugin => [plugin.manifest.id, plugin])))
const pageTitle = computed(() => runtime.value?.manifest.name || current.value)

async function selectPage(page:Page){ if(runtime.value){ await closeRuntime() }; current.value=page }
async function loadPlugins(){ plugins.value = await props.api.listPlugins() }
async function loadMarket(){ loading.value=true; error.value=''; try { market.value=await props.api.refreshMarket() } catch(cause) { error.value=String(cause) } finally { loading.value=false } }
async function create(){ status.value=''; error.value=''; try { await props.api.createDraft('creator-draft',draft); await props.api.writeDraftFile('creator-draft','ui/index.html',editors.value.html); await props.api.writeDraftFile('creator-draft','ui/main.js',editors.value.js); await props.api.writeDraftFile('creator-draft','ui/style.css',editors.value.css); const report=await props.api.validateDraft('creator-draft'); lastValidationErrors.value=report.errors; status.value=report.valid?'验证通过':report.errors.join(', ') } catch(cause) { error.value=String(cause) } }
async function pack(){ try { packageArtifact.value=await props.api.packageDraft('creator-draft'); status.value='已生成插件包' } catch(cause) { error.value=String(cause) } }
function currentDraft():GeneratePluginRequest['currentDraft'] { return {manifest:structuredClone(draft),files:{'ui/index.html':editors.value.html,'ui/main.js':editors.value.js,'ui/style.css':editors.value.css}} }
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
    editors.value={html:response.files['ui/index.html']||'',js:response.files['ui/main.js']||'',css:response.files['ui/style.css']||''}
    aiMessages.value.push({role:'assistant',content:`${response.explanation} 已直接同步到编辑器。`})
    status.value='AI 已更新编辑器，请保存并验证'
  } catch(cause) { aiMessages.value.push({role:'assistant',content:`生成失败：${String(cause)}`}); error.value=String(cause) } finally { aiLoading.value=false }
}
function clearAiChat(){ aiMessages.value=[]; aiPrompt.value='' }
async function saveSettings(){ if(!settings.value)return; try { const saved=await props.api.setMarketUrl(settings.value.settings.marketUrl); settings.value=saved; aiSettings.value=saved.settings.ai; status.value='设置已保存' } catch(cause) { error.value=String(cause) } }
async function saveAiSettings(){ try { const saved=await props.api.setAiSettings(structuredClone(aiSettings.value)); settings.value=saved; aiSettings.value=saved.settings.ai; status.value='AI 设置已保存' } catch(cause) { error.value=String(cause) } }
async function revokeTrust(id:string){ try { settings.value=await props.api.setPluginTrust(id,false); await loadPlugins() } catch(cause) { error.value=String(cause) } }
async function install(plugin: NonNullable<MarketCatalog['plugins']>[number]){ try { const installed=await props.api.installMarketPlugin(plugin); plugins.value=[...plugins.value.filter(item=>item.manifest.id!==installed.manifest.id),installed] } catch(cause) { error.value=String(cause) } }
async function uninstall(id:string){ await props.api.uninstallPlugin(id); await loadPlugins() }
async function openPluginFromNavigation(id:string){ await openPlugin(id) }
async function openPlugin(id:string){ runtime.value=await props.api.launchPlugin(id); current.value='插件市场' }
async function closeRuntime(){ if(runtime.value)await props.api.closePlugin(runtime.value.token); runtime.value=null }
async function minimizeWindow(){ const { getCurrentWindow }=await import('@tauri-apps/api/window'); await getCurrentWindow().minimize() }
async function toggleMaximize(){ const { getCurrentWindow }=await import('@tauri-apps/api/window'); await getCurrentWindow().toggleMaximize() }
async function closeWindow(){ const { getCurrentWindow }=await import('@tauri-apps/api/window'); await getCurrentWindow().close() }
async function startWindowDrag(){ const { getCurrentWindow }=await import('@tauri-apps/api/window'); await getCurrentWindow().startDragging() }
async function checkForUpdates(){
  if(!('__TAURI_INTERNALS__' in window)) return
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    availableUpdate.value = await check()
  } catch { availableUpdate.value = null }
}
async function installUpdate(){
  if(!availableUpdate.value) return
  try {
    status.value='正在下载更新…'
    await availableUpdate.value.downloadAndInstall()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch(cause) { error.value=`更新失败：${String(cause)}` }
}
function pluginAction(id:string){ return installedById.value.get(id) }
onMounted(async()=>{ await loadPlugins(); try { settings.value=await props.api.readSettings(); aiSettings.value=settings.value.settings.ai } catch(cause){ error.value=String(cause) }; await checkForUpdates() })
watch(current,page=>{if(page==='插件市场'&&!market.value)loadMarket(); if(page==='设置'&&!settings.value)props.api.readSettings().then(value=>{settings.value=value; aiSettings.value=value.settings.ai})})
</script>
<template>
<div class="app-shell">
<header class="titlebar" data-tauri-drag-region @dblclick="toggleMaximize">
  <button class="titlebar-brand" data-tauri-drag-region @mousedown="startWindowDrag">NEXTLEEK <span>CREATOR</span></button>
  <strong class="titlebar-title" data-tauri-drag-region>{{pageTitle}}</strong>
  <div class="window-controls">
    <button aria-label="设置" data-test="settings" @click="selectPage('设置')">⚙</button>
    <button aria-label="最小化" @click="minimizeWindow">—</button>
    <button aria-label="最大化" @click="toggleMaximize">□</button>
    <button class="close-control" aria-label="关闭" @click="closeWindow">×</button>
  </div>
</header>
<div v-if="availableUpdate" class="update-banner" role="status"><span>发现新版本 v{{availableUpdate.version}}</span><button class="btn primary" @click="installUpdate">立即更新</button></div>
<div class="shell"><aside><div class="brand">NEXTLEEK <span>CREATOR</span></div><nav aria-label="主导航"><button v-for="page in pages" :key="page" :data-page="page" :class="{active:current===page&&!runtime}" @click="selectPage(page)">{{page}}</button><button v-for="plugin in pluginNavItems" :key="plugin.manifest.id" class="plugin-nav" :data-page="plugin.manifest.name" :class="{active:runtime?.manifest.id===plugin.manifest.id}" @click="openPluginFromNavigation(plugin.manifest.id)">{{plugin.manifest.navigation?.label||plugin.manifest.name}}</button></nav><div class="sidebar-foot"><span data-test="version">v0.1.0</span></div></aside><main>
<section v-if="runtime" class="runtime-view"><div class="runtime-frame" :data-trusted="runtime.trusted"><iframe :title="runtime.manifest.name" sandbox="allow-scripts" :srcdoc="runtime.entryHtml" /></div></section>
<section v-else-if="current==='首页'" class="hero"><p class="eyebrow">RUST MICROKERNEL / TAURI 2</p><h1>欢迎使用 NextLeek Creator</h1><p>创建、验证并运行你的 JavaScript 插件。</p><div class="metrics"><article><b>{{plugins.length}}</b><span>已安装插件</span></article><article><b>0</b><span>原生 Sidecar</span></article><article><b>100%</b><span>声明式</span></article></div></section>
<section v-else-if="current==='创造模式'" class="page-section"><p class="eyebrow">ISOLATED WORKSPACE</p><h1>创造模式</h1><div class="creator-layout"><article class="form-grid"><label>插件 ID<input v-model="draft.id"></label><label>名称<input v-model="draft.name"></label><label>版本<input v-model="draft.version"></label><label>作者<input v-model="draft.author"></label><label class="wide">描述<input v-model="draft.description"></label><label class="wide">HTML<textarea v-model="editors.html"></textarea></label><label class="wide">JavaScript<textarea v-model="editors.js"></textarea></label><label class="wide">CSS<textarea v-model="editors.css"></textarea></label><div class="button-row"><button data-test="create" class="btn primary" @click="create">保存并验证</button><button data-test="package" class="btn" @click="pack">生成 .nlplugin</button></div><strong v-if="status" class="success">{{status}}</strong><p v-if="error" class="error">{{error}}</p><pre v-if="packageArtifact" class="package-result">文件：{{packageArtifact.path}}
SHA-256：{{packageArtifact.sha256}}
大小：{{packageArtifact.size}} bytes
文件：{{packageArtifact.files.join(', ')}}</pre></article><aside class="ai-panel"><div class="ai-panel-head"><div><p class="eyebrow">CONVERSATION</p><h2>AI 创造助手</h2></div><button class="btn ghost" :disabled="!aiMessages.length" @click="clearAiChat">清空</button></div><div class="ai-messages" aria-live="polite"><p v-if="!aiMessages.length" class="muted">描述需求，AI 会连续理解你的修改，并直接同步到编辑器。</p><div v-for="(message,index) in aiMessages" :key="`${message.role}-${index}`" class="ai-message" :class="message.role"><strong>{{message.role==='user'?'你':'AI'}}</strong><span>{{message.content}}</span></div></div><textarea v-model="aiPrompt" placeholder="请输入需求，按 Ctrl+Enter 发送" @keydown.ctrl.enter.prevent="generate"></textarea><button class="btn primary" data-test="ai-generate" :disabled="aiLoading||!aiSettings.enabled" @click="generate">{{aiLoading?'生成中…':'发送并更新编辑器'}}</button></aside></div></section>
<section v-else-if="current==='插件市场'" class="page-section"><header class="section-head"><div><p class="eyebrow">GITHUB MARKETPLACE</p><h1>插件市场</h1></div><button class="btn ghost" :disabled="loading" @click="loadMarket">刷新市场</button></header><p v-if="error" class="error">{{error}}</p><div v-if="plugins.length" class="installed-strip"><h2>已安装</h2><span v-for="plugin in plugins" :key="plugin.manifest.id" class="pill">{{plugin.manifest.name}} · {{plugin.manifest.version}} · {{plugin.source || (plugin.builtin?'builtin':'local-import')}}</span></div><div v-if="!market" class="empty"><p>从 GitHub 加载官方和社区插件。</p><button class="btn primary" @click="loadMarket">加载市场</button></div><div v-else class="cards"><article v-for="plugin in market.plugins" :key="plugin.id" class="plugin-card"><div class="card-top"><div><h2>{{plugin.name}}</h2><code>{{plugin.id}}</code></div><span class="version">v{{plugin.version}}</span></div><p>{{plugin.description}}</p><small>{{plugin.author}} · {{plugin.permissions.join(' · ')||'无额外权限'}}</small><div class="card-actions"><template v-if="pluginAction(plugin.id)"><button class="btn primary" :data-test="`open-${plugin.id}`" @click="openPlugin(plugin.id)">打开</button><button class="btn" :data-test="`uninstall-${plugin.id}`" @click="uninstall(plugin.id)">卸载</button></template><button v-else class="btn primary" :data-test="`install-${plugin.id}`" @click="install(plugin)">安装</button></div></article></div></section>
<section v-else-if="current==='设置'" class="page-section settings-page"><header class="section-head"><div><p class="eyebrow">CREATOR CONFIGURATION</p><h1>设置</h1></div><button class="btn ghost" @click="selectPage('首页')">返回首页</button></header><div v-if="settings" class="settings-grid"><article class="settings-card"><h2>Creator</h2><p>版本 v{{settings.version}}</p><p class="muted">本地数据目录：{{settings.dataDir}}</p></article><article class="settings-card"><h2>插件市场</h2><label>市场索引地址<input v-model="settings.settings.marketUrl"></label><div class="button-row"><button class="btn primary" data-test="save-market-settings" @click="saveSettings">保存市场地址</button><button class="btn" @click="loadMarket">刷新市场</button></div></article><article class="settings-card"><h2>可信插件</h2><p v-if="!settings.settings.trustedPlugins.length" class="muted">暂无已提升为可信模式的插件。</p><div v-for="id in settings.settings.trustedPlugins" :key="id" class="trust-row"><code>{{id}}</code><button class="btn" :data-test="`revoke-${id}`" @click="revokeTrust(id)">撤销</button></div></article><article class="settings-card"><h2>AI 设置</h2><label><input v-model="aiSettings.enabled" type="checkbox">启用 AI</label><label>Base URL<input v-model="aiSettings.baseUrl"></label><label>模型<input v-model="aiSettings.model"></label><label>API Key<input v-model="aiSettings.apiKey" type="password" autocomplete="off"></label><label>Temperature<input v-model.number="aiSettings.temperature" type="number" min="0" max="2" step="0.1"></label><button class="btn primary" data-test="save-ai-settings" @click="saveAiSettings">保存 AI 设置</button></article></div><p v-else class="muted">正在加载设置…</p></section>
</main></div>
</div>
</template>
<style src="./style.css"></style>
