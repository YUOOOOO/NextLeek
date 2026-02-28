<script setup lang="ts">
// 基金页面占位 — 待后续完善
</script>

<template>
  <div class="home">
    <header class="top-bar">
      <div class="left">
        <span class="logo">💹</span>
        <span class="title">NextLeek</span>
        <span class="asset-tag">基金</span>
      </div>
      <div class="right">
        <span class="nav-hint">净值日期：2024-01-08</span>
        <button class="settings-btn">⚙</button>
      </div>
    </header>
    <main class="main-layout">
      <div class="placeholder-content">
        <div class="icon">💹</div>
        <div class="text">基金页面开发中...</div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.home { width: 100%; min-height: 100vh; }
.top-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 1rem; background: #1a2536; border-bottom: 1px solid #2a3a4e;
}
.left { display: flex; align-items: center; gap: 0.5em; flex-shrink: 0; }
.logo { font-size: 1.4em; }
.title { font-size: 1em; font-weight: 600; }
.asset-tag {
  font-size: 0.72em; padding: 0.15em 0.6em;
  background: rgba(82, 196, 26, 0.2); color: #52c41a;
  border: 1px solid rgba(82, 196, 26, 0.4); border-radius: 4px;
}
.right { display: flex; align-items: center; gap: 0.6em; flex-shrink: 0; }
.nav-hint { font-size: 0.75em; color: rgba(255,255,255,0.45); }
.settings-btn {
  background: none; border: none; color: rgba(255, 255, 255, 0.7);
  font-size: 1.1em; cursor: pointer;
}
.settings-btn:hover { color: #fff; }
.main-layout {
  display: flex; height: calc(100vh - 45px);
  align-items: center; justify-content: center;
}
.placeholder-content {
  display: flex; flex-direction: column; align-items: center; gap: 1rem;
  color: rgba(255,255,255,0.3);
}
.icon { font-size: 3em; }
.text { font-size: 1.1em; }
</style>
