<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { AiSettings, GeneratePluginResponse, KernelApi, MarketCatalog, PackageArtifact, PluginManifest, PluginState, RuntimeLaunch } from './api'
const props = defineProps<{ api: KernelApi }>()
const pages = ['首页', '创造模式', '插件市场'] as const
type Page = typeof pages[number]
const current = ref<Page>('首页')
const pluginNavItems = computed(() => plugins.value.filter(plugin => plugin.manifest.navigation?.enabled).sort((left, right) => (left.manifest.navigation?.order ?? 100) - (right.manifest.navigation?.order ?? 100)))
const settingsOpen = ref(false)
const plugins = ref<PluginState[]>([])
const market = ref<MarketCatalog | null>(null)
const runtime = ref<RuntimeLaunch | null>(null)
const status = ref('')
const error = ref('')
const packageArtifact = ref<PackageArtifact | null>(null)
const aiPrompt = ref('')
const aiResult = ref<GeneratePluginResponse | null>(null)
const aiLoading = ref(false)
const lastValidationErrors = ref<string[]>([])
const aiSettings = ref<AiSettings>({enabled:true,baseUrl:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1-mini',temperature:0.2})
const draft: PluginManifest = { id:'com.example.created', name:'我的插件', version:'0.1.0', entry:'ui/index.html', description:'由 NextLeek Creator 创建的插件', author:'Me', minCreatorVersion:'0.1.0', capabilities:[], permissions:[], navigation:{enabled:false,order:100} }
const editors = ref({html:'<main><h1>Hello NextLeek</h1></main>',js:'',css:'body{font-family:system-ui;padding:32px}'})
const loading = ref(false)
const installedById = computed(() => new Map(plugins.value.map(plugin => [plugin.manifest.id, plugin])))
async function loadPlugins(){ plugins.value = await props.api.listPlugins() }
async function loadMarket(){ loading.value=true; error.value=''; try { market.value=await props.api.refreshMarket() } catch(cause) { error.value=String(cause) } finally { loading.value=false } }
async function create(){ status.value=''; error.value=''; try { await props.api.createDraft('creator-draft',draft); await props.api.writeDraftFile('creator-draft','ui/index.html',editors.value.html); await props.api.writeDraftFile('creator-draft','ui/main.js',editors.value.js); await props.api.writeDraftFile('creator-draft','ui/style.css',editors.value.css); const report=await props.api.validateDraft('creator-draft'); lastValidationErrors.value=report.errors; status.value=report.valid?'验证通过':report.errors.join(', ') } catch(cause) { error.value=String(cause) } }
async function pack(){ try { packageArtifact.value=await props.api.packageDraft('creator-draft'); status.value='已生成插件包' } catch(cause) { error.value=String(cause) } }
async function generate(){ if(!aiPrompt.value.trim()){error.value='请输入生成需求';return} aiLoading.value=true; error.value=''; aiResult.value=null; try { aiResult.value=await props.api.generatePlugin({instruction:aiPrompt.value,currentDraft:{manifest:structuredClone(draft),files:{'ui/index.html':editors.value.html,'ui/main.js':editors.value.js,'ui/style.css':editors.value.css}},validationErrors:lastValidationErrors.value}) } catch(cause) { error.value=String(cause) } finally { aiLoading.value=false } }
function applyAiResult(){ if(!aiResult.value)return; Object.assign(draft,aiResult.value.manifest); editors.value={html:aiResult.value.files['ui/index.html']||'',js:aiResult.value.files['ui/main.js']||'',css:aiResult.value.files['ui/style.css']||''}; status.value='AI 草稿已应用，请保存并验证'; aiResult.value=null }
async function saveAiSettings(){ try { aiSettings.value=(await props.api.setAiSettings(structuredClone(aiSettings.value))).settings.ai; status.value='AI 设置已保存'; settingsOpen.value=false } catch(cause) { error.value=String(cause) } }
async function install(plugin: NonNullable<MarketCatalog['plugins']>[number]){ try { const installed=await props.api.installMarketPlugin(plugin); plugins.value=[...plugins.value.filter(item=>item.manifest.id!==installed.manifest.id),installed] } catch(cause) { error.value=String(cause) } }
async function uninstall(id:string){ await props.api.uninstallPlugin(id); await loadPlugins() }
async function openPluginFromNavigation(id:string){ await openPlugin(id) }
async function openPlugin(id:string){ runtime.value=await props.api.launchPlugin(id); current.value='插件市场' }
async function closeRuntime(){ if(runtime.value)await props.api.closePlugin(runtime.value.token); runtime.value=null }
function pluginAction(id:string){ return installedById.value.get(id) }
onMounted(async()=>{ await loadPlugins(); try { aiSettings.value=(await props.api.readSettings()).settings.ai } catch(cause){ error.value=String(cause) } })
watch(current,page=>{if(page==='插件市场'&&!market.value)loadMarket()})
</script>
<template>
<div class="shell"><aside><div class="brand">NEXTLEEK <span>CREATOR</span></div><nav aria-label="主导航"><button v-for="page in pages" :key="page" :data-page="page" :class="{active:current===page}" @click="current=page">{{page}}</button><button v-for="plugin in pluginNavItems" :key="plugin.manifest.id" class="plugin-nav" :data-page="plugin.manifest.name" @click="openPluginFromNavigation(plugin.manifest.id)">{{plugin.manifest.navigation?.label||plugin.manifest.name}}</button></nav><div class="sidebar-foot"><span data-test="version">v0.1.0</span><button data-test="settings" class="settings-link" @click="settingsOpen=true">设置</button></div></aside><main>
<section v-if="runtime" class="runtime-view"><button class="btn ghost" data-test="runtime-back" @click="closeRuntime">← 返回插件市场</button><div class="runtime-frame" :data-trusted="runtime.trusted"><iframe :title="runtime.manifest.name" sandbox="allow-scripts" :srcdoc="runtime.entryHtml" /></div></section>
<section v-else-if="current==='首页'" class="hero"><p class="eyebrow">RUST MICROKERNEL / TAURI 2</p><h1>欢迎使用 NextLeek Creator</h1><p>创建、验证并运行你的 JavaScript 插件。</p><div class="metrics"><article><b>{{plugins.length}}</b><span>已安装插件</span></article><article><b>0</b><span>原生 Sidecar</span></article><article><b>100%</b><span>声明式</span></article></div></section>
<section v-else-if="current==='创造模式'" class="page-section"><p class="eyebrow">ISOLATED WORKSPACE</p><h1>创造模式</h1><div class="creator-layout"><article class="form-grid"><label>插件 ID<input v-model="draft.id"></label><label>名称<input v-model="draft.name"></label><label>版本<input v-model="draft.version"></label><label>作者<input v-model="draft.author"></label><label class="wide">描述<input v-model="draft.description"></label><label class="wide">HTML<textarea v-model="editors.html"></textarea></label><label class="wide">JavaScript<textarea v-model="editors.js"></textarea></label><label class="wide">CSS<textarea v-model="editors.css"></textarea></label><div class="button-row"><button data-test="create" class="btn primary" @click="create">保存并验证</button><button data-test="package" class="btn" @click="pack">生成 .nlplugin</button></div><strong v-if="status" class="success">{{status}}</strong><p v-if="error" class="error">{{error}}</p><pre v-if="packageArtifact" class="package-result">文件：{{packageArtifact.path}}
SHA-256：{{packageArtifact.sha256}}
大小：{{packageArtifact.size}} bytes
文件：{{packageArtifact.files.join(', ')}}</pre></article><aside class="ai-panel"><h2>AI 创造助手</h2><p class="muted">描述插件需求，生成结果不会自动覆盖编辑器。</p><textarea v-model="aiPrompt" placeholder="请输入插件需求"></textarea><button class="btn primary" data-test="ai-generate" :disabled="aiLoading||!aiSettings.enabled" @click="generate">{{aiLoading?'生成中…':'生成插件草稿'}}</button><div v-if="aiResult" class="ai-result"><p>{{aiResult.explanation}}</p><small>{{Object.keys(aiResult.files).join(' · ')}}</small><button class="btn" data-test="ai-apply" @click="applyAiResult">应用到编辑器</button></div></aside></div></section>
<section v-else class="page-section"><header class="section-head"><div><p class="eyebrow">GITHUB MARKETPLACE</p><h1>插件市场</h1></div><button class="btn ghost" :disabled="loading" @click="loadMarket">刷新市场</button></header><p v-if="error" class="error">{{error}}</p><div v-if="plugins.length" class="installed-strip"><h2>已安装</h2><span v-for="plugin in plugins" :key="plugin.manifest.id" class="pill">{{plugin.manifest.name}} · {{plugin.manifest.version}} · {{plugin.source || (plugin.builtin?'builtin':'local-import')}}</span></div><div v-if="runtime===null&&!market" class="empty"><p>从 GitHub 加载官方和社区插件。</p><button class="btn primary" @click="loadMarket">加载市场</button></div><div v-else class="cards"><article v-for="plugin in market?.plugins||[]" :key="plugin.id" class="plugin-card"><div class="card-top"><div><h2>{{plugin.name}}</h2><code>{{plugin.id}}</code></div><span class="version">v{{plugin.version}}</span></div><p>{{plugin.description}}</p><small>{{plugin.author}} · {{plugin.permissions.join(' · ')||'无额外权限'}}</small><div class="card-actions"><template v-if="pluginAction(plugin.id)"><button class="btn primary" :data-test="`open-${plugin.id}`" @click="openPlugin(plugin.id)">打开</button><button class="btn" :data-test="`uninstall-${plugin.id}`" @click="uninstall(plugin.id)">卸载</button></template><button v-else class="btn primary" :data-test="`install-${plugin.id}`" @click="install(plugin)">安装</button></div></article></div></section>
</main><div v-if="settingsOpen" class="modal" @click.self="settingsOpen=false"><article><div class="section-head"><h2>设置</h2><button class="btn ghost" @click="settingsOpen=false">关闭</button></div><p>版本 v0.1.0</p><p class="muted">插件数据和草稿保存在程序旁的 Data 目录。</p><h3>AI 设置</h3><label><input v-model="aiSettings.enabled" type="checkbox">启用 AI</label><label>Base URL<input v-model="aiSettings.baseUrl"></label><label>模型<input v-model="aiSettings.model"></label><label>API Key<input v-model="aiSettings.apiKey" type="password" autocomplete="off"></label><label>Temperature<input v-model.number="aiSettings.temperature" type="number" min="0" max="2" step="0.1"></label><button class="btn primary" data-test="save-ai-settings" @click="saveAiSettings">保存 AI 设置</button></article></div>
</div>
</template>
<style src="./style.css"></style>
