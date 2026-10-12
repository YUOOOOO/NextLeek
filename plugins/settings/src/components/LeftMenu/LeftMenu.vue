<!-- MIT Copyright (c) 2025 lzx8589561; adapted to the NextTools Cordis desktop contract. -->
<script setup lang="ts">
import { settingMenu } from '../../navigation'
defineProps<{ active: string }>()
const emit = defineEmits<{ select: [name: string] }>()
// 保留上游菜单项结构，具体导航由设置壳决定。
function setActiveMenu(item: typeof settingMenu[number]) { emit('select', item.name) }
</script>
<template>
  <!-- 左侧菜单 -->
  <div class="settings-sidebar">
    <div class="menu-list">
      <div
        v-for="menuRoute in settingMenu"
        :key="menuRoute.name"
        class="menu-item"
        :class="{ active: active === menuRoute.name }"
        @click="setActiveMenu(menuRoute)"
      >
        <div :class="menuRoute.meta?.menu?.icon ?? ''" class="menu-icon" style="font-size: 18px" />
        <span class="menu-label">{{ menuRoute.meta?.menu?.label ?? '' }}</span>
      </div>
    </div>

  </div>
</template>
<style scoped>
/* 左侧菜单 */
.settings-sidebar {
  display: flex;
  flex-direction: column;
  width: 200px;
  height: 100%;
  border-right: 1px solid var(--divider-color);
  min-height: 0;
}

.menu-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 10px;
  padding: 8px;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 10px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-color);
  border-radius: 8px;
}

.menu-item:last-child {
  margin-bottom: 0;
}

.menu-item:hover {
  background: var(--hover-bg);
}

.menu-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.account-dock {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  padding: 10px;
  text-align: left;
  transition: all 0.2s;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 8px 8px;
  border-radius: 8px;
}

.sidebar-footer.active {
  background: var(--active-bg);
}

.sidebar-footer:not(.active):hover {
  background: var(--hover-bg);
}

.notification-dock {
  position: relative;
  flex: none;
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
}

.notification-dock:hover {
  background: transparent;
  color: var(--text-color);
}

.notification-dock.active {
  background: transparent;
  color: var(--primary-color);
}

.notification-badge {
  position: absolute;
  top: 1px;
  right: 0;
  min-width: 15px;
  height: 15px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-color);
  border-radius: 8px;
  background: #ef4444;
  color: white;
  padding: 0 3px;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
}

.account-dock:hover {
  background: transparent;
  border-color: color-mix(in srgb, var(--primary-color) 35%, var(--divider-color));
}

.account-dock.active {
  background: transparent;
  color: var(--primary-color);
}

.account-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--hover-bg);
}

.account-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  font-size: 18px;
}

.account-info {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.account-info strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.account-info span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
