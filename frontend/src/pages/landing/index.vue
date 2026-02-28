<script setup lang="ts">
import { useRouter } from 'vue-router'
import AssetSelector from './components/AssetSelector.vue'

const router = useRouter()

function onEnter(type: string) {
  router.push(`/home/${type}`)
}
</script>

<template>
  <div class="landing">
    <div class="header">
      <div class="logo">📈</div>
      <div class="info">
        <div class="name">NextLeek</div>
        <div class="subtitle">AI新时代韭菜</div>
      </div>
    </div>
    <AssetSelector @enter="onEnter" />
  </div>
</template>

<style scoped>
.landing {
  max-width: 400px;
  width: 100%;
  margin: 0 auto;
  padding: 2rem 1rem;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.header { display: flex; align-items: center; gap: 0.75em; margin-bottom: 1.5rem; }
.logo { font-size: 2.2em; }
.name { font-size: 1.1em; font-weight: 600; line-height: 1.2; }
.subtitle { font-size: 0.85em; color: rgba(255, 255, 255, 0.5); }
</style>
