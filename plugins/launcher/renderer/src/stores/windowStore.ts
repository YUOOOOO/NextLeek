import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useDesktopStore } from '../../../../../src/client/store'
import defaultAvatar from '../assets/image/default.png'

export const DEFAULT_AVATAR = defaultAvatar
export type SearchMode = 'aggregate' | 'list'

// 原版窗口展示状态保留在独立 Pinia 实例，隐藏再显示不会重置选择模式。
export const useWindowStore = defineStore('ztools-launcher-window', () => {
  const desktop = useDesktopStore()
  const searchMode = ref<SearchMode>('aggregate')
  const recentRows = ref(2)
  const pinnedRows = ref(2)
  // 紧凑标题栏使用宿主已支持的设置，不建立第二套存储。
  const compactMainWindowHeader = computed(() => desktop.snapshot?.settings.compact ?? false)
  return { searchMode, recentRows, pinnedRows, compactMainWindowHeader }
})
