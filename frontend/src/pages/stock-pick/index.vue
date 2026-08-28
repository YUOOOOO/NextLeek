<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const API = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000'

type PickRow = {
  rank?: number
  code: string
  name: string
  changePct: number | null
  price: number | null
  score?: number | null
}

type StrategyDef = {
  id: string
  name: string
  principle?: string
  factor_codes?: string[]
  factor_labels?: string[]
  date?: string
  matched?: number
  universe_size?: number
  rows?: PickRow[]
  error?: string
}

type HistoryNav = {
  dates?: string[]
  current?: string | null
  prev?: string | null
  next?: string | null
  index?: number | null
  total?: number
}

const TABS = [
  { id: 'strategy', label: '策略显示' },
  { id: 'resonance', label: '共振选股' },
  { id: 'assist', label: '帮我选股' },
  { id: 'market', label: '行情分析' },
] as const

type TabId = (typeof TABS)[number]['id']

const activeTab = ref<TabId>('strategy')
const selectedStrategyId = ref('auction-long')
const strategies = ref<StrategyDef[]>([])
const asof = ref('')
const history = ref<HistoryNav>({})
const viewedDate = ref('')
const loading = ref(false)
const error = ref('')

const selectedStrategy = computed(
  () => strategies.value.find((s) => s.id === selectedStrategyId.value) || strategies.value[0],
)

const boundFactors = computed(() => {
  const s = selectedStrategy.value
  if (!s) return []
  const codes = s.factor_codes || []
  const labels = s.factor_labels || []
  return codes.map((code, i) => ({ code, label: labels[i] || code }))
})

const resultRows = computed(() => selectedStrategy.value?.rows || [])
const canPrev = computed(() => Boolean(history.value.prev))
const canNext = computed(() => Boolean(history.value.next))
const pageText = computed(() => {
  const h = history.value
  if (!h.total) return ''
  return `${h.index || 0}/${h.total}`
})
const asofText = computed(() => {
  const raw = asof.value || viewedDate.value
  if (!raw) return '—'
  const s = String(raw).replace(/-/g, '')
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return String(raw)
})

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

/** 拉 8 策略真实截面；date 有值则读历史日 */
async function refreshPicks(date = viewedDate.value) {
  loading.value = true
  error.value = ''
  try {
    const q = new URLSearchParams({ top_n: '20' })
    if (date) q.set('date', date)
    const data = await api<{ date?: string; strategies?: StrategyDef[]; history?: HistoryNav }>(
      `/api/strategy/stock-picks?${q}`,
    )
    asof.value = data.date || date || ''
    viewedDate.value = String(data.history?.current || data.date || date || '')
    history.value = data.history || {}
    strategies.value = data.strategies || []
    if (!strategies.value.some((s) => s.id === selectedStrategyId.value) && strategies.value[0]) {
      selectedStrategyId.value = strategies.value[0].id
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function goPrev() {
  if (history.value.prev) void refreshPicks(history.value.prev)
}

function goNext() {
  if (history.value.next) void refreshPicks(history.value.next)
}

function goLatest() {
  viewedDate.value = ''
  void refreshPicks('')
}

function selectStrategy(id: string) {
  selectedStrategyId.value = id
}

function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function formatPrice(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(2)
}

function formatScore(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(1)
}

onMounted(() => {
  void refreshPicks()
})
</script>

<template>
  <div class="page">
    <div class="tabs" role="tablist" aria-label="选股功能">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="tab"
        role="tab"
        :class="{ active: activeTab === tab.id }"
        :aria-selected="activeTab === tab.id"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <section v-if="activeTab === 'strategy'" class="panel">
      <div class="date-pager">
        <button type="button" class="strategy-btn" :disabled="!canPrev || loading" @click="goPrev">前一日</button>
        <span class="asof">{{ asofText }}</span>
        <span v-if="pageText" class="pager-idx">{{ pageText }}</span>
        <button type="button" class="strategy-btn" :disabled="!canNext || loading" @click="goNext">后一日</button>
        <button
          v-if="history.next"
          type="button"
          class="strategy-btn"
          :disabled="loading"
          @click="goLatest"
        >最新</button>
      </div>
      <div class="strategy-row">
        <button
          v-for="s in strategies"
          :key="s.id"
          type="button"
          class="strategy-btn"
          :class="{ active: selectedStrategyId === s.id }"
          @click="selectStrategy(s.id)"
        >
          {{ s.name }}
        </button>
      </div>
      <p v-if="loading" class="muted">正在用真实截面打分…</p>
      <p v-if="error" class="hint">{{ error }}</p>

      <div v-if="selectedStrategy" class="factor-block">
        <div class="block-label">
          {{ selectedStrategy.name }} · 截面 {{ asofText }}
          <span v-if="selectedStrategy.matched != null"> · 观察池 {{ selectedStrategy.matched }} 只</span>
          <span> · 综合得分 Top {{ resultRows.length || 20 }}</span>
        </div>
        <p class="principle">{{ selectedStrategy.principle }}</p>
        <div class="block-label">绑定因子</div>
        <div v-if="boundFactors.length" class="factor-row">
          <span v-for="f in boundFactors" :key="f.code" class="factor-chip" :title="f.code">
            {{ f.label }}
          </span>
        </div>
        <p v-else class="muted">尚未绑定因子</p>
      </div>

      <div class="table-card">
        <table class="result-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>代码</th>
              <th>名称</th>
              <th>涨跌幅</th>
              <th>收盘</th>
              <th>综合得分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in resultRows" :key="row.code">
              <td class="mono">{{ row.rank ?? '—' }}</td>
              <td class="mono">{{ row.code }}</td>
              <td>{{ row.name }}</td>
              <td :class="{ up: (row.changePct || 0) > 0, down: (row.changePct || 0) < 0 }">
                {{ formatPct(row.changePct) }}
              </td>
              <td class="mono">{{ formatPrice(row.price) }}</td>
              <td class="mono">{{ formatScore(row.score) }}</td>
            </tr>
            <tr v-if="!resultRows.length">
              <td colspan="6" class="empty">{{ loading ? '加载中…' : '暂无符合条件的标的' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else class="panel placeholder">
      <p>开发中</p>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 18px 16px 40px;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.tab {
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(232, 234, 237, 0.62);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.tab:hover {
  color: #e8eaed;
  background: rgba(255, 255, 255, 0.05);
}

.tab.active {
  color: #69f0ae;
  background: rgba(105, 240, 174, 0.1);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.date-pager {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.asof {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}
.pager-idx {
  font-size: 0.78rem;
  color: rgba(232, 234, 237, 0.55);
}
.strategy-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.strategy-btn {
  height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(232, 234, 237, 0.78);
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
}

.strategy-btn:hover {
  border-color: rgba(105, 240, 174, 0.35);
  color: #e8eaed;
}

.strategy-btn.active {
  border-color: rgba(105, 240, 174, 0.55);
  background: rgba(105, 240, 174, 0.12);
  color: #69f0ae;
}

.factor-block {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.block-label {
  margin-bottom: 8px;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgba(232, 234, 237, 0.55);
}
.principle {
  margin: 0 0 10px;
  color: rgba(232, 234, 237, 0.78);
  font-size: 0.88rem;
  line-height: 1.55;
}

.factor-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.factor-chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(105, 240, 174, 0.08);
  color: rgba(232, 234, 237, 0.88);
  font-size: 0.8rem;
  font-weight: 600;
}

.muted,
.hint,
.empty {
  margin: 0;
  color: rgba(232, 234, 237, 0.5);
  font-size: 0.85rem;
}

.hint {
  margin-top: 8px;
}

.table-card {
  overflow: auto;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.result-table th,
.result-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.result-table th {
  color: rgba(232, 234, 237, 0.55);
  font-weight: 600;
  font-size: 0.78rem;
  background: rgba(0, 0, 0, 0.18);
}

.result-table tbody tr:last-child td {
  border-bottom: 0;
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.up {
  color: #ef5350;
}

.down {
  color: #26a69a;
}

.placeholder {
  min-height: 240px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  color: rgba(232, 234, 237, 0.45);
  font-weight: 600;
}
</style>
