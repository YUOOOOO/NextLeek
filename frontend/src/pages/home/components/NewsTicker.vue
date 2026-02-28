<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const newsList = ref([
  '沪指高开0.5%，创业板涨1.2%',
  '央行：将继续实施稳健的货币政策',
  '北向资金今日净流入超50亿元',
  '新能源板块集体走强，多股涨停',
])

const innerRef = ref<HTMLElement>()
let idx = 0

let newsTimer: number
onMounted(() => {
  newsTimer = window.setInterval(() => {
    const el = innerRef.value!
    const items = el.children as HTMLCollectionOf<HTMLElement>
    const next = (idx + 1) % newsList.value.length
    items[1].textContent = newsList.value[next]
    el.style.transition = 'transform 0.5s ease'
    el.style.transform = 'translateY(-50%)'
    const onEnd = () => {
      el.removeEventListener('transitionend', onEnd)
      requestAnimationFrame(() => {
        el.style.transition = 'none'
        el.style.transform = ''
        items[0].textContent = newsList.value[next]
        idx = next
      })
    }
    el.addEventListener('transitionend', onEnd)
  }, 3000)
})
onUnmounted(() => clearInterval(newsTimer))
</script>

<template>
  <div class="news-ticker">
    <div ref="innerRef" class="news-inner">
      <div class="news-item">沪指高开0.5%，创业板涨1.2%</div>
      <div class="news-item"></div>
    </div>
  </div>
</template>

<style scoped>
.news-ticker {
  width: 400px;
  height: 2.4em;
  overflow: hidden;
  border: 1px solid #2a3a4e;
  border-radius: 8px;
  padding: 0 0.8em;
  font-size: 0.75em;
  color: rgba(255, 255, 255, 0.6);
}
.news-inner { height: 200%; }
.news-item {
  height: 50%;
  line-height: 2.4em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 768px) {
  .news-ticker { width: 100%; }
}
</style>
