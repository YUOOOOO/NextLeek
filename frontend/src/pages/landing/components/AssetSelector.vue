<script setup lang="ts">
import { ref, computed } from 'vue'

const tabs = ['股票', '基金', '黄金'] as const
const activeTab = ref<(typeof tabs)[number]>('股票')

const placeholder = computed(() => {
  if (activeTab.value === '股票') return '搜索股票代码或名称'
  if (activeTab.value === '基金') return '搜索基金代码或名称'
  return ''
})

const searchQuery = ref('')

const emit = defineEmits<{ enter: [] }>()

function onEnter() {
  emit('enter')
}

function onGoldClick() {
  emit('enter')
}
</script>

<template>
  <div class="asset-selector">
    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab"
        :class="['tab', { active: activeTab === tab }]"
        @click="activeTab = tab"
      >
        {{ tab }}
      </button>
    </div>

    <div class="content">
      <input
        v-if="activeTab !== '黄金'"
        v-model="searchQuery"
        type="text"
        :placeholder="placeholder"
        class="search-input"
        @keydown.enter="onEnter"
      />
      <button v-else class="gold-btn" @click="onGoldClick">
        进入黄金行情 →
      </button>
    </div>
  </div>
</template>

<style scoped>
.asset-selector { width: 100%; }
.tabs { display: flex; border-radius: 10px; padding: 3px; }
.tab {
  flex: 1; padding: 0.5em 0; border: none; border-radius: 8px;
  background: transparent; color: rgba(255, 255, 255, 0.5);
  cursor: pointer; font-size: 0.85em; font-weight: 500; transition: all 0.2s;
}
.tab.active { background: #1a2536; color: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
.content { margin-top: 1rem; }
.search-input {
  width: 100%; padding: 0.75em 1em; font-size: 0.85em;
  border: 1px solid #444; border-radius: 10px; background: #1a2536;
  color: rgba(255, 255, 255, 0.87); outline: none; transition: border-color 0.2s;
}
.search-input:focus { border-color: #4a90d9; }
.search-input::placeholder { color: #aaa; }
.gold-btn {
  width: 100%; padding: 0.75em 1em; font-size: 0.85em; border-radius: 10px;
  background: linear-gradient(135deg, #f0c27f, #d4a24e);
  color: #fff; border: none; cursor: pointer; font-weight: 500; transition: opacity 0.2s;
}
.gold-btn:hover { opacity: 0.9; }
</style>
