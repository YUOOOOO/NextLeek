<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { createChart } from 'lightweight-charts'

const chartRef = ref<HTMLElement>()

const stock = {
  name: '贵州茅台', code: '600519', change: '+1.56%', up: true,
  price: '1,856.00', open: '1,832.50', close: '1,827.36',
  high: '1,862.00', low: '1,825.00', volume: '3.2万手',
}

onMounted(() => {
  if (!chartRef.value) return
  const chart = createChart(chartRef.value, {
    width: chartRef.value.clientWidth,
    height: 360,
    layout: { background: { color: '#1a2536' }, textColor: '#aaa' },
    grid: { vertLines: { color: '#2a3a4e' }, horzLines: { color: '#2a3a4e' } },
  })
  const series = chart.addCandlestickSeries({
    upColor: '#ef5350', downColor: '#26a69a',
    wickUpColor: '#ef5350', wickDownColor: '#26a69a',
    borderVisible: false,
  })
  series.setData([
    { time: '2024-01-02', open: 1820, high: 1845, low: 1810, close: 1835 },
    { time: '2024-01-03', open: 1835, high: 1860, low: 1830, close: 1850 },
    { time: '2024-01-04', open: 1850, high: 1855, low: 1825, close: 1830 },
    { time: '2024-01-05', open: 1830, high: 1870, low: 1828, close: 1865 },
    { time: '2024-01-08', open: 1865, high: 1880, low: 1850, close: 1856 },
  ])
  new ResizeObserver(() => chart.applyOptions({ width: chartRef.value!.clientWidth })).observe(chartRef.value)
})
</script>

<template>
  <section class="panel-center">
    <div class="stock-header">
      <div>
        <span class="stock-name">{{ stock.name }}</span>
        <span class="stock-code">{{ stock.code }}</span>
      </div>
      <span :class="['stock-change', stock.up ? 'up' : 'down']">{{ stock.price }} {{ stock.change }}</span>
    </div>
    <div class="stock-meta">
      <span>今开 {{ stock.open }}</span><span>昨收 {{ stock.close }}</span>
      <span>最高 {{ stock.high }}</span><span>最低 {{ stock.low }}</span>
      <span>成交量 {{ stock.volume }}</span>
    </div>
    <div ref="chartRef" class="chart-container"></div>
  </section>
</template>

<style scoped>
.panel-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.stock-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #1a2536;
  border: 1px solid #2a3a4e;
  border-radius: 8px;
  padding: 0.6rem 1rem;
}
.stock-name { font-size: 1.1em; font-weight: 600; margin-right: 0.5em; }
.stock-code { font-size: 0.8em; color: rgba(255,255,255,0.4); }
.stock-change { font-size: 1em; font-weight: 600; }
.up { color: #ef5350; }
.down { color: #26a69a; }
.stock-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75em;
  color: rgba(255,255,255,0.5);
  padding: 0 0.3rem;
}
.chart-container {
  flex: 1;
  min-height: 300px;
  border: 1px solid #2a3a4e;
  border-radius: 8px;
  overflow: hidden;
}

@media (max-width: 768px) {
  .panel-center { min-width: 100%; }
  .stock-meta { flex-wrap: wrap; gap: 0.5rem; }
}
</style>
