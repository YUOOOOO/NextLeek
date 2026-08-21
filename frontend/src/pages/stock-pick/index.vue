<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const API = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

type FactorInfo = {
  code: string
  label: string
  group?: string
}

type Universe = {
  active_factors?: string[]
  factor_catalog?: FactorInfo[]
  factor_count?: number
}

type MockRow = {
  code: string
  name: string
  changePct: number
  price: number
}

type StrategyDef = {
  id: string
  name: string
  factorCodes: string[]
  rows: MockRow[]
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

/** 临时映射：流程走通用，对标 i.gushi.in 前可整表替换 */
const STRATEGY_DEFS: StrategyDef[] = [
  {
    id: 'auction-long',
    name: '竞价多头策略',
    factorCodes: ['MOM_20D', 'BREAKOUT_20D', 'PV_CORR_20D'],
    rows: [
      { code: '600519', name: '贵州茅台', changePct: 1.26, price: 1688.0 },
      { code: '300750', name: '宁德时代', changePct: 2.41, price: 198.5 },
      { code: '601318', name: '中国平安', changePct: -0.52, price: 48.2 },
    ],
  },
  {
    id: 'premarket-strong',
    name: '盘前强势量化',
    factorCodes: ['PRICE_POSITION_20D', 'VOL_RATIO_20D', 'OBV_SLOPE_10D'],
    rows: [
      { code: '002594', name: '比亚迪', changePct: 3.12, price: 265.4 },
      { code: '000858', name: '五粮液', changePct: 0.88, price: 142.3 },
    ],
  },
  {
    id: 'morning-star',
    name: '晨星量化',
    factorCodes: ['SHARPE_RATIO_20D', 'CALMAR_RATIO_60D', 'MAX_DD_60D'],
    rows: [
      { code: '600036', name: '招商银行', changePct: 0.35, price: 34.6 },
      { code: '601012', name: '隆基绿能', changePct: -1.2, price: 18.9 },
      { code: '002475', name: '立讯精密', changePct: 1.05, price: 32.1 },
    ],
  },
  {
    id: 'auction-alpha',
    name: '竞价阿尔法',
    factorCodes: ['SLOPE_20D', 'UP_DOWN_VOL_RATIO_20D', 'VORTEX_14D'],
    rows: [
      { code: '688981', name: '中芯国际', changePct: 2.08, price: 52.7 },
      { code: '603259', name: '药明康德', changePct: -0.74, price: 61.3 },
    ],
  },
  {
    id: 'open-star',
    name: '早盘之星',
    factorCodes: ['MOM_20D', 'PRICE_POSITION_20D', 'BREAKOUT_20D'],
    rows: [
      { code: '000063', name: '中兴通讯', changePct: 4.55, price: 31.2 },
      { code: '002230', name: '科大讯飞', changePct: 1.67, price: 48.9 },
      { code: '300059', name: '东方财富', changePct: 0.92, price: 16.4 },
    ],
  },
  {
    id: 't1-flash',
    name: 'T+1闪电',
    factorCodes: ['MOM_20D', 'VOL_RATIO_20D', 'PV_CORR_20D'],
    rows: [
      { code: '601899', name: '紫金矿业', changePct: 2.33, price: 17.8 },
      { code: '600276', name: '恒瑞医药', changePct: -0.41, price: 44.5 },
    ],
  },
  {
    id: 'gold-1430',
    name: '金色2点半',
    factorCodes: ['PRICE_POSITION_120D', 'SLOPE_20D', 'SHARPE_RATIO_20D'],
    rows: [
      { code: '600900', name: '长江电力', changePct: 0.21, price: 28.4 },
      { code: '601088', name: '中国神华', changePct: 0.67, price: 39.1 },
      { code: '600028', name: '中国石化', changePct: -0.18, price: 6.52 },
    ],
  },
  {
    id: 'large-cap',
    name: '大市值',
    factorCodes: ['AMIHUD_ILLIQUIDITY', 'CORRELATION_TO_MARKET_20D', 'MAX_DD_60D'],
    rows: [
      { code: '601398', name: '工商银行', changePct: 0.12, price: 5.81 },
      { code: '601857', name: '中国石油', changePct: 0.45, price: 9.12 },
      { code: '600000', name: '浦发银行', changePct: -0.33, price: 8.76 },
      { code: '601166', name: '兴业银行', changePct: 0.28, price: 17.3 },
    ],
  },
]

const TABS = [
  { id: 'strategy', label: '策略显示' },
  { id: 'resonance', label: '共振选股' },
  { id: 'assist', label: '帮我选股' },
  { id: 'market', label: '行情分析' },
] as const

type TabId = (typeof TABS)[number]['id']

const activeTab = ref<TabId>('strategy')
const selectedStrategyId = ref(STRATEGY_DEFS[0].id)
const universe = ref<Universe | null>(null)
const error = ref('')

// 当前选中的策略定义（含临时因子与 mock 结果）
const selectedStrategy = computed(
  () => STRATEGY_DEFS.find((s) => s.id === selectedStrategyId.value) || STRATEGY_DEFS[0],
)

// 合并接口目录与本地兜底，得到因子 code→中文名
const labelByCode = computed(() => {
  const map: Record<string, string> = { ...FACTOR_LABEL }
  for (const item of universe.value?.factor_catalog || []) {
    if (item?.code) map[item.code] = item.label || item.code
  }
  return map
})

// 当前策略绑定的因子 chip 数据
const boundFactors = computed(() => {
  const labels = labelByCode.value
  return selectedStrategy.value.factorCodes.map((code) => ({
    code,
    label: labels[code] || code,
  }))
})

// 当前策略对应的 mock 选股结果行
const resultRows = computed(() => selectedStrategy.value.rows)

// 请求 BFF JSON 接口
async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// 拉取因子池宇宙，失败时保留本地标签兜底
async function refreshUniverse() {
  error.value = ''
  try {
    universe.value = await api<Universe>('/api/strategy/universe')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

// 切换策略按钮选中项
function selectStrategy(id: string) {
  selectedStrategyId.value = id
}

// 涨跌幅格式化为带符号百分比
function formatPct(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

// 现价格式化为两位小数
function formatPrice(v: number): string {
  return v.toFixed(2)
}

onMounted(() => {
  void refreshUniverse()
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
      <div class="strategy-row">
        <button
          v-for="s in STRATEGY_DEFS"
          :key="s.id"
          type="button"
          class="strategy-btn"
          :class="{ active: selectedStrategyId === s.id }"
          @click="selectStrategy(s.id)"
        >
          {{ s.name }}
        </button>
      </div>

      <div class="factor-block">
        <div class="block-label">当前策略绑定因子</div>
        <div v-if="boundFactors.length" class="factor-row">
          <span v-for="f in boundFactors" :key="f.code" class="factor-chip" :title="f.code">
            {{ f.label }}
          </span>
        </div>
        <p v-else class="muted">尚未绑定因子</p>
        <p v-if="error" class="hint">因子池接口暂不可用（{{ error }}），已用本地标签兜底。</p>
      </div>

      <div class="table-card">
        <table class="result-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>涨跌幅</th>
              <th>现价</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in resultRows" :key="row.code">
              <td class="mono">{{ row.code }}</td>
              <td>{{ row.name }}</td>
              <td :class="{ up: row.changePct > 0, down: row.changePct < 0 }">
                {{ formatPct(row.changePct) }}
              </td>
              <td class="mono">{{ formatPrice(row.price) }}</td>
            </tr>
            <tr v-if="!resultRows.length">
              <td colspan="4" class="empty">暂无符合条件的标的</td>
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
