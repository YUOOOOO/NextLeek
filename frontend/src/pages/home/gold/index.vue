<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { createChart, LineSeries } from 'lightweight-charts'
import RightPanel from '../stock/components/RightPanel.vue'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

// ── 银行金价（顶栏）──────────────────────────────────────────
interface BankItem {
  name: string
  buy: number | null
  sell: number | null
  change_pct: number | null
}
const bankPrices = ref<BankItem[]>([])
const bankLoading = ref(true)

const BANK_TYPES: Record<string, string> = {
  zs: '招商', ms: '民生', icbc: '工行', cgb: '广发', cib: '兴业', gj: '国际金'
}

// ── 情绪/因子（左栏）──────────────────────────────────────────
interface Sentiment {
  goldPrice: number
  goldChange: number
  ma50: number | null
  maSignal: number | null
}
const sentiment = ref<Sentiment | null>(null)

interface MacroItem { name: string; value: string; desc: string }
const macroList = ref<MacroItem[]>([])
const macroLoading = ref(true)

interface QuoteItem { name: string; price: string; change: string; up: boolean }
const globalQuotes = ref<QuoteItem[]>([])

interface PredictItem { direction: string; confidence: number; reason: string }
const predict = ref<PredictItem | null>(null)

// ── 走势图（中栏）──────────────────────────────────────────────
const chartRef = ref<HTMLElement>()
const selectedType = ref('gj')
const chartLoading = ref(true)
const chartError = ref(false)

function fmtPct(v: number | null) {
  if (v == null) return '--'
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%'
}
function fmtPrice(v: number | null) {
  if (v == null) return '--'
  return v.toFixed(2)
}

// ── 银行金价 fetch ──────────────────────────────────────────────
async function fetchBankPrices() {
  try {
    const res = await fetch(`${API_BASE}/api/gold/gold`)
    const json = await res.json()
    if (json.code === 200 && Array.isArray(json.data)) {
      const types = Object.keys(BANK_TYPES)
      bankPrices.value = json.data.map((d: any, i: number) => ({
        name: BANK_TYPES[types[i]] || types[i],
        buy: d?.buy ?? null,
        sell: d?.sell ?? null,
        change_pct: d?.change_pct ?? null,
      }))
    }
  } catch {}
  bankLoading.value = false
}

// ── 情绪数据 ────────────────────────────────────────────────────
async function fetchSentiment() {
  try {
    const res = await fetch(`${API_BASE}/api/gold/sentiment`)
    const json = await res.json()
    if (json.code === 200) sentiment.value = json.data
  } catch {}
}

// ── 宏观指标 ────────────────────────────────────────────────────
async function fetchMacro() {
  macroLoading.value = true
  try {
    const res = await fetch(`${API_BASE}/api/gold/vdj/macro`)
    const json = await res.json()
    if (Array.isArray(json)) {
      macroList.value = json.slice(0, 6).map((item: any) => ({
        name: item.name || item.title || '--',
        value: item.value ?? '--',
        desc: item.desc || item.description || '',
      }))
    }
  } catch {
    macroLoading.value = false
  }
  macroLoading.value = false
}

// ── 全球报价 ────────────────────────────────────────────────────
async function fetchQuotes() {
  try {
    const res = await fetch(`${API_BASE}/api/gold/vdj/quotes`)
    const json = await res.json()
    if (Array.isArray(json)) {
      globalQuotes.value = json.slice(0, 6).map((q: any) => ({
        name: q.name || q.symbol || '--',
        price: q.price ?? '--',
        change: q.change_pct != null ? (q.change_pct > 0 ? '+' : '') + Number(q.change_pct).toFixed(2) + '%' : '--',
        up: (q.change_pct ?? 0) >= 0,
      }))
    }
  } catch {}
}

// ── 趋势预测 ────────────────────────────────────────────────────
async function fetchPredict() {
  try {
    const res = await fetch(`${API_BASE}/api/gold/vdj/predict`)
    const json = await res.json()
    if (json) {
      predict.value = {
        direction: json.direction || json.trend || '--',
        confidence: json.confidence ?? json.probability ?? 0,
        reason: json.reason || json.summary || '',
      }
    }
  } catch {}
}

// ── 走势图 ──────────────────────────────────────────────────────
let chart: any = null
let lineSeries: any = null

async function loadChart(type: string) {
  chartLoading.value = true
  chartError.value = false
  try {
    const res = await fetch(`${API_BASE}/api/gold/chart/${type}`)
    const json = await res.json()
    const rawData: any[] = (json.code === 200 ? json.data : json) || []

    // 转换为 lightweight-charts 格式：{ time: 'YYYY-MM-DD', value: number }
    const seriesData = rawData
      .filter((d: any) => d.t || d.time || d.date)
      .map((d: any) => ({
        time: (d.t || d.time || d.date) as string,
        value: Number(d.p ?? d.price ?? d.value ?? 0),
      }))
      .filter((d: any) => d.value > 0)
      .sort((a: any, b: any) => a.time.localeCompare(b.time))

    if (lineSeries && seriesData.length > 0) {
      lineSeries.setData(seriesData)
      chart?.timeScale().fitContent()
    }
  } catch {
    chartError.value = true
  }
  chartLoading.value = false
}

function initChart() {
  if (!chartRef.value || chart) return
  chart = createChart(chartRef.value, {
    width: chartRef.value.clientWidth,
    height: chartRef.value.clientHeight || 320,
    layout: { background: { color: '#1a2536' }, textColor: '#aaa' },
    grid: { vertLines: { color: '#2a3a4e' }, horzLines: { color: '#2a3a4e' } },
    crosshair: { mode: 1 },
    rightPriceScale: { borderColor: '#2a3a4e' },
    timeScale: { borderColor: '#2a3a4e', timeVisible: true },
  })
  lineSeries = chart.addSeries(LineSeries, {
    color: '#faad14',
    lineWidth: 2,
    priceLineVisible: true,
    lastValueVisible: true,
  })
  new ResizeObserver(() => {
    if (chartRef.value) chart?.applyOptions({ width: chartRef.value.clientWidth })
  }).observe(chartRef.value)
}

async function switchChart(type: string) {
  selectedType.value = type
  await loadChart(type)
}

// maSignal 颜色
const maColor = computed(() => {
  const v = sentiment.value?.maSignal
  if (v == null) return '#999'
  if (v > 2) return '#ef5350'
  if (v < -2) return '#26a69a'
  return '#faad14'
})

const maLabel = computed(() => {
  const v = sentiment.value?.maSignal
  if (v == null) return '--'
  if (v > 5) return '强势偏高'
  if (v > 2) return '偏高'
  if (v < -5) return '深度超卖'
  if (v < -2) return '偏低'
  return '均值附近'
})

const chartTypes = [
  { id: 'gj', label: '国际金' },
  { id: 'zs', label: '招商' },
  { id: 'icbc', label: '工行' },
  { id: 'cgb', label: '广发' },
]

let refreshTimer: number
onMounted(async () => {
  await Promise.all([fetchBankPrices(), fetchSentiment(), fetchMacro(), fetchQuotes(), fetchPredict()])
  initChart()
  await loadChart(selectedType.value)
  refreshTimer = window.setInterval(() => { fetchBankPrices(); fetchSentiment() }, 60000)
})
onUnmounted(() => {
  clearInterval(refreshTimer)
  chart?.remove()
  chart = null
})
</script>

<template>
  <div class="home">
    <!-- ── 顶栏 ────────────────────────────────────────────── -->
    <header class="top-bar">
      <div class="left">
        <span class="logo">🪙</span>
        <span class="title">NextLeek</span>
        <span class="asset-tag">黄金</span>
      </div>

      <!-- 各银行实时金价 -->
      <div class="bank-prices">
        <template v-if="bankLoading">
          <span class="bank-loading">加载中...</span>
        </template>
        <template v-else>
          <div class="bank-item" v-for="b in bankPrices" :key="b.name">
            <span class="bank-name">{{ b.name }}</span>
            <span class="bank-buy">{{ fmtPrice(b.buy) }}</span>
            <span :class="['bank-chg', b.change_pct != null && b.change_pct >= 0 ? 'up' : 'down']">
              {{ fmtPct(b.change_pct) }}
            </span>
          </div>
        </template>
      </div>

      <div class="right">
        <button class="settings-btn">⚙</button>
      </div>
    </header>

    <!-- ── 主体三列 ─────────────────────────────────────────── -->
    <main class="main-layout">

      <!-- 左栏：因子卡片 -->
      <aside class="panel-left">
        <!-- 情绪/均线信号 -->
        <div class="section-title">均线信号</div>
        <div class="factor-card signal-card">
          <div class="signal-label" :style="{ color: maColor }">{{ maLabel }}</div>
          <div class="signal-val" :style="{ color: maColor }">
            {{ sentiment?.maSignal != null ? (sentiment.maSignal > 0 ? '+' : '') + sentiment.maSignal.toFixed(2) + '%' : '--' }}
          </div>
          <div class="signal-meta">相对50日均线</div>
          <div class="signal-sub" v-if="sentiment">
            <span>当前 {{ fmtPrice(sentiment.goldPrice) }}</span>
            <span>均线 {{ fmtPrice(sentiment.ma50) }}</span>
          </div>
        </div>

        <!-- 趋势预测 -->
        <div class="section-title">趋势预测</div>
        <div class="factor-card predict-card" v-if="predict">
          <div class="predict-dir" :class="predict.direction.includes('看多') || predict.direction.includes('上') ? 'up' : predict.direction.includes('看空') || predict.direction.includes('下') ? 'down' : ''">
            {{ predict.direction }}
          </div>
          <div class="predict-conf">
            置信度
            <div class="conf-bar">
              <div class="conf-fill" :style="{ width: (predict.confidence * 100).toFixed(0) + '%' }"></div>
            </div>
            {{ (predict.confidence * 100).toFixed(0) }}%
          </div>
          <div class="predict-reason" v-if="predict.reason">{{ predict.reason }}</div>
        </div>
        <div class="factor-card" v-else><span class="empty">暂无预测数据</span></div>

        <!-- 全球报价 -->
        <div class="section-title">全球参考</div>
        <div class="factor-card quotes-card">
          <template v-if="globalQuotes.length">
            <div class="quote-row" v-for="q in globalQuotes" :key="q.name">
              <span class="quote-name">{{ q.name }}</span>
              <span class="quote-price">{{ q.price }}</span>
              <span :class="['quote-chg', q.up ? 'up' : 'down']">{{ q.change }}</span>
            </div>
          </template>
          <span class="empty" v-else>暂无报价数据</span>
        </div>

        <!-- 宏观指标 -->
        <div class="section-title">宏观指标</div>
        <div class="factor-card macro-card">
          <template v-if="!macroLoading && macroList.length">
            <div class="macro-row" v-for="m in macroList" :key="m.name">
              <div class="macro-name">{{ m.name }}</div>
              <div class="macro-val">{{ m.value }}</div>
            </div>
          </template>
          <span class="empty" v-else-if="macroLoading">加载中...</span>
          <span class="empty" v-else>暂无宏观数据</span>
        </div>
      </aside>

      <!-- 中栏：走势图 -->
      <section class="panel-center">
        <div class="chart-tabs">
          <button
            v-for="ct in chartTypes" :key="ct.id"
            :class="['tab-btn', { active: selectedType === ct.id }]"
            @click="switchChart(ct.id)"
          >{{ ct.label }}</button>
        </div>
        <div class="chart-wrap">
          <div v-if="chartLoading" class="chart-overlay">加载走势图...</div>
          <div v-if="chartError && !chartLoading" class="chart-overlay error">走势数据暂不可用</div>
          <div ref="chartRef" class="chart-container"></div>
        </div>
      </section>

      <!-- 右栏：AI 助手 -->
      <RightPanel />

    </main>
  </div>
</template>

<style scoped>
/* ── 整体 ── */
.home { width: 100%; min-height: 100vh; display: flex; flex-direction: column; }

/* ── 顶栏 ── */
.top-bar {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0 1rem; height: 45px; flex-shrink: 0;
  background: #1a2536; border-bottom: 1px solid #2a3a4e;
}
.left { display: flex; align-items: center; gap: 0.5em; flex-shrink: 0; }
.logo { font-size: 1.4em; }
.title { font-size: 1em; font-weight: 600; }
.asset-tag {
  font-size: 0.72em; padding: 0.15em 0.6em;
  background: rgba(250, 173, 20, 0.2); color: #faad14;
  border: 1px solid rgba(250, 173, 20, 0.4); border-radius: 4px;
}

/* 银行金价区 */
.bank-prices {
  flex: 1; display: flex; align-items: center; gap: 0.5rem;
  overflow: hidden; margin: 0 0.5rem;
}
.bank-loading { font-size: 0.75em; color: rgba(255,255,255,0.35); }
.bank-item {
  display: flex; flex-direction: column; align-items: center;
  padding: 0.2em 0.7em; background: rgba(255,255,255,0.04);
  border: 1px solid #2a3a4e; border-radius: 6px; flex-shrink: 0;
  gap: 0.05em;
}
.bank-name { font-size: 0.65em; color: rgba(255,255,255,0.45); }
.bank-buy { font-size: 0.82em; font-weight: 600; color: #e0e0e0; }
.bank-chg { font-size: 0.65em; }
.up { color: #ef5350; }
.down { color: #26a69a; }

.right { flex-shrink: 0; }
.settings-btn {
  background: none; border: none; color: rgba(255,255,255,0.6);
  font-size: 1.1em; cursor: pointer; padding: 0.2em;
}
.settings-btn:hover { color: #fff; }

/* ── 主体布局 ── */
.main-layout {
  display: flex; flex: 1; gap: 0.75rem; padding: 0.75rem;
  height: calc(100vh - 45px); min-height: 0;
}

/* ── 左栏 ── */
.panel-left {
  width: 220px; flex-shrink: 0; display: flex; flex-direction: column;
  gap: 0.4rem; overflow-y: auto;
}
.section-title {
  font-size: 0.72em; font-weight: 600; color: rgba(255,255,255,0.4);
  letter-spacing: 0.04em; padding: 0 0.2rem; margin-top: 0.25rem;
}
.section-title:first-child { margin-top: 0; }

.factor-card {
  background: #1a2536; border: 1px solid #2a3a4e; border-radius: 8px;
  padding: 0.65rem 0.8rem;
}

/* 均线信号 */
.signal-card { text-align: center; }
.signal-label { font-size: 0.8em; font-weight: 600; }
.signal-val { font-size: 1.5em; font-weight: 700; line-height: 1.3; }
.signal-meta { font-size: 0.65em; color: rgba(255,255,255,0.35); margin-top: 0.1em; }
.signal-sub { display: flex; justify-content: space-around; font-size: 0.68em; color: rgba(255,255,255,0.45); margin-top: 0.4rem; }

/* 趋势预测 */
.predict-dir { font-size: 0.95em; font-weight: 700; margin-bottom: 0.4rem; }
.predict-conf { font-size: 0.72em; color: rgba(255,255,255,0.5); display: flex; align-items: center; gap: 0.4em; }
.conf-bar { flex: 1; height: 4px; background: #2a3a4e; border-radius: 2px; overflow: hidden; }
.conf-fill { height: 100%; background: #faad14; border-radius: 2px; transition: width 0.5s; }
.predict-reason { font-size: 0.68em; color: rgba(255,255,255,0.4); margin-top: 0.4rem; line-height: 1.4; }

/* 全球报价 */
.quote-row {
  display: flex; align-items: center; gap: 0.3em;
  font-size: 0.75em; padding: 0.25em 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.quote-row:last-child { border-bottom: none; }
.quote-name { flex: 1; color: rgba(255,255,255,0.6); }
.quote-price { font-weight: 600; color: #e0e0e0; }
.quote-chg { width: 3.5em; text-align: right; }

/* 宏观指标 */
.macro-row {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 0.73em; padding: 0.3em 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.macro-row:last-child { border-bottom: none; }
.macro-name { color: rgba(255,255,255,0.5); }
.macro-val { color: #e0e0e0; font-weight: 600; }

.empty { font-size: 0.75em; color: rgba(255,255,255,0.25); }

/* ── 中栏 ── */
.panel-center {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem;
}
.chart-tabs { display: flex; gap: 0.4rem; }
.tab-btn {
  padding: 0.3em 0.9em; font-size: 0.78em;
  background: rgba(255,255,255,0.05); border: 1px solid #2a3a4e;
  border-radius: 6px; color: rgba(255,255,255,0.55); cursor: pointer;
  transition: all 0.2s;
}
.tab-btn:hover { border-color: #faad14; color: #faad14; }
.tab-btn.active { background: rgba(250,173,20,0.15); border-color: #faad14; color: #faad14; }

.chart-wrap {
  flex: 1; position: relative;
  border: 1px solid #2a3a4e; border-radius: 8px; overflow: hidden;
  min-height: 0;
}
.chart-container { width: 100%; height: 100%; }
.chart-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 0.85em; color: rgba(255,255,255,0.3); background: rgba(26,37,54,0.85);
  z-index: 10; pointer-events: none;
}
.chart-overlay.error { color: #ef5350; }

/* ── 响应式 ── */
@media (max-width: 900px) {
  .bank-prices { display: none; }
  .main-layout { flex-direction: column; height: auto; }
  .panel-left { width: 100%; }
}
</style>
