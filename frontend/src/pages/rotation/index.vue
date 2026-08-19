<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const API = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

type Universe = {
  mode?: string
  tradeable?: string[]
  symbols?: string[]
  backtest?: Record<string, unknown>
}

type Job = {
  job_id: string
  type: string
  status: string
  pct?: number
  message?: string
  stage?: string
  error?: string | null
}

type SignalActionKind = 'buy' | 'sell' | 'hold' | 'current'

type SignalAction = {
  symbol: string
  action: SignalActionKind
  label: string
  reason: string
  hold_days?: number
}

type SignalStrategy = {
  strategy_id: string
  name?: string
  asof?: string
  summary?: string
  actions?: SignalAction[]
  holdings?: string[]
  hold_days?: Record<string, number>
  last_rebalance?: string
}

type SignalPayload = {
  strategies?: SignalStrategy[]
  note?: string
  asof?: string
  universe_mode?: string
}

const universe = ref<Universe | null>(null)
const sealed = ref<unknown>(null)
const jobs = ref<Job[]>([])
const signal = ref<SignalPayload | null>(null)
const result = ref<unknown>(null)
const error = ref('')
const busy = ref(false)
const lastJobId = ref('')

let timer: number | undefined

// 兼容旧版状态，将当前持仓转换为可读动作
function displayActions(strategy: SignalStrategy): SignalAction[] {
  if (strategy.actions) return strategy.actions
  return (strategy.holdings || []).map((symbol) => ({
    symbol,
    action: 'current',
    label: '当前持仓',
    reason: '历史信号，无上期动作记录',
    hold_days: strategy.hold_days?.[symbol],
  }))
}

// 请求统一通过 Express BFF，避免浏览器直连数值引擎
async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    let msg = res.statusText
    if (data && typeof data === 'object' && 'error' in data) {
      msg = String(data.error)
    }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return data as T
}

// 刷新策略、任务与最新信号元数据
async function refreshMeta(preserveError = false) {
  if (!preserveError) error.value = ''
  try {
    universe.value = await api('/api/strategy/universe')
    sealed.value = await api('/api/strategy/sealed')
    signal.value = await api('/api/strategy/signal/latest')
    const jl = await api<{ items: Job[] }>('/api/strategy/jobs?limit=20')
    jobs.value = jl.items || []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

// 创建异步研究任务并等待结果
async function startJob(type: string, params: Record<string, unknown> = {}) {
  busy.value = true
  error.value = ''
  result.value = null
  try {
    const r = await api<{ job_id: string }>('/api/strategy/jobs', {
      method: 'POST',
      body: JSON.stringify({ type, params }),
    })
    lastJobId.value = r.job_id
    await pollJob(r.job_id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    await refreshMeta(true)
  }
}

// 轮询指定任务直至成功、失败或超时
async function pollJob(id: string) {
  for (let i = 0; i < 600; i++) {
    const st = await api<Job>(`/api/strategy/jobs/${id}`)
    const idx = jobs.value.findIndex((j) => j.job_id === id)
    if (idx >= 0) jobs.value[idx] = st
    else jobs.value = [st, ...jobs.value]
    if (st.status === 'succeeded') {
      result.value = await api(`/api/strategy/jobs/${id}/result`)
      return
    }
    if (st.status === 'failed') {
      error.value = st.error || st.message || 'job failed'
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  error.value = 'poll timeout'
}

onMounted(() => {
  refreshMeta()
  timer = window.setInterval(() => refreshMeta(true), 15000)
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1>ETF 轮动研究</h1>
        <p class="sub">
          Express → strategy-api · universe
          {{ universe?.mode || '—' }} · tradeable
          {{ universe?.tradeable?.length ?? '—' }}
        </p>
      </div>
      <button class="btn ghost" :disabled="busy" @click="refreshMeta()">刷新</button>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <section class="card actions">
      <h2>任务</h2>
      <div class="row">
        <button class="btn" :disabled="busy" @click="startJob('update-data')">更新数据</button>
        <button class="btn" :disabled="busy" @click="startJob('vec')">VEC 回测</button>
        <button class="btn" :disabled="busy" @click="startJob('bt')">BT 回测</button>
        <button class="btn" :disabled="busy" @click="startJob('wfo')">WFO 筛选</button>
        <button class="btn primary" :disabled="busy" @click="startJob('pipeline')">全流水线</button>
        <button class="btn" :disabled="busy" @click="startJob('signal')">今日信号</button>
      </div>
      <p class="hint">最近 job：{{ lastJobId || '—' }} {{ busy ? '（运行中…）' : '' }}</p>
    </section>

    <section class="card signal-panel">
      <div class="section-head">
        <div>
          <h2>策略操作</h2>
          <p class="hint signal-meta">
            信号日期：{{ signal?.asof || '—' }} · 仅表示模型目标持仓变化
          </p>
        </div>
        <span class="research-tag">研究信号，非实盘下单</span>
      </div>

      <div v-if="signal?.strategies?.length" class="signal-grid">
        <article
          v-for="strategy in signal.strategies"
          :key="strategy.strategy_id"
          class="strategy-signal"
        >
          <div class="strategy-head">
            <div>
              <strong>{{ strategy.name || strategy.strategy_id }}</strong>
              <code>{{ strategy.strategy_id }}</code>
            </div>
            <span>{{ strategy.asof || signal.asof || '—' }}</span>
          </div>
          <p class="signal-summary">{{ strategy.summary || '暂无动作说明' }}</p>
          <div v-if="displayActions(strategy).length" class="signal-actions">
            <div
              v-for="item in displayActions(strategy)"
              :key="`${item.action}-${item.symbol}`"
              class="signal-action"
            >
              <span :class="['action-badge', item.action]">{{ item.label }}</span>
              <strong class="symbol">{{ item.symbol }}</strong>
              <span class="reason">{{ item.reason }}</span>
              <span v-if="item.hold_days" class="days">已持有 {{ item.hold_days }} 天</span>
            </div>
          </div>
          <p v-else class="empty">无操作</p>
        </article>
      </div>
      <p v-else class="empty">暂无信号，请点击“今日信号”生成。</p>

      <details class="raw-details">
        <summary>查看原始信号数据</summary>
        <pre class="pre">{{ JSON.stringify(signal, null, 2) }}</pre>
      </details>
    </section>

    <section class="card">
      <h2>最近任务</h2>
      <ul class="jobs">
        <li v-for="j in jobs" :key="j.job_id">
          <code>{{ j.job_id }}</code>
          <span>{{ j.type }}</span>
          <span :class="['st', j.status]">{{ j.status }}</span>
          <span>{{ Math.round(j.pct || 0) }}% {{ j.message || j.stage || '' }}</span>
        </li>
      </ul>
    </section>

    <details class="card raw-card">
      <summary>查看最近任务原始结果</summary>
      <pre class="pre">{{ result ? JSON.stringify(result, null, 2) : '—' }}</pre>
    </details>

    <details class="card raw-card">
      <summary>查看封版策略原始数据</summary>
      <pre class="pre">{{ JSON.stringify(sealed, null, 2) }}</pre>
    </details>
  </div>
</template>

<style scoped>
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 48px;
  color: #e8eaed;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 1.4rem;
}
h2 {
  margin: 0 0 10px;
  font-size: 1rem;
}
.sub {
  margin: 6px 0 0;
  color: rgba(232, 234, 237, 0.55);
  font-size: 0.85rem;
}
.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.section-head,
.strategy-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.signal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.strategy-signal {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 14px;
  background: rgba(0, 0, 0, 0.12);
}
.strategy-head strong,
.strategy-head code {
  display: block;
}
.strategy-head code,
.strategy-head > span {
  margin-top: 4px;
  color: rgba(232, 234, 237, 0.5);
  font-size: 0.75rem;
}
.signal-summary {
  margin: 12px 0;
  font-weight: 600;
}
.signal-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.signal-action {
  display: grid;
  grid-template-columns: 68px 76px 1fr auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}
.action-badge {
  display: inline-flex;
  justify-content: center;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 0.78rem;
  font-weight: 700;
}
.action-badge.buy {
  color: #69f0ae;
  background: rgba(105, 240, 174, 0.12);
}
.action-badge.sell {
  color: #ff8a80;
  background: rgba(255, 138, 128, 0.12);
}
.action-badge.hold {
  color: #b0bec5;
  background: rgba(176, 190, 197, 0.12);
}
.action-badge.current {
  color: #82b1ff;
  background: rgba(130, 177, 255, 0.12);
}
.reason,
.days {
  color: rgba(232, 234, 237, 0.65);
  font-size: 0.8rem;
}
.days {
  white-space: nowrap;
}
.research-tag {
  border: 1px solid rgba(255, 193, 7, 0.35);
  border-radius: 999px;
  padding: 4px 8px;
  color: #ffd54f;
  font-size: 0.75rem;
}
.signal-meta {
  margin-top: 4px;
}
.empty {
  margin: 12px 0 0;
  color: rgba(232, 234, 237, 0.5);
}
.raw-details {
  margin-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 10px;
}
.raw-details summary,
.raw-card summary {
  cursor: pointer;
  color: rgba(232, 234, 237, 0.65);
  font-size: 0.85rem;
}
.raw-details[open] .pre,
.raw-card[open] .pre {
  margin-top: 10px;
}
@media (max-width: 800px) {
  .signal-grid {
    grid-template-columns: 1fr;
  }
  .signal-action {
    grid-template-columns: 68px 1fr;
  }
  .reason,
  .days {
    grid-column: 2;
  }
  .section-head {
    flex-direction: column;
  }
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn {
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.primary {
  background: #2f6fed;
  border-color: #2f6fed;
}
.btn.ghost {
  background: transparent;
}
.hint {
  margin: 10px 0 0;
  font-size: 0.8rem;
  color: rgba(232, 234, 237, 0.5);
}
.err {
  color: #ff8a80;
  background: rgba(255, 82, 82, 0.12);
  border-radius: 8px;
  padding: 8px 12px;
}
.pre {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.jobs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.85rem;
}
.jobs li {
  display: grid;
  grid-template-columns: 90px 90px 90px 1fr;
  gap: 8px;
}
.st.succeeded {
  color: #69f0ae;
}
.st.failed {
  color: #ff8a80;
}
.st.running,
.st.queued {
  color: #82b1ff;
}
</style>
