<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import NewsTicker from './components/NewsTicker.vue'
import LeftPanel from './components/LeftPanel.vue'
import CenterPanel from './components/CenterPanel.vue'
import RightPanel from './components/RightPanel.vue'

const marketOpen = ref(false)

function checkMarketStatus() {
  const now = new Date()
  const h = now.getHours(), m = now.getMinutes()
  const t = h * 60 + m
  const day = now.getDay()
  marketOpen.value = day >= 1 && day <= 5 && ((t >= 570 && t < 690) || (t >= 780 && t < 900))
}

let timer: number
onMounted(() => { checkMarketStatus(); timer = window.setInterval(checkMarketStatus, 60000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="home">
    <header class="top-bar">
      <div class="left">
        <span class="logo">📈</span>
        <span class="title">NextLeek</span>
        <span class="asset-tag">股票</span>
      </div>
      <div class="center">
        <NewsTicker />
      </div>
      <div class="right">
        <span :class="['status', { open: marketOpen }]" :title="marketOpen ? '交易时间：9:30-11:30 / 13:00-15:00' : '休市中，下次开盘：工作日 9:30'">{{ marketOpen ? '开盘中' : '已收盘' }}</span>
        <button class="settings-btn">⚙</button>
      </div>
    </header>
    <main class="main-layout">
      <LeftPanel />
      <CenterPanel />
      <RightPanel />
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
  background: rgba(74, 144, 217, 0.2); color: #4a90d9;
  border: 1px solid rgba(74, 144, 217, 0.4); border-radius: 4px;
}
.center { flex: 1; display: flex; justify-content: center; margin: 0 1rem; }
.right { display: flex; align-items: center; gap: 0.6em; flex-shrink: 0; }
.status {
  font-size: 0.75em; padding: 0.2em 0.5em; border-radius: 4px;
  background: rgba(255, 80, 80, 0.2); color: #ff6b6b;
}
.status.open { background: rgba(80, 255, 80, 0.2); color: #51cf66; }
.settings-btn {
  background: none; border: none; color: rgba(255, 255, 255, 0.7);
  font-size: 1.1em; cursor: pointer;
}
.settings-btn:hover { color: #fff; }
.main-layout {
  display: flex; height: calc(100vh - 45px); gap: 0.75rem; padding: 0.75rem;
}
@media (max-width: 768px) {
  .top-bar { padding: 0.5rem; }
  .center { display: none; }
  .main-layout { flex-direction: column; height: auto; padding: 0.5rem; }
}
</style>
