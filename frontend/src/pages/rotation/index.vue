<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

const API = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000'

/** 日常测试日 YYYY-MM-DD；空字符串则用今天。测完改回 '' */
const DAILY_TEST_ASOF = '2026-08-25'


type FactorInfo = {
  code: string
  label: string
  group: string
  source?: string
  bucket?: string | null
  bucket_label?: string
  direction?: string
  direction_note?: string
  summary?: string
  principle?: string
}

type Universe = {
  mode?: string
  tradeable?: string[]
  symbols?: string[]
  active_factors?: string[]
  factor_catalog?: FactorInfo[]
  factor_count?: number
  backtest?: {
    freq?: number
    pos_size?: number
    hysteresis?: { delta_rank?: number; min_hold_days?: number }
  }
  schedule?: {
    enabled?: boolean
    label?: string
    next_run_text?: string
    hour?: number
    minute?: number
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
  since_date?: string | null
  hold_return?: number | null
  entry_close?: number | null
  last_close?: number | null
  price_date?: string | null
  score?: number | null
}

type RankRow = {
  symbol: string
  score?: number | null
  rank?: number
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
  rank_top?: RankRow[]
}

type HistoryNav = {
  dates?: string[]
  current?: string | null
  prev?: string | null
  next?: string | null
  index?: number | null
  total?: number
}

type SignalPayload = {
  strategies?: SignalStrategy[]
  note?: string | null
  asof?: string | null
  version?: string
  history?: HistoryNav
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
    blurb: '这是当前在用的生产策略。',
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
  BREAKOUT_20D: '突破 20 日',
  CALMAR_RATIO_60D: 'Calmar 比率',
  CORRELATION_TO_MARKET_20D: '与市场相关性',
  GK_VOL_RATIO_20D: 'GK 波动比',
  MAX_DD_60D: '最大回撤 60 日',
  MOM_20D: '动量 20 日',
  OBV_SLOPE_10D: 'OBV 斜率',
  PRICE_POSITION_20D: '价格位置 20 日',
  PRICE_POSITION_120D: '价格位置 120 日',
  PV_CORR_20D: '价量相关',
  SHARPE_RATIO_20D: '夏普 20 日',
  SLOPE_20D: '价格斜率',
  UP_DOWN_VOL_RATIO_20D: '涨跌量比',
  VOL_RATIO_20D: '波动率比',
  VORTEX_14D: '涡旋指标',
  SHARE_CHG_5D: '份额变化 5 日',
  SHARE_CHG_10D: '份额变化 10 日',
  SHARE_CHG_20D: '份额变化 20 日',
  SHARE_ACCEL: '份额加速度',
  MARGIN_CHG_10D: '融资变化 10 日',
  MARGIN_BUY_RATIO: '融资买入比',
}

const FACTOR_PRINCIPLE: Record<string, string> = {
  ADX_14D: '平均趋向指数，衡量趋势强弱（不管涨跌方向）。高 ADX 更偏单边趋势，低 ADX 更像震荡。',
  AMIHUD_ILLIQUIDITY:
    'Amihud 非流动性：|收益|/成交额。越高冲击越大；截面常偏好更好成交的标的（low_is_good）。',
  BREAKOUT_20D: '近 20 日突破信号：是否站上近期高点区间，捕捉趋势启动或加速。',
  CALMAR_RATIO_60D: '约 60 日收益相对最大回撤的性价比，偏好「涨且回撤可控」的中期路径。',
  CORRELATION_TO_MARKET_20D:
    '与市场近 20 日相关性。过高≈纯贝塔；常偏好更独立的标的（low_is_good）。',
  GK_VOL_RATIO_20D: '用高低开收估计的波动相对比值，刻画实现波动结构（微观/风险维）。',
  MAX_DD_60D: '近 60 日最大回撤。回撤越小路径质量越好（low_is_good）。',
  MOM_20D: '经典 20 日动量：涨得多的截面占优，ETF 轮动核心趋势维，但拥挤时回撤大。',
  OBV_SLOPE_10D: 'OBV 近 10 日斜率：涨跌是否有累计成交量确认。',
  PRICE_POSITION_20D: '收盘价在近 20 日高低点中的位置（0~1），短周期强弱态。',
  PRICE_POSITION_120D: '收盘价在近 120 日高低点中的位置，中期结构高低，与 20 日互补。',
  PV_CORR_20D: '价量相关性。价涨放量更健康，价涨缩量则趋势质量打折。',
  SHARPE_RATIO_20D: '近 20 日风险调整动量，惩罚大起大落的上涨。',
  SLOPE_20D: '近 20 日价格时间回归斜率，平滑版趋势方向与速度。',
  UP_DOWN_VOL_RATIO_20D: '上涨日量/下跌日量，买盘量能是否占优。',
  VOL_RATIO_20D: '近端波动相对更长窗是否升温，风险/状态维。',
  VORTEX_14D: '涡旋指标：正/反向趋势运动相对优势，与动量同族但构造不同。',
  SHARE_CHG_5D: 'ETF 5 日份额变化（申赎）。历史常作逆向拥挤度（low_is_good）。',
  SHARE_CHG_10D: '10 日份额变化，份额类里较稳的一档，偏资金流逆向解读。',
  SHARE_CHG_20D: '20 日份额变化，看中等周期申赎是否持续。',
  SHARE_ACCEL: '份额变化加速度，捕捉申赎节奏拐点，与水平变化率不完全同号。',
  MARGIN_CHG_10D: '融资余额 10 日变化，杠杆加减仓代理；过热时常逆向（low_is_good）。',
  MARGIN_BUY_RATIO: '融资买入占比，杠杆买盘活跃度；过高偏投机拥挤（low_is_good）。',
}

/** 日常优先；研究步骤沉底 */
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
    title: '筛选层',
    eng: 'WFO / 手选',
    time: '视模式',
    desc: 'WFO 自动枚举，或手动勾选 2–8 个因子',
    detail: '研究用：在这一层决定走自动筛选还是自选因子。',
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
/** 空=看最新；有值则翻历史日，轮询不再覆盖 */
const viewedSignalDate = ref('')
const result = ref<unknown>(null)
const error = ref('')
const busy = ref(false)
const lastJobId = ref('')
const sealNotice = ref('')
const publishBusy = ref(false)
const showResearch = ref(false)
/** 正在拉取某一任务的 result.json，避免卡片空白闪一下 */
const resultLoading = ref(false)
/** wfo=自动枚举；manual=本层手选因子后进 VEC/BT */
const researchMode = ref<'wfo' | 'manual'>('wfo')
const selectedFactorCodes = ref<string[]>([])
const detailFactorCode = ref<string | null>(null)
const detailOpen = ref(false)
const modalRootRef = ref<HTMLElement | null>(null)

let timer: number | undefined

const OHLCV_FACTOR_CODES = new Set([
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

const factorPool = computed((): FactorInfo[] => {
  const catalog = universe.value?.factor_catalog
  if (catalog?.length) {
    return catalog.map((item) => ({
      ...item,
      label: item.label || factorText(item.code),
      group: item.group || (OHLCV_FACTOR_CODES.has(item.code) ? '行情类' : '份额/融资类'),
      principle: item.principle || FACTOR_PRINCIPLE[item.code] || item.summary || '',
    }))
  }
  const codes = universe.value?.active_factors || Object.keys(FACTOR_LABEL)
  return codes.map((code) => ({
    code,
    label: factorText(code),
    group: OHLCV_FACTOR_CODES.has(code) ? '行情类' : '份额/融资类',
    principle: FACTOR_PRINCIPLE[code] || '',
    summary: factorText(code),
  }))
})

const ohlcvFactors = computed(() => factorPool.value.filter((f) => f.group === '行情类'))
const altFactors = computed(() => factorPool.value.filter((f) => f.group !== '行情类'))

const selectedFactorSet = computed(() => new Set(selectedFactorCodes.value))

const manualSelectOk = computed(() => {
  const n = selectedFactorCodes.value.length
  return n >= 2 && n <= 8
})

const tradeableCount = computed(() => universe.value?.tradeable?.length ?? 0)
const symbolCount = computed(() => universe.value?.symbols?.length ?? 0)
const signalDate = computed(() => formatDate(signal.value?.asof || viewedSignalDate.value || undefined))
const signalHistory = computed(() => signal.value?.history || {})
const canPrevSignal = computed(() => Boolean(signalHistory.value.prev))
const canNextSignal = computed(() => Boolean(signalHistory.value.next))
const signalPageText = computed(() => {
  const h = signalHistory.value
  if (!h.total) return ''
  return `${h.index || 0}/${h.total}`
})
const posSize = computed(() => universe.value?.backtest?.pos_size ?? 2)
const rebalanceDays = computed(() => universe.value?.backtest?.freq ?? 5)
const scheduleLabel = computed(
  () => universe.value?.schedule?.label || '每个交易日 15:30（北京时间）',
)
const nextScheduleText = computed(() => universe.value?.schedule?.next_run_text || '')
const scheduleHour = computed(() => universe.value?.schedule?.hour ?? 15)
const scheduleMinute = computed(() => universe.value?.schedule?.minute ?? 30)
const deltaRank = computed(() => universe.value?.backtest?.hysteresis?.delta_rank ?? 0.1)
const minHoldDays = computed(() => universe.value?.backtest?.hysteresis?.min_hold_days ?? 9)

/** 顶栏「当前任务」只看任务执行态，不看信号日 */
const currentTask = computed(() => {
  const active = jobs.value.find((j) => j.status === 'running' || j.status === 'queued')
  if (busy.value || active) {
    const job = active || latestJob.value
    return { label: '进行中', extra: job ? jobTypeLabel(job.type) : '' }
  }
  const job = latestJob.value
  if (!job) return { label: '无', extra: '' }
  if (job.status === 'failed') {
    return { label: '未完成', extra: jobTypeLabel(job.type) }
  }
  if (job.status === 'succeeded') {
    return { label: '已完成', extra: jobTypeLabel(job.type) }
  }
  return { label: '无', extra: '' }
})

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


const latestJob = computed(() => jobs.value[0] || null)
const recentJobs = computed(() => jobs.value.slice(0, 5))


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

const detailFactor = computed(() => {
  const code = detailFactorCode.value
  if (!code) return null
  return (
    factorPool.value.find((f) => f.code === code) || {
      code,
      label: factorText(code),
      group: OHLCV_FACTOR_CODES.has(code) ? '行情类' : '份额/融资类',
      principle: FACTOR_PRINCIPLE[code] || '',
      summary: factorText(code),
    }
  )
})

function setBodyScrollLocked(locked: boolean) {
  document.body.style.overflow = locked ? 'hidden' : ''
}

/** 点击因子胶囊：打开原理弹窗 */
async function openFactorDetail(code: string) {
  detailFactorCode.value = code
  detailOpen.value = true
  setBodyScrollLocked(true)
  await nextTick()
  modalRootRef.value?.focus()
}

function closeFactorDetail() {
  detailOpen.value = false
  setBodyScrollLocked(false)
}

function isFactorSelected(code: string): boolean {
  return selectedFactorSet.value.has(code)
}

/** 筛选层手动模式：点胶囊勾选/取消 */
function toggleFactor(code: string) {
  const set = new Set(selectedFactorCodes.value)
  if (set.has(code)) set.delete(code)
  else set.add(code)
  selectedFactorCodes.value = Array.from(set)
}

function clearSelectedFactors() {
  selectedFactorCodes.value = []
}

/**
 * 研究步骤运行入口。
 * 筛选层：WFO 模式跑 wfo；手动模式校验 2–8 后直接跑 VEC（跳过 WFO）。
 * VEC/BT 在手动模式下带 factors+manual。
 */
function researchStepButtonLabel(stepId: PipelineStepId): string {
  if (stepId === 'wfo') {
    return researchMode.value === 'manual' ? '确认手选并跑 VEC' : '运行 WFO'
  }
  if (stepId === 'vec' || stepId === 'bt') {
    return researchMode.value === 'manual' ? `手选运行 ${stepId.toUpperCase()}` : '运行本层'
  }
  return '运行本层'
}

function researchStepDisabled(stepId: PipelineStepId): boolean {
  if (stepId === 'wfo' || stepId === 'vec' || stepId === 'bt') {
    if (researchMode.value === 'manual') return !manualSelectOk.value
  }
  return false
}

async function runResearchStep(stepId: PipelineStepId) {
  if (stepId === 'update-data') {
    await startJob('update-data')
    return
  }

  if (stepId === 'wfo') {
    if (researchMode.value === 'manual') {
      if (!manualSelectOk.value) {
        error.value = '手动模式请先勾选 2–8 个因子'
        return
      }
      await startJob('vec', {
        factors: [...selectedFactorCodes.value],
        manual: true,
      })
      return
    }
    await startJob('wfo')
    return
  }

  if (stepId === 'vec' || stepId === 'bt') {
    if (researchMode.value === 'manual') {
      if (!manualSelectOk.value) {
        error.value = '手动模式请先勾选 2–8 个因子'
        return
      }
      await startJob(stepId, {
        factors: [...selectedFactorCodes.value],
        manual: true,
      })
      return
    }
    await startJob(stepId)
  }
}

/** 一键全流程：手动模式不支持（后端 pipeline 不会把 factors 接到 VEC） */
async function startFullResearch() {
  if (researchMode.value === 'manual') {
    error.value = '手动模式请逐层运行 VEC / BT，不要用一键全流程'
    return
  }
  await startJob('pipeline')
}

function formatDate(raw?: string | null): string {
  if (!raw) return '—'
  const s = String(raw).replace(/-/g, '')
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return String(raw).slice(0, 10)
}

/** 任务最后操作时间：优先 updated_at，否则 created_at */
function formatJobTime(job: Job): string {
  const raw = job.updated_at || job.created_at
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    const text = String(raw).replace('T', ' ')
    return text.length >= 16 ? text.slice(0, 16) : text
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

const SCORE_TOP_N = 10

/** 评分默认前 10；持仓代码打标，方便对照 */
function displayScoreRows(strategy: SignalStrategy): RankRow[] {
  const held = new Set(strategy.holdings || [])
  const fromSnap = (strategy.rank_top || []).filter((r) => r.symbol)
  if (fromSnap.length) {
    return fromSnap
      .slice()
      .sort((a, b) => (a.rank || 99) - (b.rank || 99) || (b.score || 0) - (a.score || 0))
      .slice(0, SCORE_TOP_N)
  }
  // 旧快照没有 rank_top 时，用持仓评分凑一列，不够 10 就只展示已有的
  return displayActions(strategy)
    .filter((a) => a.score != null || held.has(a.symbol))
    .sort((a, b) => (b.score || -Infinity) - (a.score || -Infinity))
    .slice(0, SCORE_TOP_N)
    .map((a, i) => ({ symbol: a.symbol, score: a.score ?? null, rank: i + 1 }))
}

function isHolding(strategy: SignalStrategy, symbol: string): boolean {
  return (strategy.holdings || []).includes(symbol)
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

function normalizeFactorList(raw: unknown): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    const out: string[] = []
    for (const item of raw) {
      out.push(...normalizeFactorList(item))
    }
    return out
  }
  const text = String(raw).trim()
  if (!text) return []
  return text
    .replace(/,/g, '+')
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
}

function dedupeFactors(factors: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of factors) {
    if (seen.has(f)) continue
    seen.add(f)
    out.push(f)
  }
  return out
}

type PublishCandidate = {
  factors: string[]
  combo: string
  jobId?: string
  metrics?: Record<string, unknown>
  label: string
}

function pickMetrics(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const keys = ['total_return', 'sharpe', 'max_drawdown', 'engine', 'start', 'end'] as const
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (data[k] != null) out[k] = data[k]
  }
  return Object.keys(out).length ? out : undefined
}

type EquityPoint = { date: string; equity: number }

type MetricItem = {
  key: string
  label: string
  text: string
  tone: 'pos' | 'neg' | 'neu'
}

type ComboRow = {
  key: string
  factors: string[]
  score?: number
  ic?: number
  totalReturn?: number
  sharpe?: number
  maxDrawdown?: number
  trades?: number
  trainReturn?: number
}

type ResultKind = 'backtest' | 'wfo' | 'signal' | 'update' | 'generic'

type ParsedResult = {
  kind: ResultKind
  title: string
  engine?: string
  factors: string[]
  metrics: MetricItem[]
  extra: { label: string; text: string }[]
  equity: EquityPoint[]
  combos: ComboRow[]
  comboCaption?: string
}

/** 把未知 JSON 收成对象；数组/空值直接丢掉 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

/** 收益/回撤一类比例：0.123 → +12.30% */
function formatPct(value: unknown, digits = 2): string {
  const n = asNumber(value)
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`
}

function formatNum(value: unknown, digits = 2): string {
  const n = asNumber(value)
  if (n == null) return '—'
  return n.toFixed(digits)
}

function formatInt(value: unknown): string {
  const n = asNumber(value)
  if (n == null) return '—'
  return String(Math.round(n))
}

/** 净值点数：带千分位，保留最多 2 位 */
function formatPoints(value: unknown): string {
  const n = asNumber(value)
  if (n == null) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function metricTone(value: unknown, invert = false): 'pos' | 'neg' | 'neu' {
  const n = asNumber(value)
  if (n == null || n === 0) return 'neu'
  const pos = invert ? n < 0 : n > 0
  return pos ? 'pos' : 'neg'
}

function parseEquityCurve(raw: unknown): EquityPoint[] {
  if (!Array.isArray(raw)) return []
  const out: EquityPoint[] = []
  for (const item of raw) {
    const row = asRecord(item)
    if (!row) continue
    const equity = asNumber(row.equity ?? row.value ?? row.nav)
    if (equity == null) continue
    out.push({ date: String(row.date ?? row.trade_date ?? ''), equity })
  }
  return out
}

function parseComboRows(raw: unknown, limit = 12): ComboRow[] {
  if (!Array.isArray(raw)) return []
  const out: ComboRow[] = []
  for (let i = 0; i < raw.length && out.length < limit; i++) {
    const item = raw[i]
    let factors: string[] = []
    let score: number | undefined
    let ic: number | undefined
    let totalReturn: number | undefined
    let sharpe: number | undefined
    let maxDrawdown: number | undefined
    let trades: number | undefined
    let trainReturn: number | undefined
    if (typeof item === 'string') {
      factors = dedupeFactors(normalizeFactorList(item))
    } else {
      const row = asRecord(item)
      if (!row) continue
      factors = dedupeFactors([
        ...normalizeFactorList(row.factors),
        ...normalizeFactorList(row.combo),
      ])
      score = asNumber(row.score)
      ic = asNumber(row.ic)
      totalReturn = asNumber(row.total_return ?? row.bt_return ?? row.vec_return)
      sharpe = asNumber(row.sharpe ?? row.sharpe_ratio ?? row.bt_sharpe_ratio ?? row.train_sharpe)
      maxDrawdown = asNumber(row.max_drawdown ?? row.train_maxdd ?? row.bt_max_drawdown)
      trades = asNumber(row.trades)
      trainReturn = asNumber(row.train_return)
    }
    if (!factors.length && totalReturn == null && sharpe == null) continue
    out.push({
      key: `${factors.join('+') || 'row'}-${i}`,
      factors,
      score,
      ic,
      totalReturn,
      sharpe,
      maxDrawdown,
      trades,
      trainReturn,
    })
  }
  return out
}

function extractFactorsFromPayload(data: Record<string, unknown>): string[] {
  let factors = dedupeFactors([
    ...normalizeFactorList(data.factors),
    ...normalizeFactorList(data.requested_factors),
    ...normalizeFactorList(data.combo),
    ...normalizeFactorList(data.best_combo),
    ...normalizeFactorList(data.manual_combo),
  ])
  if (factors.length < 2) {
    const firstCombo = parseComboRows(
      data.candidates || data.vec_top || data.top_combos || data.winners,
      1,
    )[0]
    if (firstCombo?.factors.length) factors = firstCombo.factors
  }
  return factors
}

/** 按任务类型把 result.json 收成页面能画的结构 */
function parseJobResult(data: unknown, job?: Job | null): ParsedResult | null {
  const rec = asRecord(data)
  if (!rec) return null
  const type = job?.type || String(rec.engine || rec.type || '')
  const factors = extractFactorsFromPayload(rec)
  const extra: ParsedResult['extra'] = []
  const metrics: MetricItem[] = []

  const pushMetric = (key: string, label: string, text: string, tone: MetricItem['tone'] = 'neu') => {
    if (text === '—') return
    metrics.push({ key, label, text, tone })
  }

  if (type === 'update-data' || rec.updated != null || rec.files_written != null) {
    const updated = asNumber(rec.updated ?? rec.n_updated ?? rec.symbol_count)
    const written = asNumber(rec.files_written ?? rec.wrote)
    if (updated != null) extra.push({ label: '更新标的', text: formatInt(updated) })
    if (written != null) extra.push({ label: '写入文件', text: formatInt(written) })
    if (rec.message) extra.push({ label: '说明', text: String(rec.message) })
    return { kind: 'update', title: '行情已写入本地', factors, metrics, extra, equity: [], combos: [] }
  }

  if (type === 'signal' || rec.runtime === 'canonical') {
    extra.push({ label: '信号日', text: formatDate(String(rec.asof || '')) })
    extra.push({ label: '执行日', text: formatDate(String(rec.trade_date || '')) })
    if (rec.runtime) extra.push({ label: '引擎', text: String(rec.runtime) })
    return {
      kind: 'signal',
      title: '今日信号已生成',
      engine: String(rec.runtime || 'canonical'),
      factors,
      metrics,
      extra,
      equity: [],
      combos: [],
    }
  }

  const totalReturn = asNumber(rec.total_return ?? rec.bt_return ?? rec.vec_return)
  const sharpe = asNumber(rec.sharpe ?? rec.sharpe_ratio ?? rec.bt_sharpe_ratio)
  const maxDd = asNumber(rec.max_drawdown ?? rec.maxdd ?? rec.bt_max_drawdown)
  const annual = asNumber(rec.annual_return ?? rec.bt_annual_return)
  const calmar = asNumber(rec.calmar_ratio ?? rec.calmar)
  const holdout = asNumber(rec.holdout_return ?? rec.bt_holdout_return)
  const trades = asNumber(rec.trades)
  const days = asNumber(rec.days)
  const equity = parseEquityCurve(rec.equity_curve)
  const isBacktest =
    type === 'vec' ||
    type === 'bt' ||
    rec.engine === 'vec' ||
    rec.engine === 'bt' ||
    totalReturn != null ||
    equity.length > 0

  if (isBacktest && (totalReturn != null || sharpe != null || equity.length)) {
    pushMetric('return', '总收益', formatPct(totalReturn), metricTone(totalReturn))
    pushMetric('annual', '年化', formatPct(annual), metricTone(annual))
    pushMetric('sharpe', '夏普', formatNum(sharpe), metricTone(sharpe))
    pushMetric('maxdd', '最大回撤', formatPct(maxDd), metricTone(maxDd, true))
    pushMetric('calmar', 'Calmar', formatNum(calmar), metricTone(calmar))
    pushMetric('holdout', '样本外收益', formatPct(holdout), metricTone(holdout))
    if (trades != null) extra.push({ label: '交易次数', text: formatInt(trades) })
    if (days != null) extra.push({ label: '回测天数', text: formatInt(days) })
    const startDate = formatDate(String(equity[0]?.date || rec.start || ''))
    const endDate = formatDate(String(equity[equity.length - 1]?.date || rec.end || ''))
    const startPts = equity.length ? formatPoints(equity[0].equity) : ''
    const endPts = equity.length ? formatPoints(equity[equity.length - 1].equity) : ''
    extra.push({
      label: '起始',
      text: startPts ? `${startDate} · ${startPts}` : startDate,
    })
    extra.push({
      label: '结束',
      text: endPts ? `${endDate} · ${endPts}` : endDate,
    })
    if (rec.n_symbols != null) extra.push({ label: '标的数', text: formatInt(rec.n_symbols) })
    extra.push({ label: '引擎', text: String(rec.engine || type || '回测').toUpperCase() })
    return {
      kind: 'backtest',
      title: type === 'bt' || rec.engine === 'bt' ? 'BT 真实回测结果' : 'VEC 快速回测结果',
      engine: String(rec.engine || type || ''),
      factors,
      metrics,
      extra: extra.filter((x) => x.text && x.text !== '— ~ —'),
      equity,
      combos: parseComboRows(rec.top_combos || rec.winners, 8),
      comboCaption: '候选组合',
    }
  }

  if (type === 'wfo' || rec.candidates || rec.combo_count_tested != null) {
    extra.push({ label: '测过组合', text: formatInt(rec.combo_count_tested) })
    extra.push({ label: '通过', text: formatInt(rec.combo_count_passed) })
    extra.push({ label: '样本切分日', text: formatDate(String(rec.split_date || '')) })
    const candidates = parseComboRows(rec.candidates, 10)
    const vecTop = parseComboRows(rec.vec_top, 8)
    return {
      kind: 'wfo',
      title: 'WFO 筛选结果',
      factors,
      metrics,
      extra: extra.filter((x) => x.text !== '—'),
      equity: [],
      combos: vecTop.length ? vecTop : candidates,
      comboCaption: vecTop.length ? 'VEC 初筛前列' : '训练期候选',
    }
  }

  extra.push({ label: '任务', text: jobTypeLabel(type) })
  if (rec.message) extra.push({ label: '说明', text: String(rec.message) })
  return {
    kind: 'generic',
    title: '任务结果',
    factors,
    metrics,
    extra,
    equity: [],
    combos: parseComboRows(rec.top_combos || rec.winners || rec.candidates, 8),
  }
}

function extractCandidateFromPayload(data: unknown, jobId?: string, label = '研究结果'): PublishCandidate | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  let factors = dedupeFactors([
    ...normalizeFactorList(o.factors),
    ...normalizeFactorList(o.requested_factors),
    ...normalizeFactorList(o.combo),
    ...normalizeFactorList(o.best_combo),
  ])

  if (factors.length < 2 && Array.isArray(o.top_combos) && o.top_combos.length) {
    const first = o.top_combos[0]
    if (typeof first === 'string') factors = dedupeFactors(normalizeFactorList(first))
    else if (first && typeof first === 'object') {
      const row = first as Record<string, unknown>
      factors = dedupeFactors([
        ...normalizeFactorList(row.factors),
        ...normalizeFactorList(row.combo),
      ])
    }
  }

  if (factors.length < 2 && Array.isArray(o.winners) && o.winners.length) {
    const first = o.winners[0]
    if (typeof first === 'string') factors = dedupeFactors(normalizeFactorList(first))
    else if (first && typeof first === 'object') {
      const row = first as Record<string, unknown>
      factors = dedupeFactors([
        ...normalizeFactorList(row.factors),
        ...normalizeFactorList(row.combo),
      ])
    }
  }

  if (factors.length < 2) return null
  return {
    factors,
    combo: factors.join('+'),
    jobId,
    metrics: pickMetrics(o),
    label,
  }
}

const researchCandidate = computed(() => {
  const fromResult = extractCandidateFromPayload(
    result.value,
    lastJobId.value || undefined,
    '最近一次研究任务',
  )
  if (fromResult) return fromResult
  return null
})

/** 当前正在展示的那条任务（用来写标题来源） */
const resultJob = computed(() => jobs.value.find((j) => j.job_id === lastJobId.value) || null)

/** 把原始 result.json 收成指标 / 净值 / 候选表 */
const parsedResult = computed(() => parseJobResult(result.value, resultJob.value))

/** 用 SVG path 画净值，不另引图表库 */
const equityChart = computed(() => {
  const points = parsedResult.value?.equity || []
  if (points.length < 2) return null
  const values = points.map((p) => p.equity)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || Math.abs(max) || 1
  const w = 640
  const h = 168
  const padX = 8
  const padY = 10
  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * (w - padX * 2)
    const y = padY + (1 - (p.equity - min) / span) * (h - padY * 2)
    return { x, y }
  })
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)} ${h - 2} L${coords[0].x.toFixed(1)} ${h - 2} Z`
  const up = points[points.length - 1].equity >= points[0].equity
  return {
    w,
    h,
    line,
    area,
    up,
    start: formatDate(points[0].date),
    end: formatDate(points[points.length - 1].date),
    startEquity: formatPoints(points[0].equity),
    endEquity: formatPoints(points[points.length - 1].equity),
  }
})

function comboFactorsText(factors: string[]): string {
  return factors.map((f) => factorText(f)).join(' + ') || '—'
}

const sealedPrimaryCombo = computed(() => {
  const list = sealed.value?.sealed || []
  const primary =
    list.find((s) => s.id === 'v8_composite_1' || s.name === 'v8_composite_1') || list[0]
  return primary?.combo || (primary?.factors || []).join('+') || ''
})

async function resolvePublishCandidate(): Promise<PublishCandidate | null> {
  if (researchCandidate.value) return researchCandidate.value

  const prefer = ['bt', 'vec', 'wfo'] as const
  for (const type of prefer) {
    const job = jobs.value.find((j) => j.type === type && j.status === 'succeeded')
    if (!job?.job_id) continue
    try {
      const payload = await api(`/api/strategy/jobs/${job.job_id}/result`)
      const cand = extractCandidateFromPayload(payload, job.job_id, `${jobTypeLabel(type)} 任务`)
      if (cand) return cand
    } catch {
      // try next
    }
  }
  return null
}

async function publishToProduction() {
  sealNotice.value = ''
  error.value = ''
  publishBusy.value = true
  try {
    const cand = await resolvePublishCandidate()
    if (!cand) {
      error.value = '没有可封版的研究因子。请先跑通 VEC/BT，或确保结果里带 factors/combo。'
      return
    }

    const lines = [
      '将替换生产主策略的封版因子（只换配方，不改持仓，不自动生成信号）。',
      '',
      `来源：${cand.label}${cand.jobId ? ` · ${cand.jobId}` : ''}`,
      `新因子：${cand.factors.map((f) => factorText(f)).join(' + ')}`,
      `代码：${cand.combo}`,
    ]
    if (sealedPrimaryCombo.value) {
      lines.push(`当前主策略：${sealedPrimaryCombo.value}`)
    }
    lines.push('', '确认封版到生产？')
    if (!window.confirm(lines.join('\n'))) return

    const resp = await api<{
      changed?: boolean
      message?: string
      hint?: string
      primary?: { combo?: string }
    }>('/api/strategy/sealed/publish', {
      method: 'POST',
      body: JSON.stringify({
        combo: cand.factors,
        source_job_id: cand.jobId,
        metrics: cand.metrics,
        note: `published from rotation UI (${cand.label})`,
      }),
    })

    sealNotice.value =
      (resp.changed === false
        ? resp.message || '主策略已是该配方，无需改动。'
        : resp.hint || resp.message || '已封版到生产。') +
      (resp.primary?.combo ? ` 当前：${resp.primary.combo}` : '')
    await refreshMeta(true)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    publishBusy.value = false
  }
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

/** 拉取任务结果；silent 用于刷新时的自动回填，失败不刷红字 */
async function loadJobResult(id: string, silent = false) {
  if (!id) return
  resultLoading.value = true
  try {
    result.value = await api(`/api/strategy/jobs/${id}/result`)
    lastJobId.value = id
  } catch (e) {
    if (!silent) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    resultLoading.value = false
  }
}

async function openJobResult(job: Job) {
  if (job.status !== 'succeeded') return
  error.value = ''
  await loadJobResult(job.job_id)
}

function goSignalDate(stamp?: string | null) {
  viewedSignalDate.value = stamp ? String(stamp).replace(/-/g, '') : ''
  void refreshMeta(true)
}

function goPrevSignal() {
  if (signalHistory.value.prev) goSignalDate(signalHistory.value.prev)
}

function goNextSignal() {
  if (signalHistory.value.next) goSignalDate(signalHistory.value.next)
}

function goLatestSignal() {
  goSignalDate('')
}

function pickLatestDisplayJob(list: Job[]): Job | null {
  const prefer = ['bt', 'vec', 'wfo', 'pipeline', 'signal', 'update-data']
  for (const type of prefer) {
    const hit = list.find((j) => j.type === type && j.status === 'succeeded')
    if (hit) return hit
  }
  return list.find((j) => j.status === 'succeeded') || null
}

async function refreshMeta(preserveError = false) {
  if (!preserveError) error.value = ''
  try {
    const signalPath = viewedSignalDate.value
      ? `/api/strategy/signal/latest?date=${viewedSignalDate.value}`
      : '/api/strategy/signal/latest'
    const [u, s, sig, jl] = await Promise.all([
      api<Universe>('/api/strategy/universe'),
      api<SealedPayload>('/api/strategy/sealed'),
      api<SignalPayload>(signalPath),
      api<{ items: Job[] }>('/api/strategy/jobs?limit=20'),
    ])
    universe.value = u
    sealed.value = s
    signal.value = sig
    jobs.value = jl.items || []
    // 刷新后若还没有结果，自动带出最近一次成功的研究/回测
    if (!result.value && !busy.value) {
      const current = lastJobId.value
        ? jobs.value.find((j) => j.job_id === lastJobId.value && j.status === 'succeeded')
        : null
      const fallback = current || pickLatestDisplayJob(jobs.value)
      if (fallback) await loadJobResult(fallback.job_id, true)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function startJob(
  type: string,
  params: Record<string, unknown> = {},
  opts: { keepResult?: boolean } = {},
) {
  busy.value = true
  error.value = ''
  // 日常自动拉数不要冲掉下面的回测卡
  if (!opts.keepResult) result.value = null
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

/** 真实日历日 YYYYMMDD，用来判断今天是否已经自动跑过 */
function todayStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function dailyJobParams(type: string): Record<string, unknown> {
  if (!DAILY_TEST_ASOF) return {}
  // 行情始终拉到今天，测试日只钉信号 asof，避免把 26 号收盘截掉
  if (type === 'update-data') return {}
  if (type === 'signal') {
    return { asof: DAILY_TEST_ASOF, trade_date: DAILY_TEST_ASOF.replace(/-/g, '') }
  }
  return {}
}

function jobDayStamp(job: Job): string {
  const raw = job.updated_at || job.created_at
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    const digits = String(raw).replace(/\D/g, '')
    return digits.slice(0, 8)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function hasSucceededToday(type: string): boolean {
  const today = todayStamp()
  return jobs.value.some(
    (j) => j.type === type && j.status === 'succeeded' && jobDayStamp(j) === today,
  )
}

/** 过了定时点（默认 15:30）且当天还没跑完，打开页面时补跑。 */
function pastDailySchedule(): boolean {
  const now = new Date()
  return now.getHours() > scheduleHour.value || (
    now.getHours() === scheduleHour.value && now.getMinutes() >= scheduleMinute.value
  )
}

async function ensureDailyPipeline() {
  if (busy.value) return
  const active = jobs.value.find(
    (j) =>
      (j.status === 'running' || j.status === 'queued') &&
      (j.type === 'update-data' || j.type === 'signal'),
  )
  if (active) {
    busy.value = true
    try {
      await pollJob(active.job_id)
    } finally {
      busy.value = false
      await refreshMeta(true)
    }
  }

  if (!pastDailySchedule()) return

  const needUpdate = !hasSucceededToday('update-data')
  const needSignal = !hasSucceededToday('signal')
  if (!needUpdate && !needSignal) return

  if (needUpdate) {
    await startJob('update-data', dailyJobParams('update-data'), { keepResult: true })
    if (error.value) return
  }
  if (needUpdate || needSignal) {
    await startJob('signal', dailyJobParams('signal'), { keepResult: true })
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

onMounted(async () => {
  await refreshMeta()
  await ensureDailyPipeline()
  timer = window.setInterval(() => refreshMeta(true), 15000)
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
  setBodyScrollLocked(false)
})
</script>

<template>
  <div class="page">
    <header class="head">
      <button class="btn ghost" :disabled="busy" @click="refreshMeta()">刷新</button>
    </header>

    <section class="status-bar">
      <div class="stat">
        <span class="stat-label">信号日</span>
        <strong>{{ signalDate }}</strong>
        <div class="date-pager">
          <button type="button" class="btn ghost sm" :disabled="!canPrevSignal" @click="goPrevSignal">前一日</button>
          <span v-if="signalPageText" class="pager-idx">{{ signalPageText }}</span>
          <button type="button" class="btn ghost sm" :disabled="!canNextSignal" @click="goNextSignal">后一日</button>
          <button
            v-if="viewedSignalDate"
            type="button"
            class="btn ghost sm"
            @click="goLatestSignal"
          >最新</button>
        </div>
      </div>
      <div class="stat">
        <span class="stat-label">可交易</span>
        <strong>{{ tradeableCount || '—' }}/{{ symbolCount || '—' }}</strong>
      </div>
      <div class="stat">
        <span class="stat-label">换仓节奏</span>
        <strong>每 {{ rebalanceDays }} 日</strong>
      </div>
      <div class="stat">
        <span class="stat-label">当前任务</span>
        <strong>{{ currentTask.label }}</strong>
        <span v-if="currentTask.extra" class="stat-extra">{{ currentTask.extra }}</span>
      </div>
    </section>

    <p v-if="error" class="err">{{ error }}</p>

    <section class="card primary-card">
      <div class="section-head">
        <div>
          <h2>今日操作</h2>
          <div class="howto compact">
            <p>定时：{{ scheduleLabel }}，先更新行情再生成信号。</p>
            <p v-if="nextScheduleText">下次：{{ nextScheduleText }}</p>
            <p>strategy-api 需保持运行。过点后打开本页会补跑；失败再用右边按钮。</p>
          </div>
        </div>
        <div class="row tight">
          <button class="btn" :disabled="busy" @click="startJob('update-data', dailyJobParams('update-data'))">更新行情</button>
          <button class="btn primary" :disabled="busy" @click="startJob('signal', dailyJobParams('signal'))">生成今日信号</button>
        </div>
      </div>

      <div class="callout">
        <p class="callout-title">换持仓</p>
        <p>到了评估日，且新标的明显强于当前最差持仓，才会换。</p>
        <p>旧仓未满最少持有天数时，通常不换。</p>
        <p>连续多天同一对 ETF 很正常。</p>
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

          <div v-if="displayScoreRows(strategy).length" class="scoreboard">
            <p class="factor-heading">评分前 {{ SCORE_TOP_N }}</p>
            <ol class="score-list">
              <li
                v-for="row in displayScoreRows(strategy)"
                :key="row.symbol"
                :class="{ held: isHolding(strategy, row.symbol) }"
              >
                <span class="rank">{{ row.rank }}</span>
                <strong class="symbol">{{ etfLabel(row.symbol) }}</strong>
                <span class="score">{{ row.score == null ? '—' : formatNum(row.score, 3) }}</span>
                <span v-if="isHolding(strategy, row.symbol)" class="held-tag">持仓</span>
              </li>
            </ol>
          </div>

          <div v-if="displayActions(strategy).length" class="signal-actions">
            <p class="factor-heading">今日持仓</p>
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
              <div class="hold-meta">
                <span v-if="item.score != null" class="score">评分 {{ formatNum(item.score, 3) }}</span>
                <span v-if="item.since_date" class="days">本轮 {{ formatDate(item.since_date) }}</span>
                <span v-if="item.hold_days != null" class="days">已持 {{ item.hold_days }} 天</span>
                <span
                  v-if="item.hold_return != null"
                  class="hold-pnl"
                  :class="metricTone(item.hold_return)"
                >{{ formatPct(item.hold_return) }}</span>
                <span v-else class="days">收益 —</span>
              </div>
            </div>
          </div>
          <p v-else class="empty">还没有持仓结论。</p>
          <p v-if="!displayActions(strategy).length" class="empty">请先点上方「生成今日信号」。</p>

          <div v-if="strategy.factors?.length" class="strategy-factors">
            <p class="factor-heading">锁定因子 · {{ strategy.factors.length }} 个</p>
            <div class="factor-row">
              <button
                v-for="f in strategy.factors"
                :key="f"
                type="button"
                class="factor-chip clickable"
                :class="{ active: detailOpen && detailFactorCode === f }"
                :title="f"
                @click="openFactorDetail(f)"
              >{{ factorText(f) }}</button>
            </div>
          </div>

          <p v-if="strategy.last_rebalance" class="meta-line">
            上次换仓参考日：{{ formatDate(strategy.last_rebalance) }}
          </p>
        </article>
      </div>
      <p v-else class="empty">暂无生产策略定义。</p>
    </section>

    <section class="card">
      <div class="section-head">
        <div>
          <h2>最近任务</h2>
          <div class="howto compact">
            <p>已完成的任务可点开查看结果。</p>
          </div>
        </div>
      </div>
      <ul v-if="recentJobs.length" class="jobs">
        <li
          v-for="j in recentJobs"
          :key="j.job_id"
          :class="{ clickable: j.status === 'succeeded', active: j.job_id === lastJobId }"
          @click="openJobResult(j)"
        >
          <span class="job-type">{{ jobTypeLabel(j.type) }}</span>
          <span :class="['st', j.status]">{{ jobStatusLabel(j.status) }}</span>
          <span class="job-progress">{{ Math.round(j.pct || 0) }}%</span>
          <span class="job-time">{{ formatJobTime(j) }}</span>
          <span class="job-msg">{{ jobMessage(j) }}</span>
        </li>
      </ul>
      <p v-else class="empty">还没有任务记录。</p>
    </section>

    <section class="card research-card">
      <div class="section-head">
        <div>
          <h2>研究重筛</h2>
          <div class="howto compact">
            <p>不常用。只在你想换因子配方时打开。</p>
            <p>日常信号不会自动换因子。</p>
            <p>只有你主动做完研究并重新封版，才会换因子配方。</p>
            <p>
              因子原理请打开
              <RouterLink class="inline-link" to="/factors">因子池</RouterLink>
              （只看不选）。
            </p>
            <p>手选因子在下面「筛选层」切换到手动模式。</p>
            <p>日常看持仓，请回到上方两步操作。</p>
          </div>
        </div>
        <button class="linkish" type="button" @click="showResearch = !showResearch">
          {{ showResearch ? '收起' : '展开' }}
        </button>
      </div>

      <div v-if="showResearch">
        <div class="research-warn howto compact">
          <p>研究进度 {{ researchProgress.done }}/{{ researchProgress.total }}（WFO · VEC · BT）。</p>
          <p>「一键全流程」会重跑整条研究链，耗时长。</p>
          <p>它不会自动改生产封版。</p>
        </div>

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
              <p class="pipe-note">
                {{ step.note }}
                <template v-if="step.pct && step.status === 'running'">
                  · {{ Math.round(step.pct) }}%
                </template>
              </p>

              <div v-if="step.id === 'wfo'" class="screen-panel">
                <div class="mode-toggle" role="group" aria-label="筛选方式">
                  <button
                    type="button"
                    class="mode-btn"
                    :class="{ active: researchMode === 'wfo' }"
                    :disabled="busy"
                    @click="researchMode = 'wfo'"
                  >
                    WFO 自动枚举
                  </button>
                  <button
                    type="button"
                    class="mode-btn"
                    :class="{ active: researchMode === 'manual' }"
                    :disabled="busy"
                    @click="researchMode = 'manual'"
                  >
                    手动选因子
                  </button>
                </div>

                <div v-if="researchMode === 'wfo'" class="howto compact mode-hint">
                  <p>自动扫公共池组合，产出候选后再进 VEC / BT。</p>
                </div>

                <div v-else class="manual-box">
                  <div class="manual-head">
                    <p :class="['manual-count', { ok: manualSelectOk }]">
                      已选 {{ selectedFactorCodes.length }} / 2–8
                    </p>
                    <button
                      type="button"
                      class="btn ghost sm"
                      :disabled="!selectedFactorCodes.length || busy"
                      @click="clearSelectedFactors"
                    >
                      清空
                    </button>
                  </div>
                  <div class="howto compact">
                    <p>点胶囊勾选。原理请到因子池查看。</p>
                  </div>
                  <div v-if="factorPool.length" class="factor-groups compact">
                    <div>
                      <h3>行情类</h3>
                      <div class="factor-row">
                        <button
                          v-for="f in ohlcvFactors"
                          :key="f.code"
                          type="button"
                          class="factor-chip"
                          :class="{ selected: isFactorSelected(f.code) }"
                          :title="f.code"
                          :disabled="busy"
                          @click="toggleFactor(f.code)"
                        >
                          {{ f.label }}
                        </button>
                      </div>
                    </div>
                    <div>
                      <h3>份额 / 融资</h3>
                      <div class="factor-row">
                        <button
                          v-for="f in altFactors"
                          :key="f.code"
                          type="button"
                          class="factor-chip alt"
                          :class="{ selected: isFactorSelected(f.code) }"
                          :title="f.code"
                          :disabled="busy"
                          @click="toggleFactor(f.code)"
                        >
                          {{ f.label }}
                        </button>
                      </div>
                    </div>
                  </div>
                  <p v-else class="empty sm">暂无因子列表，请先刷新或确认 strategy-api。</p>
                </div>
              </div>

              <div class="pipe-actions">
                <button class="btn sm" :disabled="busy || researchStepDisabled(step.id)" @click="runResearchStep(step.id)">
                  {{ researchStepButtonLabel(step.id) }}
                </button>
              </div>
            </div>
          </li>
        </ol>

        <div class="research-foot">
          <div class="seal-box">
            <div class="seal-copy">
              <strong>研究通过后 · 封版到生产</strong>
              <p v-if="researchCandidate" class="seal-candidate">
                候选：{{ researchCandidate.factors.map((f) => factorText(f)).join(' + ') }}
              </p>
              <p v-else class="seal-candidate muted">
                暂无内存结果；点击后会尝试读取最近成功的 BT/VEC 任务。
              </p>
              <div class="howto compact">
                <p>只替换主策略封版因子，不换仓、不自动跑信号。</p>
                <p>封版后如需新持仓，请回到上方点「生成今日信号」。</p>
              </div>
            </div>
            <button
              class="btn primary"
              type="button"
              :disabled="busy || publishBusy"
              @click="publishToProduction"
            >
              {{ publishBusy ? '封版中…' : '封版到生产' }}
            </button>
          </div>

          <p v-if="sealNotice" class="seal-ok">{{ sealNotice }}</p>

          <button
            class="btn ghost dangerish"
            :disabled="busy || publishBusy || researchMode === 'manual'"
            @click="startFullResearch"
          >
            一键全流程（研究用）
          </button>
          <div class="howto compact">
            <p v-if="researchMode === 'manual'">手动模式请逐层跑 VEC / BT。</p>
            <p v-else>顺序：数据 → WFO → VEC → BT → 信号。</p>
            <p>日常请勿使用。</p>
          </div>
        </div>

        <p v-if="lastJobId" class="hint last-job">最近任务编号：{{ lastJobId }}</p>
      </div>
    </section>

    <section v-if="parsedResult || resultLoading" class="card result-card">
      <div class="section-head">
        <div>
          <h2>{{ parsedResult?.title || '任务结果' }}</h2>
          <div class="howto compact">
            <p>回测是历史成绩，不是今天该买哪只。</p>
            <p v-if="resultJob">来源：{{ jobTypeLabel(resultJob.type) }} · {{ resultJob.job_id }}</p>
          </div>
        </div>
      </div>

      <p v-if="resultLoading" class="empty">正在读取结果…</p>

      <template v-else-if="parsedResult">
        <div v-if="parsedResult.metrics.length" class="metric-grid">
          <div
            v-for="m in parsedResult.metrics"
            :key="m.key"
            class="metric"
            :class="m.tone"
          >
            <span class="stat-label">{{ m.label }}</span>
            <strong>{{ m.text }}</strong>
          </div>
        </div>

        <p v-if="parsedResult.extra.length" class="result-extra">
          <span v-for="item in parsedResult.extra" :key="item.label">
            {{ item.label }} {{ item.text }}
          </span>
        </p>

        <div v-if="parsedResult.factors.length" class="strategy-factors">
          <p class="factor-heading">本次因子 · {{ parsedResult.factors.length }} 个</p>
          <div class="factor-row">
            <button
              v-for="f in parsedResult.factors"
              :key="f"
              type="button"
              class="factor-chip clickable"
              :class="{ active: detailOpen && detailFactorCode === f }"
              :title="f"
              @click="openFactorDetail(f)"
            >{{ factorText(f) }}</button>
          </div>
        </div>

        <div v-if="equityChart" class="equity-box">
          <div class="equity-head">
            <p class="factor-heading">净值曲线</p>
            <p class="equity-range">
              {{ equityChart.start }} → {{ equityChart.end }}
              · {{ equityChart.startEquity }} → {{ equityChart.endEquity }}
            </p>
          </div>
          <svg
            class="equity-svg"
            :viewBox="`0 0 ${equityChart.w} ${equityChart.h}`"
            preserveAspectRatio="none"
            role="img"
            aria-label="回测净值曲线"
          >
            <path :d="equityChart.area" :class="['equity-area', equityChart.up ? 'up' : 'down']" />
            <path :d="equityChart.line" :class="['equity-line', equityChart.up ? 'up' : 'down']" />
          </svg>
        </div>

        <div v-if="parsedResult.combos.length" class="combo-box">
          <p class="factor-heading">{{ parsedResult.comboCaption || '候选组合' }}</p>
          <div class="combo-table-wrap">
            <table class="combo-table">
              <thead>
                <tr>
                  <th>因子</th>
                  <th>收益</th>
                  <th>夏普</th>
                  <th>回撤</th>
                  <th>其它</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in parsedResult.combos" :key="row.key">
                  <td>{{ comboFactorsText(row.factors) }}</td>
                  <td :class="metricTone(row.totalReturn ?? row.trainReturn)">
                    {{ formatPct(row.totalReturn ?? row.trainReturn) }}
                  </td>
                  <td :class="metricTone(row.sharpe)">{{ formatNum(row.sharpe) }}</td>
                  <td :class="metricTone(row.maxDrawdown, true)">{{ formatPct(row.maxDrawdown) }}</td>
                  <td>
                    <template v-if="row.score != null">分 {{ formatNum(row.score, 3) }}</template>
                    <template v-else-if="row.ic != null">IC {{ formatNum(row.ic, 3) }}</template>
                    <template v-else-if="row.trades != null">{{ formatInt(row.trades) }} 笔</template>
                    <template v-else>—</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p v-if="parsedResult.kind === 'signal'" class="hint">
          持仓结论在上方「今日操作」。这里只确认信号任务跑完了。
        </p>
      </template>
    </section>
    <div
      v-if="detailOpen && detailFactor"
      ref="modalRootRef"
      class="modal-root"
      role="dialog"
      aria-modal="true"
      :aria-label="detailFactor.label"
      tabindex="-1"
      @keydown.esc.prevent="closeFactorDetail"
    >
      <div class="modal-mask" @click="closeFactorDetail" />
      <div class="modal-panel" @click.stop>
        <div class="detail-head">
          <div>
            <p class="detail-kicker">因子详情</p>
            <h2>{{ detailFactor.label }}</h2>
            <code class="detail-code">{{ detailFactor.code }}</code>
          </div>
          <button type="button" class="btn ghost sm" @click="closeFactorDetail">关闭</button>
        </div>
        <dl class="meta-grid">
          <div>
            <dt>分组</dt>
            <dd>{{ detailFactor.group || '—' }}</dd>
          </div>
          <div>
            <dt>分桶</dt>
            <dd>{{ detailFactor.bucket_label || detailFactor.bucket || '未分桶' }}</dd>
          </div>
          <div>
            <dt>方向</dt>
            <dd>{{ detailFactor.direction || '—' }}</dd>
          </div>
          <div>
            <dt>数据源</dt>
            <dd>{{ detailFactor.source || '—' }}</dd>
          </div>
        </dl>
        <p v-if="detailFactor.direction_note" class="note">{{ detailFactor.direction_note }}</p>
        <p
          v-if="detailFactor.summary && detailFactor.summary !== detailFactor.principle"
          class="summary"
        >{{ detailFactor.summary }}</p>
        <div class="principle-box">
          <h3>原理</h3>
          <p>{{ detailFactor.principle || '暂无原理说明。' }}</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn primary sm" @click="closeFactorDetail">知道了</button>
        </div>
      </div>
    </div>
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
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.date-pager {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.pager-idx {
  font-size: 0.75rem;
  color: rgba(232, 234, 237, 0.55);
}
.howto {
  margin: 10px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 40rem;
}
.howto p {
  margin: 0;
  color: rgba(232, 234, 237, 0.72);
  font-size: 0.92rem;
  line-height: 1.45;
}
.howto.compact {
  margin-top: 8px;
  max-width: 36rem;
}
.howto.compact p {
  font-size: 0.86rem;
  color: rgba(232, 234, 237, 0.62);
}
.howto .inline-link {
  color: #82b1ff;
  text-decoration: none;
  font-weight: 700;
}
.howto .inline-link:hover {
  text-decoration: underline;
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
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.callout p {
  margin: 0;
  color: rgba(232, 234, 237, 0.82);
  font-size: 0.88rem;
  line-height: 1.45;
}
.callout-title {
  color: #fff !important;
  font-weight: 700;
}
.callout-title.spaced {
  margin-top: 8px !important;
}
.research-warn {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 171, 64, 0.1);
  border: 1px solid rgba(255, 171, 64, 0.22);
}
.research-warn p {
  color: rgba(255, 224, 178, 0.95) !important;
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
.seal-box {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(105, 240, 174, 0.08);
  border: 1px solid rgba(105, 240, 174, 0.22);
}
.seal-copy {
  flex: 1 1 240px;
  min-width: 0;
}
.seal-copy strong {
  display: block;
  margin-bottom: 6px;
  color: #b9f6ca;
}
.seal-candidate {
  margin: 0 0 8px;
  font-size: 0.9rem;
  color: rgba(232, 234, 237, 0.92);
  word-break: break-word;
}
.seal-candidate.muted {
  color: rgba(232, 234, 237, 0.55);
}
.seal-ok {
  margin: 0;
  color: #69f0ae;
  font-size: 0.9rem;
  line-height: 1.45;
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
.screen-panel {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.14);
}
.mode-toggle {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.mode-btn {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(232, 234, 237, 0.78);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.mode-btn.active {
  color: #0b1210;
  background: #69f0ae;
  border-color: #69f0ae;
}
.mode-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.mode-hint {
  margin: 0;
}
.manual-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.manual-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.manual-count {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: rgba(232, 234, 237, 0.72);
}
.manual-count.ok {
  color: #69f0ae;
}
.factor-groups.compact {
  gap: 12px;
}
.factor-groups.compact h3 {
  margin: 0 0 6px;
  font-size: 0.78rem;
  color: rgba(232, 234, 237, 0.55);
  font-weight: 600;
}
button.factor-chip {
  cursor: pointer;
  padding: 6px 12px;
  font-size: 0.8rem;
}
button.factor-chip:hover:not(:disabled) {
  filter: brightness(1.08);
}
button.factor-chip.selected {
  color: #0b1210;
  background: #69f0ae;
  border-color: #69f0ae;
  font-weight: 700;
}
button.factor-chip.alt.selected {
  color: #0b1210;
  background: #ffd54f;
  border-color: #ffd54f;
}
button.factor-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.empty.sm {
  margin: 0;
  font-size: 0.8rem;
}
.last-job {
  margin-top: 4px;
}
.signal-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  width: 100%;
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
  width: 100%;
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
button.factor-chip.clickable {
  cursor: pointer;
  font: inherit;
}
button.factor-chip.clickable:hover {
  filter: brightness(1.08);
}
button.factor-chip.clickable.active {
  box-shadow: 0 0 0 1px rgba(105, 240, 174, 0.45);
  border-color: rgba(105, 240, 174, 0.55);
}
.factor-chip.alt {
  color: #ffd54f;
  background: rgba(255, 213, 79, 0.1);
  border-color: rgba(255, 213, 79, 0.22);
}
.modal-root {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  outline: none;
}
.modal-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
}
.modal-panel {
  position: relative;
  z-index: 1;
  width: min(520px, 100%);
  max-height: min(80vh, 720px);
  overflow: auto;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #151a24;
  padding: 18px 18px 16px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.detail-kicker {
  margin: 0 0 4px;
  color: rgba(232, 234, 237, 0.5);
  font-size: 0.75rem;
  font-weight: 700;
}
.detail-head h2 {
  margin: 0 0 4px;
  font-size: 1.2rem;
}
.detail-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  color: rgba(232, 234, 237, 0.55);
}
.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 0 0 12px;
}
.meta-grid dt {
  margin: 0;
  color: rgba(232, 234, 237, 0.48);
  font-size: 0.75rem;
}
.meta-grid dd {
  margin: 2px 0 0;
  font-size: 0.9rem;
  font-weight: 600;
}
.note,
.summary {
  margin: 0 0 10px;
  color: rgba(232, 234, 237, 0.62);
  font-size: 0.86rem;
  line-height: 1.5;
}
.principle-box {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(130, 177, 255, 0.08);
  border: 1px solid rgba(130, 177, 255, 0.16);
}
.principle-box h3 {
  margin: 0 0 8px;
  font-size: 0.82rem;
  color: rgba(232, 234, 237, 0.7);
}
.principle-box p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: rgba(232, 234, 237, 0.9);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
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
.hold-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  white-space: nowrap;
}
.hold-pnl {
  font-size: 0.82rem;
  font-weight: 700;
}
.hold-meta .score {
  font-size: 0.82rem;
  font-weight: 700;
  color: #90caf9;
}
.scoreboard {
  margin: 8px 0 12px;
}
.score-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.score-list li {
  display: grid;
  grid-template-columns: 28px 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
.score-list li.held {
  background: rgba(105, 240, 174, 0.08);
}
.score-list .rank {
  font-variant-numeric: tabular-nums;
  color: rgba(232, 234, 237, 0.45);
  font-size: 0.78rem;
}
.score-list .score {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #90caf9;
  font-size: 0.86rem;
}
.held-tag {
  font-size: 0.7rem;
  font-weight: 700;
  color: #69f0ae;
}
.hold-pnl.pos {
  color: #69f0ae;
}
.hold-pnl.neg {
  color: #ff8a80;
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
  grid-template-columns: minmax(120px, 1.1fr) 72px 40px minmax(132px, 0.9fr) 1.4fr;
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
.job-time {
  color: rgba(232, 234, 237, 0.58);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
.result-card {
  border-color: rgba(130, 177, 255, 0.28);
  box-shadow: 0 0 0 1px rgba(130, 177, 255, 0.06) inset;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.metric {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
}
.metric strong {
  display: block;
  margin-top: 4px;
  font-size: 1.12rem;
}
.metric.pos strong,
td.pos {
  color: #69f0ae;
}
.metric.neg strong,
td.neg {
  color: #ff8a80;
}
.result-extra {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 0 0 12px;
  color: rgba(232, 234, 237, 0.62);
  font-size: 0.8rem;
}
.equity-box {
  margin: 4px 0 14px;
}
.equity-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: baseline;
}
.equity-range {
  margin: 0;
  color: rgba(232, 234, 237, 0.5);
  font-size: 0.78rem;
}
.equity-svg {
  width: 100%;
  height: 168px;
  display: block;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
}
.equity-area.up {
  fill: rgba(105, 240, 174, 0.14);
}
.equity-area.down {
  fill: rgba(255, 138, 128, 0.14);
}
.equity-line {
  fill: none;
  stroke-width: 2;
}
.equity-line.up {
  stroke: #69f0ae;
}
.equity-line.down {
  stroke: #ff8a80;
}
.combo-box {
  margin-top: 4px;
}
.combo-table-wrap {
  overflow-x: auto;
}
.combo-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.combo-table th,
.combo-table td {
  text-align: left;
  padding: 8px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  vertical-align: top;
}
.combo-table th {
  color: rgba(232, 234, 237, 0.5);
  font-weight: 600;
  font-size: 0.75rem;
}
.combo-table td:first-child {
  min-width: 180px;
}
.jobs li.clickable {
  cursor: pointer;
}
.jobs li.clickable:hover {
  background: rgba(255, 255, 255, 0.06);
}
.jobs li.active {
  outline: 1px solid rgba(130, 177, 255, 0.35);
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
  .job-time,
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
