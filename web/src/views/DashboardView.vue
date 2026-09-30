<script setup lang="ts">
import { ref } from "vue";

const refreshedAt = ref("刚刚");
const refreshing = ref(false);
const notice = ref("");

const equity = "0,150 42,143 84,146 126,126 168,132 210,108 252,114 294,82 336,91 378,58 420,66 462,36 504,47 546,22 600,30";
const factors = [
  { name: "Alpha001", ic: "0.045", ir: "0.82", direction: "正向" },
  { name: "Mom_20", ic: "0.038", ir: "0.71", direction: "正向" },
  { name: "Vol_Std", ic: "-0.031", ir: "0.58", direction: "反向" },
];
const backtests = [
  { name: "双均线 v3", state: "已完成", return: "+23.5%", time: "今天 10:06" },
  { name: "因子轮动 v2", state: "已完成", return: "+15.2%", time: "昨天 18:42" },
  { name: "动量突破 v1", state: "运行中", return: "计算中", time: "2 分钟前" },
];
const alerts = [
  { level: "高", title: "策略A 回撤接近阈值", detail: "当前 -7.8% / 阈值 -8.0%", time: "10:18" },
  { level: "中", title: "策略B 持仓集中度偏高", detail: "单行业占比 36.2%", time: "09:56" },
];

async function refresh() {
  refreshing.value = true;
  notice.value = "";
  await new Promise((resolve) => setTimeout(resolve, 350));
  refreshedAt.value = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  refreshing.value = false;
}
</script>

<template>
  <section class="dashboard-page">
    <header class="page-header">
      <div><h1>仪表盘</h1><p>策略、因子、回测与风险状态总览</p></div>
      <div class="page-actions"><span class="snapshot-label">演示数据 · {{ refreshedAt }}</span><button class="button ghost" :disabled="refreshing" @click="refresh">{{ refreshing ? "刷新中…" : "刷新" }}</button><button class="button primary" @click="notice = '策略工作台将在本页确认后开始实现'">＋ 新建策略</button></div>
    </header>
    <p v-if="notice" class="page-notice">{{ notice }}</p>

    <div class="kpi-grid">
      <article class="kpi-card"><div class="kpi-icon green">▶</div><div><span>运行策略</span><strong>12</strong><small class="positive">较昨日 +2</small></div></article>
      <article class="kpi-card"><div class="kpi-icon blue">⌁</div><div><span>今日信号</span><strong>36</strong><small>买入 21 · 卖出 15</small></div></article>
      <article class="kpi-card"><div class="kpi-icon violet">↗</div><div><span>回测任务</span><strong>8</strong><small>1 个正在运行</small></div></article>
      <article class="kpi-card"><div class="kpi-icon amber">ƒ</div><div><span>因子总数</span><strong>245</strong><small class="positive">本周新增 8</small></div></article>
    </div>

    <div class="dashboard-grid dashboard-grid--top">
      <article class="panel equity-panel">
        <div class="panel-heading"><div><span class="panel-kicker">PORTFOLIO</span><h2>策略权益曲线概览</h2></div><div class="legend"><i></i>组合净值 <strong>+18.6%</strong></div></div>
        <div class="chart-wrap">
          <div class="chart-axis"><span>1.25</span><span>1.15</span><span>1.05</span><span>0.95</span></div>
          <svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-label="策略权益曲线">
            <defs><linearGradient id="equityArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#39d6a0" stop-opacity=".28"/><stop offset="1" stop-color="#39d6a0" stop-opacity="0"/></linearGradient></defs>
            <line v-for="y in [30,70,110,150]" :key="y" x1="0" :y1="y" x2="600" :y2="y" class="grid-line" />
            <polygon :points="equity + ' 600,180 0,180'" fill="url(#equityArea)" />
            <polyline :points="equity" fill="none" stroke="#39d6a0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div class="chart-dates"><span>09/01</span><span>09/08</span><span>09/15</span><span>09/22</span><span>今天</span></div>
        </div>
      </article>

      <article class="panel alert-panel">
        <div class="panel-heading"><div><span class="panel-kicker danger-text">RISK</span><h2>实时风控告警</h2></div><button class="text-button">全部告警 →</button></div>
        <div class="alert-list">
          <div v-for="alert in alerts" :key="alert.title" class="alert-item"><span class="alert-level">{{ alert.level }}</span><div><strong>{{ alert.title }}</strong><p>{{ alert.detail }}</p></div><time>{{ alert.time }}</time></div>
        </div>
        <div class="risk-summary"><span><i class="safe-dot"></i>风控引擎正常</span><small>最后检查 12 秒前</small></div>
      </article>
    </div>

    <div class="dashboard-grid dashboard-grid--bottom">
      <article class="panel table-panel">
        <div class="panel-heading"><div><span class="panel-kicker">BACKTEST</span><h2>最近回测任务</h2></div><button class="text-button">查看全部 →</button></div>
        <div class="data-table">
          <div class="table-row table-head"><span>策略名</span><span>状态</span><span>收益</span><span>时间</span></div>
          <div v-for="row in backtests" :key="row.name" class="table-row"><strong>{{ row.name }}</strong><span><i class="status-dot" :class="{ running: row.state === '运行中' }"></i>{{ row.state }}</span><b :class="{ positive: row.return.startsWith('+') }">{{ row.return }}</b><time>{{ row.time }}</time></div>
        </div>
      </article>

      <article class="panel factor-panel">
        <div class="panel-heading"><div><span class="panel-kicker">FACTOR LAB</span><h2>因子 IC 排行</h2></div><button class="text-button">因子库 →</button></div>
        <div class="factor-list">
          <div v-for="(factor, index) in factors" :key="factor.name" class="factor-row"><span class="rank">0{{ index + 1 }}</span><div><strong>{{ factor.name }}</strong><small>IR {{ factor.ir }} · {{ factor.direction }}</small></div><b :class="factor.ic.startsWith('-') ? 'negative' : 'positive'">{{ factor.ic }}</b><div class="ic-bar"><i :style="{ width: Math.abs(Number(factor.ic)) * 1200 + '%' }"></i></div></div>
        </div>
      </article>
    </div>
  </section>
</template>
