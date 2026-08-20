<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isRotation = computed(() => route.path.startsWith('/rotation') || route.path === '/')
const isFactors = computed(() => route.path.startsWith('/factors'))
</script>

<template>
  <div class="app-shell">
    <header class="topnav">
      <div class="topnav-inner">
        <router-link class="brand" to="/rotation">
          <img class="brand-mark" src="/favicon.svg" alt="" width="22" height="22" />
          <span class="brand-name">NextLeek</span>
        </router-link>

        <nav class="menu" aria-label="主导航">
          <router-link
            class="menu-item"
            :class="{ active: isRotation }"
            to="/rotation"
          >
            轮动
          </router-link>
          <router-link
            class="menu-item"
            :class="{ active: isFactors }"
            to="/factors"
          >
            因子池
          </router-link>
        </nav>
      </div>
    </header>

    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: #141729;
  color: rgba(255, 255, 255, 0.87);
}

.topnav {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(20, 23, 41, 0.92);
  backdrop-filter: blur(10px);
}

.topnav-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 16px;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 28px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: #e8eaed;
  flex-shrink: 0;
}

.brand-mark {
  display: block;
  border-radius: 4px;
}

.brand-name {
  font-weight: 700;
  letter-spacing: -0.02em;
  font-size: 0.98rem;
}

.menu {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.menu-item {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  text-decoration: none;
  color: rgba(232, 234, 237, 0.62);
  font-size: 0.9rem;
  font-weight: 600;
  transition: color 0.15s ease, background 0.15s ease;
}

.menu-item:hover {
  color: #e8eaed;
  background: rgba(255, 255, 255, 0.05);
}

.menu-item.active {
  color: #69f0ae;
  background: rgba(105, 240, 174, 0.1);
}

.app-main {
  min-height: calc(100vh - 52px);
}
</style>
