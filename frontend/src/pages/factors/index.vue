<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

const API = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000'

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
  active_factors?: string[]
  factor_catalog?: FactorInfo[]
  factor_count?: number
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

const universe = ref<Universe | null>(null)
const error = ref('')
const busy = ref(false)
const detailFactorCode = ref<string | null>(null)
const detailOpen = ref(false)
const modalRootRef = ref<HTMLElement | null>(null)

const factorPool = computed((): FactorInfo[] => {
  const catalog = universe.value?.factor_catalog
  if (catalog?.length) {
    return catalog.map((item) => ({
      ...item,
      label: item.label || factorText(item.code),
      group: item.group || (OHLCV_FACTORS.has(item.code) ? '行情类' : '份额/融资类'),
      principle: item.principle || FACTOR_PRINCIPLE[item.code] || item.summary || '',
    }))
  }
  const codes = universe.value?.active_factors || Object.keys(FACTOR_LABEL)
  return codes.map((code) => ({
    code,
    label: factorText(code),
    group: OHLCV_FACTORS.has(code) ? '行情类' : '份额/融资类',
    principle: FACTOR_PRINCIPLE[code] || '',
    direction_note: '',
    bucket_label: '',
    summary: factorText(code),
  }))
})

const ohlcvFactors = computed(() => factorPool.value.filter((f) => f.group === '行情类'))
const altFactors = computed(() => factorPool.value.filter((f) => f.group !== '行情类'))
const factorCount = computed(
  () => universe.value?.factor_count ?? factorPool.value.length,
)

const detailFactor = computed(() => {
  const code = detailFactorCode.value
  if (!code) return null
  return factorPool.value.find((f) => f.code === code) || null
})

function factorText(code: string): string {
  return FACTOR_LABEL[code] || code
}

function setBodyScrollLocked(locked: boolean) {
  document.body.style.overflow = locked ? 'hidden' : ''
}

/** 点击胶囊：只打开原理弹窗 */
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

async function refresh() {
  error.value = ''
  busy.value = true
  try {
    universe.value = await api<Universe>('/api/strategy/universe')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  refresh()
})

onUnmounted(() => {
  setBodyScrollLocked(false)
})
</script>

<template>
  <div class="page">
    <header class="head">
      <div class="head-copy">
        <p class="eyebrow">研究目录</p>
        <h1>公共因子池 · {{ factorCount || 0 }}</h1>
        <div class="howto compact">
          <p>这里只查看因子含义与原理，不做研究勾选。</p>
          <p>
            手选因子 / WFO 请到
            <RouterLink class="inline-link" to="/rotation">轮动</RouterLink>
            页「研究重筛 → 筛选层」。
          </p>
        </div>
      </div>
      <button class="btn ghost" type="button" :disabled="busy" @click="refresh()">刷新</button>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="card list-card">
      <div v-if="factorPool.length" class="factor-groups">
        <div>
          <h2>行情类 · {{ ohlcvFactors.length }}</h2>
          <div class="factor-row">
            <button
              v-for="f in ohlcvFactors"
              :key="f.code"
              type="button"
              class="factor-chip"
              :class="{ active: detailOpen && detailFactorCode === f.code }"
              :title="f.code"
              @click="openFactorDetail(f.code)"
            >
              <span class="chip-label">{{ f.label }}</span>
            </button>
          </div>
        </div>
        <div>
          <h2>份额 / 融资类 · {{ altFactors.length }}</h2>
          <div class="factor-row">
            <button
              v-for="f in altFactors"
              :key="f.code"
              type="button"
              class="factor-chip alt"
              :class="{ active: detailOpen && detailFactorCode === f.code }"
              :title="f.code"
              @click="openFactorDetail(f.code)"
            >
              <span class="chip-label">{{ f.label }}</span>
            </button>
          </div>
        </div>
      </div>
      <p v-else class="empty">暂无因子列表。请确认 strategy-api 已启动。</p>
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
        >
          {{ detailFactor.summary }}
        </p>
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
  padding: 18px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.head-copy {
  min-width: 0;
}
.eyebrow {
  margin: 0 0 4px;
  color: rgba(232, 234, 237, 0.5);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
h1 {
  margin: 0;
  font-size: 1.35rem;
  letter-spacing: -0.02em;
}
.howto {
  margin-top: 8px;
}
.howto.compact p {
  margin: 0;
  color: rgba(232, 234, 237, 0.58);
  font-size: 0.88rem;
  line-height: 1.45;
}
.howto.compact p + p {
  margin-top: 2px;
}
.inline-link {
  color: #82b1ff;
  text-decoration: none;
  font-weight: 700;
}
.inline-link:hover {
  text-decoration: underline;
}
.error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 138, 128, 0.12);
  color: #ff8a80;
  font-size: 0.9rem;
}
.card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 14px 16px;
}
.list-card h2 {
  margin: 0 0 10px;
  font-size: 0.98rem;
}
.factor-groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.factor-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.factor-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 7px 14px;
  border: 1px solid rgba(130, 177, 255, 0.18);
  background: rgba(130, 177, 255, 0.1);
  color: #82b1ff;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}
.factor-chip.alt {
  color: #ffd54f;
  background: rgba(255, 213, 79, 0.1);
  border-color: rgba(255, 213, 79, 0.22);
}
.factor-chip:hover {
  filter: brightness(1.08);
}
.factor-chip.active {
  box-shadow: 0 0 0 1px rgba(105, 240, 174, 0.45);
  border-color: rgba(105, 240, 174, 0.55);
}
.factor-chip .chip-label {
  line-height: 1.2;
  white-space: nowrap;
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
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.empty {
  margin: 0;
  color: rgba(232, 234, 237, 0.5);
  font-size: 0.9rem;
}
.btn {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #e8eaed;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn.sm {
  padding: 6px 10px;
  font-size: 0.82rem;
}
.btn.primary {
  background: #2f6fed;
  border-color: #2f6fed;
  font-weight: 700;
}
.btn.ghost {
  background: transparent;
}
</style>
