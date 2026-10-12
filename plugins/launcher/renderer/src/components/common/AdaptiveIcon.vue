<template>
  <img
    ref="imgRef"
    :src="displaySrc"
    :class="['adaptive-icon', adaptiveClass]"
    :alt="alt"
    v-bind="$attrs"
    @error="onError"
  />
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{ src: string; alt?: string; forceAdaptive?: boolean }>()
const emit = defineEmits<{ error: [event: Event] }>()
const imgRef = ref<HTMLImageElement>()
const isVisible = ref(false)
const displaySrc = computed(() => isVisible.value ? props.src : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E")
const adaptiveClass = computed(() => props.forceAdaptive ? 'force-adaptive' : '')
let observer: IntersectionObserver | undefined
// 保留原版懒加载，不伪造宿主尚未提供的图标分析结果。
function setupObserver(): void {
  if (!imgRef.value) return
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { isVisible.value = true; observer?.disconnect() }
  }, { rootMargin: '200px' })
  observer.observe(imgRef.value)
}
// 图标失败交由原版列表展示文字占位。
function onError(event: Event): void { emit('error', event) }
onMounted(setupObserver)
onBeforeUnmount(() => observer?.disconnect())
</script>
<script lang="ts">export default { name: 'AdaptiveIcon', inheritAttrs: false }</script>
<style scoped>
.adaptive-icon {
  background: transparent;
  display: block;
}

/* 深色模式下反色 */
.adaptive-icon.adaptive-invert {
  filter: invert(1) brightness(1.1);
}

/* 强制自适应模式 - 仅在深色模式下应用 */
@media (prefers-color-scheme: dark) {
  .adaptive-icon.force-adaptive {
    filter: invert(1) brightness(1.1);
  }
}
</style>
