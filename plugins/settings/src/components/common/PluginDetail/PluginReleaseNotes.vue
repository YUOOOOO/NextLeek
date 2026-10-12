<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { PluginReleaseHistoryItem } from '@shared/pluginReleaseHistory'

const props = defineProps<{ pluginName: string; version?: string }>()
const items = ref<PluginReleaseHistoryItem[]>([])
const currentVersion = ref('')
const loading = ref(false)
const error = ref('')
const nextOffset = ref<number>()
let requestId = 0
const renderedNotes = computed(() =>
  items.value.map((item) => ({
    ...item,
    html: DOMPurify.sanitize(marked.parse(item.releaseNotes, { async: false }), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button']
    })
  }))
)

/**
 * 按需加载日志，并隔离切换插件或卸载后的迟到响应。
 * @param more 是否追加下一页历史记录。
 * @returns 请求完成后结束的 Promise。
 */
async function load(more = false): Promise<void> {
  const id = ++requestId
  loading.value = true
  error.value = ''
  try {
    const result = await window.ztools.internal.getPluginReleaseHistory(
      props.pluginName,
      more ? nextOffset.value : 0
    )
    if (id !== requestId) return
    items.value = more ? [...items.value, ...result.items] : result.items
    nextOffset.value = result.nextOffset
    currentVersion.value = result.currentVersion
    error.value = result.error || ''
  } catch {
    if (id === requestId) error.value = '更新日志加载失败，请重试'
  } finally {
    if (id === requestId) loading.value = false
  }
}

/**
 * 使用系统浏览器打开日志中的网页链接，禁止导航到应用内部页面。
 * @param event 日志区域点击事件。
 * @returns 无返回值。
 */
function openLink(event: MouseEvent): void {
  const anchor = (event.target as Element).closest('a')
  if (!anchor) return
  event.preventDefault()
  const href = anchor.getAttribute('href') || ''
  if (/^https?:\/\//i.test(href)) window.ztools.shellOpenExternal(href)
}

watch(
  () => [props.pluginName, props.version],
  () => {
    items.value = []
    nextOffset.value = undefined
    void load()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  requestId++
})
</script>

<template>
  <section class="release-notes" aria-label="更新日志" @click="openLink">
    <div v-if="loading" class="release-state">加载中...</div>
    <div v-if="error" class="release-state" role="status">
      {{ error }}
      <button class="btn btn-sm" :disabled="loading" @click="load(false)">重试</button>
    </div>
    <div v-if="!loading && !error && !items.length" class="release-state">暂无更新日志</div>
    <article v-for="item in renderedNotes" :key="item.version" class="release-item">
      <div class="release-heading">
        <strong>v{{ item.version.replace(/^v/, '') }}</strong>
        <span v-if="item.version.replace(/^v/, '') === currentVersion.replace(/^v/, '')"
          >当前版本</span
        >
        <time v-if="item.publishedAt">{{
          new Date(item.publishedAt).toLocaleDateString('zh-CN')
        }}</time>
      </div>
      <div class="release-body">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="item.releaseNotes" class="markdown-content" v-html="item.html"></div>
        <p v-else class="release-state">该版本暂无更新日志</p>
      </div>
    </article>
    <button
      v-if="nextOffset !== undefined"
      class="btn btn-sm"
      :disabled="loading"
      @click="load(true)"
    >
      查看更多版本
    </button>
  </section>
</template>

<style scoped>
.release-item {
  border-bottom: 1px solid var(--divider-color);
}
.release-heading {
  width: 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 8px;
  border: 0;
  background: transparent;
  color: var(--text-color);
  text-align: left;
}
.release-heading span,
.release-heading time {
  font-size: 12px;
  color: var(--text-secondary);
}
.release-body {
  padding: 0 8px 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.release-state {
  padding: 20px 8px;
  color: var(--text-secondary);
  font-size: 13px;
}
.markdown-content {
  font-size: 14px;
  line-height: 1.7;
}
.markdown-content :deep(pre) {
  max-width: 100%;
  overflow: auto;
  padding: 12px;
  background: var(--card-bg);
}
.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
}
.markdown-content :deep(a) {
  color: var(--primary-color);
}
.markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
}
.markdown-content :deep(td),
.markdown-content :deep(th) {
  padding: 6px;
  border: 1px solid var(--divider-color);
}
</style>
