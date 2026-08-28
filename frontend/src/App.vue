<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isRotation = computed(() => route.path.startsWith('/rotation') || route.path === '/')
const isStockPick = computed(() => route.path.startsWith('/stock-pick'))
const isFactors = computed(() => route.path.startsWith('/factors'))

const now = ref(new Date())
let clock: number | undefined

function beijingNow(): Date {
  // 用 Asia/Shanghai 格式化，避免本机时区把开闭市算错
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now.value)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '0'
  return new Date(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  )
}

const clockText = computed(() => {
  const d = beijingNow()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

type SessionKind = 'closed' | 'auction' | 'open' | 'close-auction'

/** A 股时段：开盘集合 09:15–09:25，连续 09:30–11:30 / 13:00–14:57，尾盘集合 14:57–15:00 */
function sessionKindAt(d: Date): SessionKind {
  const wd = d.getDay()
  if (wd === 0 || wd === 6) return 'closed'
  const mins = d.getHours() * 60 + d.getMinutes()
  if (mins >= 9 * 60 + 15 && mins < 9 * 60 + 25) return 'auction'
  if (mins >= 9 * 60 + 30 && mins < 11 * 60 + 30) return 'open'
  if (mins >= 13 * 60 && mins < 14 * 60 + 57) return 'open'
  if (mins >= 14 * 60 + 57 && mins < 15 * 60) return 'close-auction'
  return 'closed'
}

const sessionKind = computed(() => sessionKindAt(beijingNow()))
const marketOpen = computed(
  () => sessionKind.value === 'open' || sessionKind.value === 'auction' || sessionKind.value === 'close-auction',
)
const marketLabel = computed(() => {
  switch (sessionKind.value) {
    case 'auction':
      return '集合竞价'
    case 'close-auction':
      return '尾盘集合竞价'
    case 'open':
      return '开市'
    default:
      return '休市'
  }
})
const sessionTitle = computed(() => {
  switch (sessionKind.value) {
    case 'auction':
      return '开盘集合竞价 09:15–09:25'
    case 'close-auction':
      return '尾盘集合竞价 14:57–15:00'
    case 'open':
      return '连续竞价 09:30–11:30、13:00–14:57'
    default:
      return '非交易时段'
  }
})

onMounted(() => {
  clock = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
})
onUnmounted(() => {
  if (clock) window.clearInterval(clock)
})
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
            :class="{ active: isStockPick }"
            to="/stock-pick"
          >
            选股
          </router-link>
          <router-link
            class="menu-item"
            :class="{ active: isFactors }"
            to="/factors"
          >
            因子池
          </router-link>
        </nav>

        <div class="market-clock" :title="sessionTitle">
          <div class="session-row">
            <time class="clock">{{ clockText }}</time>
            <span :class="['session', sessionKind]">{{ marketLabel }}</span>
          </div>
          <div class="session-times" aria-label="竞价时段">
            <span :class="{ on: sessionKind === 'auction' }">集合 09:15–09:25</span>
            <span :class="{ on: sessionKind === 'close-auction' }">尾盘 14:57–15:00</span>
          </div>
        </div>
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
  min-height: 52px;
  height: auto;
  padding-top: 8px;
  padding-bottom: 8px;
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
  flex: 1;
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

.market-clock {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
  white-space: nowrap;
}

.session-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.clock {
  font-variant-numeric: tabular-nums;
  font-size: 0.82rem;
  color: rgba(232, 234, 237, 0.72);
}

.session {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
}

.session.open {
  color: #69f0ae;
  background: rgba(105, 240, 174, 0.12);
}

.session.auction,
.session.close-auction {
  color: #ffd54f;
  background: rgba(255, 213, 79, 0.14);
}

.session.closed {
  color: rgba(232, 234, 237, 0.55);
  background: rgba(255, 255, 255, 0.06);
}

.session-times {
  display: flex;
  gap: 10px;
  font-size: 0.66rem;
  color: rgba(232, 234, 237, 0.42);
}

.session-times .on {
  color: #ffd54f;
  font-weight: 700;
}

.app-main {
  min-height: calc(100vh - 64px);
}

@media (max-width: 720px) {
  .topnav-inner {
    gap: 12px;
  }
  .clock {
    font-size: 0.72rem;
  }
  .session-times {
    font-size: 0.6rem;
    gap: 6px;
  }
}
</style>
