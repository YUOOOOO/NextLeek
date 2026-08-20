<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const API = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

type Universe = {
  mode?: string
  tradeable?: string[]
  symbols?: string[]
  active_factors?: string[]
  backtest?: {
    freq?: number
    pos_size?: number
    hysteresis?: { delta_rank?: number; min_hold_days?: number }
  }
}

type Job = {
  job_id: string
  type: string
  status: string
  pct?: number
  message?: string
  stage?: string
  error?: string | null
  created_at?: string
  updated_at?: string
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
  asof?: string | null
  summary?: string
  actions?: SignalAction[]
  holdings?: string[]
  hold_days?: Record<string, number>
  last_rebalance?: string | null
  factors?: string[]
  combo?: string
  source?: string
  generated_at?: string | null
}

type SignalPayload = {
  strategies?: SignalStrategy[]
  note?: string | null
  asof?: string | null
  version?: string
}

type SealedItem = {
  id?: string
  name?: string
  factors?: string[]
  combo?: string
  factor_signs?: string
}

type SealedPayload = {
  sealed?: SealedItem[]
  runtime_default?: string
}

type PipelineStepId = 'update-data' | 'wfo' | 'vec' | 'bt' | 'signal'

type PipelineStep = {
  id: PipelineStepId
  order: number
  title: string
  eng: string
  time: string
  desc: string
  detail: string
}

// 常见 ETF 中文名；未知代码仍显示代码
const ETF_NAMES: Record<string, string> = {
  '159801': '芯片',
  '159819': '人工智能',
  '159859': '生物医药',
  '159883': '医疗器械',
  '159915': '创业板',
  '159920': '恒生ETF',
  '159928': '消费',
  '159949': '创业板50',
  '159985': '豆粕',
  '159992': '创新药',
  '159995': '芯片',
  '159998': '机械',
  '510050': '上证50',
  '510300': '沪深300',
  '510500': '中证500',
  '511010': '国债ETF',
  '511260': '十年国债',
  '511380': '可转债',
  '512010': '医药',
  '512100': '中证1000',
  '512200': '房地产',
  '512400': '有色金属',
  '512480': '半导体',
  '512660': '军工',
  '512690': '酒ETF',
  '512720': '计算机',
  '512800': '银行',
  '512880': '证券',
  '512980': '传媒',
  '513050': '中概互联',
  '513100': '纳指ETF',
  '513130': '恒生科技',
  '513180': '恒生科技',
  '513400': '道琼斯',
  '513500': '标普500',
  '513520': '日经225',
  '515030': '新能源车',
  '515180': '红利',
  '515210': '钢铁',
  '515220': '煤炭',
  '515650': '消费50',
  '515790': '光伏',
  '516090': '新能源',
  '516160': '新能源车',
  '516520': '智能驾驶',
  '518850': '黄金基金',
  '518880': '黄金ETF',
  '588000': '科创50',
  '588200': '科创芯片',
}

const STRATEGY_META: Record<string, { title: string; role: string; blurb: string }> = {
  v8_composite_1: {
    title: '主策略 · 五因子',
    role: '生产策略',
    blurb: '因子配方已锁定。换仓看下面持仓，不代表因子每天重筛。',
  },
}

/** 不在界面展示的备胎策略 id */
const HIDDEN_STRATEGY_IDS = new Set(['v8_core_4f', 'core_4f'])

const JOB_TYPE_LABEL: Record<string, string> = {
  'update-data': '更新行情数据',
  signal: '生成今日信号',
  wfo: 'WFO 筛选',
  vec: 'VEC 快速回测',
  bt: 'BT 真实回测',
  pipeline: '完整研究流水线',
  precompute: '预计算辅助因子',
}

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
}

const FACTOR_LABEL: Record<string, string> = {
  ADX_14D: '趋势强度 ADX',
  AMIHUD_ILLIQUIDITY: '非流动性',
  BREAKOUT_20D: '突破',
  CALMAR_RATIO_60D: 'Calmar 比率',
  CORRELATION_TO_MARKET_20D: '与市场相关性',
  GK_VOL_RATIO_20D: 'GK 波动比',
  MAX_DD_60D: '最大回撤',
  MOM_20D: '动量 20 日',
  OBV_SLOPE_10D: 'OBV 斜率',
  PRICE_POSITION_20D: '价格位置 20 日',
  PRICE_POSITION_120D: '价格位置 120 日',
  PV_CORR_20D: '价量相关',
  SHARPE_RATIO_20D: '夏普 20 日',
  SLOPE_20D: '价格斜率',
  UP_DOWN_VOL_RATIO_20D: '涨跌波动比',
  VOL_RATIO_20D: '波动率比',
  VORTEX_14D: '涡旋指标',
  SHARE_CHG_5D: '份额变化 5 日',
  SHARE_CHG_10D: '份额变化 10 日',
  SHARE_CHG_20D: '份额变化 20 日',
  SHARE_ACCEL: '份额加速度',
  MARGIN_CHG_10D: '融资变化 10 日',
  MARGIN_BUY_RATIO: '融资买入比',
}

const OHLCV_FACTORS = new Set([
  'ADX_14D',
  'AMIHUD_ILLIQUIDITY',
  'BREAKOUT_20D',
  'CALMAR_RATIO_60D',
  'CORRELATION_TO_MARKET_20D',
  'GK_VOL_RATIO_20D',
  'MAX_DD_60D',
  'MOM_20D',
  'OBV_SLOPE_10D',
  'PRICE_POSITION_20D',
  'PRICE_POSITION_120D',
  'PV_CORR_20D',
  'SHARPE_RATIO_20D',
  'SLOPE_20D',
  'UP_DOWN_VOL_RATIO_20D',
  'VOL_RATIO_20D',
  'VORTEX_14D',
])

/** 日常优先；研究层（WFO/VEC/BT）沉底，避免误点一键全流程 */
const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 'update-data',
    order: 0,
    title: '更新数据',
    eng: 'Data',
    time: '视网络',
    desc: '拉行情 / 份额 / 融资写本地',
    detail: '日常和研究都先要有这份数据。',
  },
  {
    id: 'wfo',
    order: 1,
    title: 'WFO 筛选',
    eng: 'WFO',
    time: '~2 分钟+',
    desc: '枚举因子组合，IC 门控后打分',
    detail: '研究用：重筛因子配方，不是每日操作。',
  },
  {
    id: 'vec',
    order: 2,
    title: 'VEC 快速回测',
    eng: 'VEC',
    time: '~5 分钟+',
    desc: '对候选做向量化精确回测',
    detail: '研究用：快速卡精度。',
  },
  {
    id: 'bt',
    order: 3,
    title: 'BT 真实回测',
    eng: 'BT',
    time: '30–60 分钟',
    desc: '整手 + 资金约束，当 ground truth',
    detail: '研究用：通过后才考虑换新封版配方。',
  },
  {
    id: 'signal',
    order: 4,
    title: '今日信号',
    eng: 'Signal',
    time: '很快',
    desc: '用已封版因子给池子打分，决定持哪几只',
    detail: '日常出口。因子不变，持仓仍可能按规则换。',
  },
]

/** 页面下方研究区：不含日常信号步 */
const RESEARCH_STEP_IDS = new Set<PipelineStepId>(['update-data', 'wfo', 'vec', 'bt'])

const universe = ref<Universe | null>(null)
const sealed = ref<SealedPayload | null>(null)
const jobs = ref<Job[]>([])
const signal = ref<SignalPayload | null>(null)
const result = ref<unknown>(null)
const error = ref('')
const busy = ref(false)
const lastJobId = ref('')
const showResearch = ref(false)

let timer: number | undefined

const tradeableCount = computed(() => universe.value?.tradeable?.length ?? 0)
const symbolCount = computed(() => universe.value?.symbols?.length ?? 0)
const factorCount = computed(() => universe.value?.active_factors?.length ?? 0)
const signalDate = computed(() => formatDate(signal.value?.asof || undefined))
const posSize = computed(() => universe.value?.backtest?.pos_size ?? 2)
const rebalanceDays = computed(() => universe.value?.backtest?.freq ?? 5)
const deltaRank = computed(() => universe.value?.backtest?.hysteresis?.delta_rank ?? 0.1)
const minHoldDays = computed(() => universe.value?.backtest?.hysteresis?.min_hold_days ?? 9)

const strategies = computed(() => {
  const fromSignal = signal.value?.strategies || []
  const raw = fromSignal.length
    ? fromSignal
    : ((sealed.value?.sealed || []).map((item) => ({
        strategy_id: String(item.id || item.name || 'unknown'),
        name: item.name,
        factors: item.factors,
        combo: item.combo,
        summary: '尚未生成信号',
        actions: [],
        holdings: [],
        source: 'sealed_definition',
      })) as SignalStrategy[])
  return raw.filter((s) => !HIDDEN_STRATEGY_IDS.has(s.strategy_id) && !/core_4f/i.test(s.strategy_id))
})

const factorPool = computed(() => {
  const codes = universe.value?.active_factors || []
  return codes.map((code) => ({
    code,
    label: factorText(code),
    group: OHLCV_FACTORS.has(code) ? '行情类' : '份额/融资类',
  }))
})

const ohlcvFactors = computed(() => factorPool.value.filter((f) => f.group === '行情类'))
const altFactors = computed(() => factorPool.value.filter((f) => f.group === '份额/融资类'))

const latestJob = computed(() => jobs.value[0] || null)


const pipelineJob = computed(() =>
  jobs.value.find((j) => j.type === 'pipeline' && (j.status === 'running' || j.status === 'queued'))
  || jobs.value.find((j) => j.type === 'pipeline')
  || null,
)

const stepJobs = computed(() => {
  const map = {} as Record<PipelineStepId, Job | null>
  for (const step of PIPELINE_STEPS) {
    map[step.id] =
      jobs.value.find((j) => j.type === step.id && (j.status === 'running' || j.status === 'queued'))
      || jobs.value.find((j) => j.type === step.id)
      || null
  }
  return map
})

/** 流水线步骤状态：优先看整条 pipeline job，再看单步最近任务 */
const stepStates = computed(() => {
  const pipe = pipelineJob.value
  const pipeActive = pipe && (pipe.status === 'running' || pipe.status === 'queued')
  const stage = (pipe?.stage || pipe?.message || '').toLowerCase()

  return PIPELINE_STEPS.map((step) => {
    const own = stepJobs.value[step.id]
    let status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' = 'idle'
    let pct = 0
    let note = '尚未运行'
    let jobId = ''

    if (pipeActive) {
      // pipeline 进行中：根据 stage 文案粗分当前层
      const hit =
        stage.includes(step.id)
        || stage.includes(step.eng.toLowerCase())
        || (step.id === 'update-data' && (stage.includes('update') || stage.includes('data')))
        || (step.id === 'signal' && stage.includes('signal'))
      if (hit) {
        status = pipe!.status === 'queued' ? 'queued' : 'running'
        pct = pipe!.pct || 0
        note = pipe!.message || pipe!.stage || '流水线进行中'
        jobId = pipe!.job_id
      } else if (own?.status === 'succeeded') {
        status = 'succeeded'
        pct = 100
        note = '本层最近一次已完成'
        jobId = own.job_id
      } else {
        status = 'queued'
        note = '等待流水线到达本层'
        jobId = pipe!.job_id
      }
    } else if (own) {
      if (own.status === 'succeeded') status = 'succeeded'
      else if (own.status === 'failed') status = 'failed'
      else if (own.status === 'running') status = 'running'
      else if (own.status === 'queued') status = 'queued'
      pct = own.pct || (status === 'succeeded' ? 100 : 0)
      note = jobMessage(own)
      jobId = own.job_id
    } else if (step.id === 'signal' && signal.value?.strategies?.some((s) => (s.actions?.length || s.holdings?.length))) {
      status = 'succeeded'
      pct = 100
      note = '已有可用信号缓存'
    } else if ((step.id === 'bt' || step.id === 'wfo' || step.id === 'vec') && (sealed.value?.sealed?.length || 0) > 0) {
      // 封版已存在：研究层历史上通过，但不等于本次 session 刚跑过
      status = 'skipped'
      pct = 100
      note = '已有封版结果（历史研究产物）'
    }

    return { ...step, status, pct, note, jobId }
  })
})

const researchSteps = computed(() =>
  stepStates.value.filter((s) => RESEARCH_STEP_IDS.has(s.id)),
)

const researchProgress = computed(() => {
  const core = stepStates.value.filter((s) => s.id === 'wfo' || s.id === 'vec' || s.id === 'bt')
  const done = core.filter((s) => s.status === 'succeeded' || s.status === 'skipped').length
  return { done, total: core.length }
})

function etfLabel(code: string): string {
  const name = ETF_NAMES[code]
  return name ? `${code} ${name}` : code
}

function strategyTitle(s: SignalStrategy): string {
  return STRATEGY_META[s.strategy_id]?.title || s.name || s.strategy_id
}

function strategyRole(s: SignalStrategy): string {
  return STRATEGY_META[s.strategy_id]?.role || '策略'
}

function strategyBlurb(s: SignalStrategy): string {
  return STRATEGY_META[s.strategy_id]?.blurb || ''
}

function factorText(code: string): string {
  return FACTOR_LABEL[code] || code
}

function formatDate(raw?: string | null): string {
  if (!raw) return '—'
  const s = String(raw).replace(/-/g, '')
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return String(raw).slice(0, 10)
}

function sourceText(source?: string): string {
  if (!source) return ''
  if (source.includes('shadow')) return '正式信号'
  if (source.includes('legacy')) return '本地缓存'
  if (source.includes('sealed')) return '仅定义，未跑信号'
  return source
}

function displayActions(strategy: SignalStrategy): SignalAction[] {
  if (strategy.actions && strategy.actions.length) return strategy.actions
  return (strategy.holdings || []).map((symbol) => ({
    symbol,
    action: 'current' as const,
    label: '当前持仓',
    reason: '历史信号，无本期买卖明细',
    hold_days: strategy.hold_days?.[symbol],
  }))
}

function jobTypeLabel(type?: string): string {
  if (!type) return '—'
  return JOB_TYPE_LABEL[type] || type
}

function jobStatusLabel(status?: string): string {
  if (!status) return '—'
  return JOB_STATUS_LABEL[status] || status
}

function jobMessage(j: Job): string {
  const raw = (j.error || j.message || j.stage || '').trim()
  if (!raw) return '—'
  if (JOB_STATUS_LABEL[raw]) return JOB_STATUS_LABEL[raw]
  if (raw === 'canonical runtime complete') return '原版精度任务完成'
  if (raw === 'done' || raw === 'ok') return '完成'
  return raw
}

function stepStatusLabel(status: string): string {
  if (status === 'idle') return '未跑'
  if (status === 'skipped') return '已有封版'
  return jobStatusLabel(status)
}

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
      msg = String((data as { error: unknown }).error)
    }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return data as T
}

async function refreshMeta(preserveError = false) {
  if (!preserveError) error.value = ''
  try {
    const [u, s, sig, jl] = await Promise.all([
      api<Universe>('/api/strategy/universe'),
      api<SealedPayload>('/api/strategy/sealed'),
      api<SignalPayload>('/api/strategy/signal/latest'),
      api<{ items: Job[] }>('/api/strategy/jobs?limit=20'),
    ])
    universe.value = u
    sealed.value = s
    signal.value = sig
    jobs.value = jl.items || []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

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
      error.value = st.error || st.message || '任务失败'
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  error.value = '等待超时，请稍后点刷新查看任务状态'
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
        <p class="kicker">NextLeek · ETF 轮动</p>
        <h1>今日信号</h1>
        <p class="sub">
          <strong>封版 = 锁死用哪几个因子算分</strong>，不是锁死永远拿哪几只 ETF。
          因子配方不变时，持仓仍会按规则更新：约每
          <strong>{{ rebalanceDays }}</strong>
          个交易日评估一次 · 同时持
          <strong>{{ posSize }}</strong>
          只 · 通常至少持有
          <strong>{{ minHoldDays }}</strong>
          天 · 新票优势不足（Δrank
          <strong>{{ deltaRank }}</strong>
          ）就不换。
          只有想<strong>换一套因子配方</strong>时，才去页面最下方做研究重筛。
        </p>
      </div>
      <button class="btn ghost" :disabled="busy" @click="refreshMeta()">刷新</button>
    </header>

    <section class="status-bar">
      <div class="stat">
        <span class="stat-label">信号日</span>
        <strong>{{ signalDate }}</strong>
        <span class="stat-extra">生产策略 {{ strategies.length || '—' }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">可交易标的</span>
        <strong>{{ tradeableCount || '—' }}/{{ symbolCount || '—' }}</strong>
        <span class="stat-extra">因子池 {{ factorCount || '—' }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">换仓节奏</span>
        <strong>每 {{ rebalanceDays }} 日评估</strong>
        <span class="stat-extra">最少持有 {{ minHoldDays }} 天</span>
      </div>
      <div class="stat">
        <span class="stat-label">当前任务</span>
        <strong v-if="busy || latestJob">
          {{ busy ? '执行中…' : jobStatusLabel(latestJob?.status) }}
        </strong>
        <strong v-else>—</strong>
        <span v-if="latestJob" class="stat-extra">{{ jobTypeLabel(latestJob.type) }}</span>
      </div>
    </section>

    <p v-if="error" class="err">{{ error }}</p>

    <!-- 主区：生产策略 + 日常操作 -->
    <section class="card primary-card">
      <div class="section-head">
        <div>
          <h2>生产策略 · 今日持仓</h2>
          <p class="hint">
            上面是日常主路径：先更新行情，再生成信号。
            <strong>不要</strong>为了看今天拿什么去点「一键全流程」——那会重跑研究筛选。
          </p>
        </div>
        <div class="row tight">
          <button class="btn" :disabled="busy" @click="startJob('update-data')">更新行情</button>
          <button class="btn primary" :disabled="busy" @click="startJob('signal')">生成今日信号</button>
        </div>
      </div>

      <div class="callout">
        <p><strong>什么时候换持仓？</strong>到了评估日，且新标的比当前最差持仓强够多，并且旧仓已满最少持有天数——才会换。所以连续多天同一对 ETF 很正常。</p>
        <p><strong>什么时候换因子？</strong>只有你主动做完下方 WFO→VEC→BT 并重新封版。日常信号不会自动换因子。</p>
      </div>

      <div v-if="strategies.length" class="signal-grid">
        <article
          v-for="strategy in strategies"
          :key="strategy.strategy_id"
          class="strategy-signal"
        >
          <div class="strategy-head">
            <div>
              <div class="role-row">
                <span class="role-pill">{{ strategyRole(strategy) }}</span>
                <span v-if="sourceText(strategy.source)" class="source-pill">
                  {{ sourceText(strategy.source) }}
                </span>
              </div>
              <strong class="strategy-title">{{ strategyTitle(strategy) }}</strong>
              <p v-if="strategyBlurb(strategy)" class="strategy-blurb">
                {{ strategyBlurb(strategy) }}
              </p>
            </div>
            <div class="asof-box">
              <span class="stat-label">信号日</span>
              <strong>{{ formatDate(strategy.asof || signal?.asof) }}</strong>
            </div>
          </div>

          <p class="signal-summary">{{ strategy.summary || '暂无说明' }}</p>

          <div v-if="strategy.factors?.length" class="strategy-factors">
            <p class="factor-heading">锁定的因子配方 · {{ strategy.factors.length }}（日常不改）</p>
            <div class="factor-row">
              <span
                v-for="f in strategy.factors"
                :key="f"
                class="factor-chip"
                :title="f"
              >{{ factorText(f) }} <code>{{ f }}</code></span>
            </div>
          </div>

          <div v-if="displayActions(strategy).length" class="signal-actions">
            <p class="factor-heading">当前持仓 / 动作</p>
            <div
              v-for="item in displayActions(strategy)"
              :key="`${item.action}-${item.symbol}`"
              class="signal-action"
            >
              <span :class="['action-badge', item.action]">{{ item.label }}</span>
              <div class="symbol-block">
                <strong class="symbol">{{ etfLabel(item.symbol) }}</strong>
                <span class="reason">{{ item.reason }}</span>
              </div>
              <span v-if="item.hold_days" class="days">已持 {{ item.hold_days }} 天</span>
            </div>
          </div>
          <p v-else class="empty">还没有持仓结论。点右上角「生成今日信号」。</p>

          <p v-if="strategy.last_rebalance" class="meta-line">
            上次换仓参考日：{{ formatDate(strategy.last_rebalance) }}
          </p>
        </article>
      </div>
      <p v-else class="empty">暂无生产策略定义。</p>
    </section>

    <section class="card">
      <div class="section-head">
        <h2>最近任务</h2>
      </div>
      <ul v-if="jobs.length" class="jobs">
        <li v-for="j in jobs" :key="j.job_id">
          <span class="job-type">{{ jobTypeLabel(j.type) }}</span>
          <span :class="['st', j.status]">{{ jobStatusLabel(j.status) }}</span>
          <span class="job-progress">{{ Math.round(j.pct || 0) }}%</span>
          <span class="job-msg">{{ jobMessage(j) }}</span>
        </li>
      </ul>
      <p v-else class="empty">还没有任务记录。</p>
    </section>

    <!-- 次要：因子池说明 -->
    <section class="card muted-card">
      <div class="section-head">
        <div>
          <h2>研究用因子池（共 {{ factorCount || 0 }} 个）</h2>
          <p class="hint">
            这是 WFO 可枚举的大池。生产策略只用其中锁定的那几个，见上方卡片。
          </p>
        </div>
      </div>
      <div v-if="factorPool.length" class="factor-groups">
        <div>
          <h3>行情类 · {{ ohlcvFactors.length }}</h3>
          <div class="factor-row">
            <span
              v-for="f in ohlcvFactors"
              :key="f.code"
              class="factor-chip"
              :title="f.code"
            >{{ f.label }}</span>
          </div>
        </div>
        <div>
          <h3>份额 / 融资类 · {{ altFactors.length }}</h3>
          <div class="factor-row">
            <span
              v-for="f in altFactors"
              :key="f.code"
              class="factor-chip alt"
              :title="f.code"
            >{{ f.label }}</span>
          </div>
        </div>
      </div>
      <p v-else class="empty">暂无因子列表，请检查配置是否加载成功。</p>
    </section>

    <!-- 最下方：研究重筛，默认收起 -->
    <section class="card research-card">
      <div class="section-head">
        <div>
          <h2>研究重筛（不常用）</h2>
          <p class="hint">
            只有想<strong>换因子配方 / 重新封版</strong>时才打开。
            日常看持仓请用上方「更新行情 → 生成今日信号」，不要点一键全流程。
          </p>
        </div>
        <button class="linkish" type="button" @click="showResearch = !showResearch">
          {{ showResearch ? '收起研究区' : '展开研究区' }}
        </button>
      </div>

      <div v-if="showResearch">
        <p class="research-warn">
          研究层进度 {{ researchProgress.done }}/{{ researchProgress.total }}（WFO · VEC · BT）。
          「一键全流程」会串行重跑整条研究链，耗时长，且<strong>不会自动改生产封版</strong>——确认更好后才谈换配方。
        </p>

        <ol class="pipeline">
          <li
            v-for="(step, idx) in researchSteps"
            :key="step.id"
            :class="['pipe-step', `is-${step.status}`]"
          >
            <div class="pipe-index">
              <span class="pipe-num">{{ idx + 1 }}</span>
              <span v-if="idx < researchSteps.length - 1" class="pipe-line" aria-hidden="true" />
            </div>
            <div class="pipe-body">
              <div class="pipe-top">
                <div>
                  <span class="pipe-eng">{{ step.eng }}</span>
                  <strong class="pipe-title">{{ step.title }}</strong>
                  <span class="pipe-time">{{ step.time }}</span>
                </div>
                <span :class="['pipe-status', step.status]">{{ stepStatusLabel(step.status) }}</span>
              </div>
              <p class="pipe-desc">{{ step.desc }}</p>
              <p class="pipe-detail">{{ step.detail }}</p>
              <p class="pipe-note">{{ step.note }}<template v-if="step.pct && step.status === 'running'"> · {{ Math.round(step.pct) }}%</template></p>
              <div class="pipe-actions">
                <button
                  class="btn sm"
                  :disabled="busy"
                  @click="startJob(step.id)"
                >
                  运行本层
                </button>
              </div>
            </div>
          </li>
        </ol>

        <div class="research-foot">
          <button
            class="btn ghost dangerish"
            :disabled="busy"
            @click="startJob('pipeline')"
          >
            一键全流程（研究用，慎点）
          </button>
          <p class="hint">内部仍按 数据 → WFO → VEC → BT → 信号 顺序。日常请勿使用。</p>
        </div>

        <p v-if="lastJobId" class="hint last-job">最近任务编号：{{ lastJobId }}</p>
      </div>
    </section>

  </div>

</template>

<style scoped>
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 56px;
  color: #e8eaed;
  font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  background:
    radial-gradient(1200px 400px at 10% -10%, rgba(47, 111, 237, 0.18), transparent 60%),
    radial-gradient(800px 300px at 90% 0%, rgba(105, 240, 174, 0.08), transparent 50%);
  min-height: 100vh;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}
.kicker {
  margin: 0 0 6px;
  color: #82b1ff;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
h1 {
  margin: 0;
  font-size: 1.55rem;
  letter-spacing: -0.02em;
}
h2 {
  margin: 0;
  font-size: 1.02rem;
}
h3 {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: rgba(232, 234, 237, 0.7);
}
.sub {
  margin: 8px 0 0;
  color: rgba(232, 234, 237, 0.68);
  font-size: 0.92rem;
  line-height: 1.55;
  max-width: 52rem;
}
.sub strong {
  color: #fff;
  font-weight: 700;
}
.status-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.stat {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 8px;
}
.stat-label {
  width: 100%;
  color: rgba(232, 234, 237, 0.5);
  font-size: 0.75rem;
}
.stat strong {
  font-size: 1.15rem;
}
.stat-extra {
  color: rgba(232, 234, 237, 0.5);
  font-size: 0.8rem;
}
.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 14px;
}
.primary-card {
  border-color: rgba(105, 240, 174, 0.28);
  box-shadow: 0 0 0 1px rgba(105, 240, 174, 0.06) inset;
}
.muted-card {
  opacity: 0.92;
}
.research-card {
  border-color: rgba(255, 171, 64, 0.28);
  box-shadow: 0 0 0 1px rgba(255, 171, 64, 0.06) inset;
}
.callout {
  margin: 0 0 14px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(47, 111, 237, 0.1);
  border: 1px solid rgba(47, 111, 237, 0.22);
}
.callout p {
  margin: 0 0 8px;
  color: rgba(232, 234, 237, 0.82);
  font-size: 0.88rem;
  line-height: 1.5;
}
.callout p:last-child {
  margin-bottom: 0;
}
.research-warn {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 171, 64, 0.1);
  border: 1px solid rgba(255, 171, 64, 0.22);
  color: rgba(255, 224, 178, 0.95);
  font-size: 0.86rem;
  line-height: 1.5;
}
.research-foot {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.pipeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.pipe-step {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 12px;
  min-height: 0;
}
.pipe-index {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pipe-num {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  flex-shrink: 0;
}
.pipe-line {
  width: 2px;
  flex: 1;
  min-height: 18px;
  margin: 4px 0;
  background: linear-gradient(180deg, rgba(130, 177, 255, 0.45), rgba(255, 255, 255, 0.08));
}
.pipe-body {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.16);
  margin-bottom: 12px;
}
.pipe-step.is-running .pipe-num,
.pipe-step.is-queued .pipe-num {
  background: rgba(130, 177, 255, 0.2);
  border-color: rgba(130, 177, 255, 0.5);
  color: #82b1ff;
}
.pipe-step.is-succeeded .pipe-num,
.pipe-step.is-skipped .pipe-num {
  background: rgba(105, 240, 174, 0.16);
  border-color: rgba(105, 240, 174, 0.4);
  color: #69f0ae;
}
.pipe-step.is-failed .pipe-num {
  background: rgba(255, 138, 128, 0.16);
  border-color: rgba(255, 138, 128, 0.45);
  color: #ff8a80;
}
.pipe-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}
.pipe-eng {
  display: inline-block;
  margin-right: 8px;
  color: #82b1ff;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.pipe-title {
  font-size: 1rem;
  margin-right: 8px;
}
.pipe-time {
  color: rgba(232, 234, 237, 0.45);
  font-size: 0.78rem;
}
.pipe-status {
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}
.pipe-status.running,
.pipe-status.queued {
  color: #82b1ff;
  background: rgba(130, 177, 255, 0.12);
}
.pipe-status.succeeded,
.pipe-status.skipped {
  color: #69f0ae;
  background: rgba(105, 240, 174, 0.12);
}
.pipe-status.failed {
  color: #ff8a80;
  background: rgba(255, 138, 128, 0.12);
}
.pipe-status.idle {
  color: rgba(232, 234, 237, 0.55);
}
.pipe-desc {
  margin: 8px 0 0;
  font-size: 0.92rem;
  font-weight: 600;
}
.pipe-detail,
.pipe-note {
  margin: 4px 0 0;
  color: rgba(232, 234, 237, 0.55);
  font-size: 0.8rem;
  line-height: 1.4;
}
.pipe-note {
  color: rgba(232, 234, 237, 0.72);
}
.pipe-actions {
  margin-top: 10px;
}
.last-job {
  margin-top: 4px;
}
.signal-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  max-width: 560px;
}
.factor-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.factor-heading {
  margin: 0 0 8px;
  color: rgba(232, 234, 237, 0.7);
  font-size: 0.8rem;
  font-weight: 600;
}
.strategy-factors {
  margin-bottom: 12px;
}
.strategy-signal {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 14px;
  background: rgba(0, 0, 0, 0.16);
}
.strategy-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.role-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.role-pill,
.source-pill,
.factor-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 0.72rem;
  font-weight: 600;
}
.role-pill {
  color: #69f0ae;
  background: rgba(105, 240, 174, 0.12);
  border: 1px solid rgba(105, 240, 174, 0.25);
}
.source-pill {
  color: rgba(232, 234, 237, 0.7);
  background: rgba(255, 255, 255, 0.05);
}
.strategy-title {
  display: block;
  font-size: 1.05rem;
}
.strategy-blurb {
  margin: 6px 0 0;
  color: rgba(232, 234, 237, 0.55);
  font-size: 0.82rem;
  line-height: 1.4;
}
.asof-box {
  text-align: right;
  min-width: 88px;
}
.signal-summary {
  margin: 14px 0 10px;
  font-size: 1.02rem;
  font-weight: 700;
  line-height: 1.4;
}
.factor-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.factor-chip {
  color: #82b1ff;
  background: rgba(130, 177, 255, 0.1);
  border: 1px solid rgba(130, 177, 255, 0.18);
  font-weight: 500;
  gap: 6px;
}
.factor-chip.alt {
  color: #ffd54f;
  background: rgba(255, 213, 79, 0.1);
  border-color: rgba(255, 213, 79, 0.22);
}
.factor-chip code {
  font-size: 0.68rem;
  font-weight: 500;
  opacity: 0.7;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.signal-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.signal-action {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}
.symbol-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.symbol {
  font-size: 0.95rem;
}
.reason,
.days,
.meta-line,
.hint,
.empty {
  color: rgba(232, 234, 237, 0.58);
  font-size: 0.8rem;
}
.reason {
  line-height: 1.35;
}
.days {
  white-space: nowrap;
}
.meta-line {
  margin: 12px 0 0;
}
.action-badge {
  display: inline-flex;
  justify-content: center;
  border-radius: 999px;
  padding: 5px 8px;
  font-size: 0.78rem;
  font-weight: 700;
}
.action-badge.buy {
  color: #69f0ae;
  background: rgba(105, 240, 174, 0.14);
}
.action-badge.sell {
  color: #ff8a80;
  background: rgba(255, 138, 128, 0.14);
}
.action-badge.hold,
.action-badge.current {
  color: #b0bec5;
  background: rgba(176, 190, 197, 0.12);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.row.tight {
  flex-shrink: 0;
}
.btn {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  border-radius: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 0.92rem;
}
.btn.sm {
  padding: 7px 12px;
  font-size: 0.84rem;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.primary {
  background: #2f6fed;
  border-color: #2f6fed;
  font-weight: 700;
}
.btn.ghost {
  background: transparent;
}
.btn.dangerish {
  border-color: rgba(255, 171, 64, 0.45);
  color: #ffcc80;
}
.linkish {
  border: 0;
  background: transparent;
  color: #82b1ff;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0;
}
.hint {
  margin: 8px 0 0;
  line-height: 1.45;
}
.empty {
  margin: 8px 0 0;
}
.err {
  color: #ff8a80;
  background: rgba(255, 82, 82, 0.12);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 0 0 12px;
}
.jobs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.jobs li {
  display: grid;
  grid-template-columns: minmax(120px, 1.2fr) 72px 48px 1.6fr;
  gap: 8px;
  align-items: center;
  font-size: 0.85rem;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
.job-type {
  font-weight: 600;
}
.job-progress {
  color: rgba(232, 234, 237, 0.55);
}
.job-msg {
  color: rgba(232, 234, 237, 0.62);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
@media (max-width: 960px) {
  .status-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .signal-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .status-bar {
    grid-template-columns: 1fr;
  }
  .jobs li {
    grid-template-columns: 1fr 72px;
  }
  .job-progress,
  .job-msg {
    grid-column: 1 / -1;
  }
  .signal-action {
    grid-template-columns: 64px 1fr;
  }
  .days {
    grid-column: 2;
  }
}
</style>
