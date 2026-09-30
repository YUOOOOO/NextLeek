<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";

const route = useRoute();
const routeLabels: Record<string, string> = { "/": "仪表盘", "/strategies": "策略工作台", "/research": "因子研究", "/live": "实时运行" };
const currentSection = computed(() => routeLabels[route.path] ?? "工作空间");

const navigation = [
  { label: "仪表盘", mark: "▦", to: "/", ready: true },
  { label: "策略工作台", mark: "⌘", to: "/strategies", ready: true },
  { label: "因子研究", mark: "ƒ", to: "/research", ready: false },
  { label: "回测中心", mark: "↗", to: "/backtests", ready: false },
  { label: "实盘监控", mark: "●", to: "/live", ready: false },
  { label: "数据中心", mark: "≋", to: "/data", ready: false },
  { label: "系统设置", mark: "⚙", to: "/settings", ready: false },
];
</script>

<template>
  <div class="app-frame">
    <header class="topbar">
      <RouterLink class="logo" to="/"><span class="logo-mark">N</span><strong>NextLeek</strong><em>v3</em></RouterLink>
      <nav class="top-breadcrumb" aria-label="面包屑"><RouterLink to="/">工作空间</RouterLink><span>/</span><strong>{{ currentSection }}</strong></nav>
      <div class="topbar-actions">
        <div class="data-health"><i></i><span>数据正常</span><small>演示快照</small></div>
        <button class="notice-button" type="button">通知<b>3</b></button>
        <button class="user-menu" type="button"><span>YL</span><div><strong>量化者</strong><small>研究账户</small></div></button>
      </div>
    </header>

    <aside class="side-nav">
      <p class="nav-label">工作空间</p>
      <nav>
        <template v-for="item in navigation" :key="item.label">
          <RouterLink v-if="item.ready" :to="item.to"><span class="nav-mark">{{ item.mark }}</span>{{ item.label }}</RouterLink>
          <div v-else class="nav-pending"><span class="nav-mark">{{ item.mark }}</span>{{ item.label }}<small>待实现</small></div>
        </template>
      </nav>
      <div class="runtime-card"><div><i></i><strong>Runtime 在线</strong></div><p>隔离运行器心跳正常</p><span>延迟 18 ms</span></div>
    </aside>

    <main class="main-content"><RouterView /></main>
  </div>
</template>
