<script setup lang="ts">
const searchQuery = defineModel<string>('searchQuery', { default: '' })

const indices = [
  { name: '上证指数', code: '000001', price: '3,342.66', change: '+1.23%', up: true },
  { name: '深证成指', code: '399001', price: '10,876.54', change: '-0.45%', up: false },
  { name: '创业板指', code: '399006', price: '2,156.78', change: '+2.10%', up: true },
]

const watchlist = [
  { name: '贵州茅台', code: '600519', price: '1,856.00', change: '+1.56%', up: true },
  { name: '宁德时代', code: '300750', price: '218.50', change: '-0.82%', up: false },
  { name: '比亚迪', code: '002594', price: '286.30', change: '+3.21%', up: true },
]
</script>

<template>
  <aside class="panel-left">
    <div class="indices-row">
      <div class="card" v-for="item in indices" :key="item.code">
        <div class="idx-name">{{ item.name }}</div>
        <div :class="['idx-price', item.up ? 'up' : 'down']">{{ item.price }}</div>
        <div :class="['idx-change', item.up ? 'up' : 'down']">{{ item.change }}</div>
      </div>
    </div>
    <div class="search-section">
      <input v-model="searchQuery" class="search-input" placeholder="搜索股票代码或名称" />
    </div>
    <div class="watchlist">
      <div class="wl-title">自选股</div>
      <div class="wl-item" v-for="w in watchlist" :key="w.code">
        <span class="wl-name">{{ w.name }}</span>
        <span :class="['wl-change', w.up ? 'up' : 'down']">{{ w.change }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.panel-left {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.indices-row {
  display: flex;
  gap: 0.5rem;
}
.card {
  flex: 1;
  background: #1a2536;
  border: 1px solid #2a3a4e;
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
}
.idx-name { font-size: 0.7em; color: rgba(255,255,255,0.5); }
.idx-price { font-size: 0.85em; font-weight: 600; }
.idx-change { font-size: 0.7em; }
.up { color: #ef5350; }
.down { color: #26a69a; }
.search-section { margin-top: 0.25rem; }
.search-input {
  width: 100%;
  padding: 0.5em 0.7em;
  font-size: 0.8em;
  border: 1px solid #2a3a4e;
  border-radius: 8px;
  background: #1a2536;
  color: rgba(255,255,255,0.87);
  outline: none;
}
.search-input:focus { border-color: #4a90d9; }
.watchlist {
  background: #1a2536;
  border: 1px solid #2a3a4e;
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  flex: 1;
  overflow-y: auto;
}
.wl-title { font-size: 0.8em; font-weight: 600; margin-bottom: 0.4rem; }
.wl-item {
  display: flex;
  justify-content: space-between;
  padding: 0.3em 0;
  font-size: 0.8em;
  cursor: pointer;
}
.wl-item:hover { background: rgba(255,255,255,0.03); }
.wl-name { color: rgba(255,255,255,0.8); }

@media (max-width: 768px) {
  .panel-left { width: 100%; }
}
</style>
