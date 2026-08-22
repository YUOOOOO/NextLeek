<script setup lang="ts">
import { ref, watch } from 'vue'
import type { KernelApi, PackageInventory, PluginManifest } from './api'
const props = defineProps<{api:KernelApi}>()
const pages = ['首页','插件','创造模式','运行时'] as const
const current = ref<typeof pages[number]>('首页')
const plugins = ref<PluginManifest[]>([])
const status = ref('')
const inventory = ref<PackageInventory|null>(null)
const draft:PluginManifest = {id:'com.example.created',name:'我的插件',version:'0.1.0',entry:'ui/index.html',capabilities:['notes.read'],permissions:['storage:local']}
watch(current, async page => { if(page==='插件') plugins.value=await props.api.listPlugins() })
async function create(){ await props.api.createDraft('creator-draft',draft); const report=await props.api.validateDraft('creator-draft'); status.value=report.valid?'验证通过':report.errors.join(', ') }
async function pack(){ inventory.value=await props.api.packageDraft('creator-draft') }
</script>

<template>
<div class="shell">
  <aside><div class="brand">NEXTLEEK <span>CREATOR</span></div><nav><button v-for="page in pages" :key="page" :data-page="page" :class="{active:current===page}" @click="current=page">{{ page }}</button></nav><small>Declarative runtime · 安全隔离</small></aside>
  <main>
    <section v-if="current==='首页'" class="hero"><p class="eyebrow">RUST MICROKERNEL / TAURI 2</p><h1>欢迎使用 NextLeek Creator</h1><p>在隔离工作区中组合能力、验证权限，并打包声明式插件。</p><div class="metrics"><article><b>2</b><span>内置插件</span></article><article><b>0</b><span>原生 Sidecar</span></article><article><b>100%</b><span>声明式</span></article></div></section>
    <section v-else-if="current==='插件'"><p class="eyebrow">CAPABILITY REGISTRY</p><h1>插件</h1><div class="cards"><article v-for="plugin in plugins" :key="plugin.id"><h2>{{plugin.name}}</h2><code>{{plugin.id}}</code><p>{{plugin.capabilities.join(' · ')}}</p><span v-for="permission in plugin.permissions" :key="permission" class="pill">{{permission}}</span></article></div></section>
    <section v-else-if="current==='创造模式'"><p class="eyebrow">ISOLATED WORKSPACE</p><h1>创造模式</h1><article class="form"><label>模板<select><option>声明式界面插件</option></select></label><label>插件 ID<input v-model="draft.id"></label><label>能力<input :value="draft.capabilities.join(', ')" readonly></label><div class="permission">权限：storage:local（不允许原生程序与 Sidecar）</div><button data-test="create" @click="create">创建并验证</button><button data-test="package" class="secondary" @click="pack">生成打包清单</button><strong>{{status}}</strong><pre v-if="inventory">{{JSON.stringify(inventory,null,2)}}</pre></article></section>
    <section v-else><p class="eyebrow">RUNTIME HEALTH</p><h1>运行时</h1><article class="runtime"><i></i><div><h2>微内核运行正常</h2><p>declarative-only · 文件路径由 Rust 校验</p></div></article></section>
  </main>
</div>
</template>
<style src="./style.css"></style>
