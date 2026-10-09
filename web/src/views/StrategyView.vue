<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";

type NodeParameter = { label: string; value: string; unit?: string };
type Block = { id: number; category: string; title: string; description: string; color: string; x: number; y: number; parameters: NodeParameter[] };
type Edge = { id: number; from: number; to: number };
type BacktestConfig = { capital: string; start: string; end: string; benchmark: string; fee: string; slippage: string; maxPosition: string; adjusted: boolean; riskControl: boolean; snapshots: boolean };
type Strategy = {
  name: string;
  type: string;
  status: "草稿" | "已启用";
  returnRate: string;
  updated: string;
  blocks: Block[];
  edges: Edge[];
  code: string;
  annualReturn: string;
  drawdown: string;
  sharpe: string;
  config: BacktestConfig;
};

const NODE_WIDTH = 320;
const NODE_HEIGHT = 74;
const SURFACE_WIDTH = 1600;
const SURFACE_HEIGHT = 1000;

const defaultConfig = (): BacktestConfig => ({ capital: "1,000,000", start: "2024-01-01", end: "2025-01-01", benchmark: "沪深 300", fee: "0.0003", slippage: "3", maxPosition: "80", adjusted: true, riskControl: true, snapshots: false });
const parameter = (label: string, value: string, unit = ""): NodeParameter => ({ label, value, unit });

const strategies = ref<Strategy[]>([
  {
    name: "双均线 v3", type: "趋势", status: "已启用", returnRate: "+23.5%", updated: "刚刚", annualReturn: "18.2%", drawdown: "-8.2%", sharpe: "1.61", config: defaultConfig(),
    blocks: [
      { id: 1, category: "行情输入", title: "沪深 300 日线", description: "OHLCV · 前复权", color: "blue", x: 70, y: 420, parameters: [parameter("标的", "沪深 300"), parameter("复权方式", "前复权")] },
      { id: 2, category: "信号计算", title: "双均线交叉", description: "MA5 上穿 MA20", color: "violet", x: 440, y: 420, parameters: [parameter("短周期", "5", "日"), parameter("长周期", "20", "日")] },
      { id: 3, category: "仓位控制", title: "目标仓位", description: "多头 80% · 现金 20%", color: "amber", x: 810, y: 230, parameters: [parameter("目标仓位", "80", "%")] },
      { id: 4, category: "风险控制", title: "回撤保护", description: "最大回撤 8%", color: "red", x: 810, y: 610, parameters: [parameter("最大回撤", "8", "%")] },
      { id: 5, category: "交易执行", title: "收盘价下单", description: "滑点 3bp · 费率 3bp", color: "green", x: 1180, y: 420, parameters: [parameter("滑点", "3", "bp"), parameter("手续费", "3", "bp")] },
    ],
    edges: [{ id: 101, from: 1, to: 2 }, { id: 102, from: 2, to: 3 }, { id: 103, from: 2, to: 4 }, { id: 104, from: 3, to: 5 }, { id: 105, from: 4, to: 5 }],
    code: "class DualMovingAverage(Strategy):\n    fast_period = 5\n    slow_period = 20\n\n    def on_bar(self, bar):\n        signal = cross(ma(5), ma(20))\n        self.target_position(0.80 if signal else 0)",
  },
  {
    name: "因子轮动 v2", type: "多因子", status: "已启用", returnRate: "+15.2%", updated: "昨天", annualReturn: "12.4%", drawdown: "-6.1%", sharpe: "1.38", config: { ...defaultConfig(), benchmark: "中证 500", maxPosition: "60" },
    blocks: [
      { id: 11, category: "因子输入", title: "质量与动量因子", description: "ROE · 12M 动量", color: "blue", x: 100, y: 300, parameters: [parameter("质量权重", "45", "%"), parameter("动量权重", "55", "%")] },
      { id: 12, category: "截面排序", title: "行业中性排名", description: "每行业选择前 3 名", color: "violet", x: 500, y: 300, parameters: [parameter("每组入选", "3", "只"), parameter("最小市值", "50", "亿元")] },
      { id: 13, category: "组合构建", title: "月度等权轮动", description: "每月首个交易日调仓", color: "amber", x: 900, y: 300, parameters: [parameter("调仓周期", "20", "日"), parameter("持仓上限", "12", "只")] },
      { id: 14, category: "交易执行", title: "VWAP 下单", description: "成交量参与率 10%", color: "green", x: 1280, y: 300, parameters: [parameter("参与率", "10", "%")] },
    ],
    edges: [{ id: 111, from: 11, to: 12 }, { id: 112, from: 12, to: 13 }, { id: 113, from: 13, to: 14 }],
    code: "class FactorRotation(Strategy):\n    factors = [roe(), momentum(252)]\n    rebalance = monthly(first_trading_day=True)\n\n    def select(self, universe):\n        return neutral_rank(universe, top_n=12)",
  },
  {
    name: "动量突破 v1", type: "动量", status: "草稿", returnRate: "+8.7%", updated: "3 天前", annualReturn: "7.1%", drawdown: "-11.6%", sharpe: "0.82", config: { ...defaultConfig(), benchmark: "中证 1000", maxPosition: "50" },
    blocks: [
      { id: 21, category: "行情输入", title: "中证 1000 成分股", description: "日线 · 最近 120 日", color: "blue", x: 100, y: 430, parameters: [parameter("回看窗口", "120", "日")] },
      { id: 22, category: "突破信号", title: "20 日新高", description: "收盘价突破滚动高点", color: "violet", x: 500, y: 430, parameters: [parameter("突破周期", "20", "日"), parameter("成交量倍数", "1.5", "倍")] },
      { id: 23, category: "止损", title: "ATR 移动止损", description: "3 倍 ATR 保护", color: "red", x: 900, y: 570, parameters: [parameter("ATR 周期", "14", "日"), parameter("止损倍数", "3", "倍")] },
      { id: 24, category: "交易执行", title: "次日开盘下单", description: "单票最大仓位 5%", color: "green", x: 1280, y: 430, parameters: [parameter("单票仓位", "5", "%")] },
    ],
    edges: [{ id: 121, from: 21, to: 22 }, { id: 122, from: 22, to: 23 }, { id: 123, from: 22, to: 24 }, { id: 124, from: 23, to: 24 }],
    code: "class MomentumBreakout(Strategy):\n    breakout_period = 20\n    atr_stop = 3\n\n    def on_bar(self, bar):\n        if bar.close >= highest(20):\n            self.enter_at_next_open(max_weight=0.05)",
  },
]);

type GraphRange = { start: number; end: number };
const graphRanges: GraphRange[] = [];
function graphSource(strategy: Strategy) {
  return `strategy_graph = ${JSON.stringify({ blocks: strategy.blocks, edges: strategy.edges }, null, 4)}`;
}
function initializeGraphSource(strategy: Strategy) {
  const start = strategy.code.length + 2;
  const source = graphSource(strategy);
  strategy.code += `\n\n${source}`;
  graphRanges.push({ start, end: start + source.length });
}
strategies.value.forEach(initializeGraphSource);

const selected = ref(0);
const activeTab = ref<"画布" | "代码" | "回测">("画布");
const saved = ref(true);
const running = ref(false);
const message = ref("");
const viewport = ref<HTMLElement | null>(null);
const zoom = ref(0.75);
const pan = ref({ x: 20, y: 20 });
const isPanning = ref(false);
const selectedBlockId = ref<number | null>(2);
const selectedEdgeId = ref<number | null>(null);
const menuBlockId = ref<number | null>(null);
const connectingFrom = ref<number | null>(null);
const connectionPointer = ref({ x: 0, y: 0 });
const editingBlock = ref<Block | null>(null);
const codeError = ref("");
const codePending = ref(false);
const validationMessage = ref("");
const codeScroll = ref(0);
const codeReady = computed(() => !codePending.value && !codeError.value);
let applyingCode = false;
let parseTimer: ReturnType<typeof setTimeout> | undefined;
let parseController: AbortController | undefined;

const current = computed(() => strategies.value[selected.value]);
const blocks = computed({ get: () => current.value.blocks, set: (value: Block[]) => { current.value.blocks = value; } });
const edges = computed({ get: () => current.value.edges, set: (value: Edge[]) => { current.value.edges = value; } });
const surfaceStyle = computed(() => ({ width: `${SURFACE_WIDTH}px`, height: `${SURFACE_HEIGHT}px`, '--canvas-zoom': zoom.value, transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})` }));
const codeLineNumbers = computed(() => current.value.code.split("\n").map((_, index) => String(index + 1).padStart(2, "0")).join("\n"));

watch(() => [current.value.blocks, current.value.edges], () => {
  if (applyingCode || !codeReady.value) return;
  const range = graphRanges[selected.value];
  const source = graphSource(current.value);
  current.value.code = current.value.code.slice(0, range.start) + source + current.value.code.slice(range.end);
  range.end = range.start + source.length;
}, { deep: true, flush: "sync" });

function updateCode(event: Event) {
  current.value.code = (event.target as HTMLTextAreaElement).value;
  markDirty();
  validationMessage.value = "";
  codePending.value = true;
  codeError.value = "";
  clearTimeout(parseTimer);
  parseController?.abort();
  parseTimer = setTimeout(() => validateCode(), 350);
}

async function validateCode(manual = false) {
    clearTimeout(parseTimer);
    parseController?.abort();
    codePending.value = true;
    codeError.value = "";
    validationMessage.value = "";
    const index = selected.value;
    const code = current.value.code;
    const controller = new AbortController();
    parseController = controller;
    try {
      const response = await fetch("/api/strategies/graph/parse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }), signal: controller.signal,
      });
      const result = await response.json();
      if (controller.signal.aborted || selected.value !== index || current.value.code !== code) return;
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "无法解析策略节点定义");
      applyingCode = true;
      try {
        current.value.blocks = result.blocks;
        current.value.edges = result.edges;
        graphRanges[index] = { start: result.start, end: result.end };
      } finally { applyingCode = false; }
      selectedBlockId.value = null;
      selectedEdgeId.value = null;
      menuBlockId.value = null;
      editingBlock.value = null;
      if (manual) validationMessage.value = "校验通过";
    } catch (error) {
      if (controller.signal.aborted || selected.value !== index || current.value.code !== code) return;
      codeError.value = error instanceof Error ? error.message : "解析服务不可用，请稍后重试";
    } finally {
      if (!controller.signal.aborted && selected.value === index && current.value.code === code) codePending.value = false;
    }
}

function indentCode(event: KeyboardEvent) {
  event.preventDefault();
  const editor = event.target as HTMLTextAreaElement;
  const start = editor.selectionStart;
  editor.setRangeText("    ", start, editor.selectionEnd, "end");
  updateCode(event);
}

function nextGraphId() {
  return Math.max(Date.now(), ...strategies.value.flatMap((strategy) => [...strategy.blocks, ...strategy.edges].map((item) => item.id + 1)));
}

function connectorPath(x1: number, y1: number, x2: number, y2: number) {
  const bend = Math.max(90, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

const edgePaths = computed(() => edges.value.flatMap((edge) => {
  const from = blocks.value.find((block) => block.id === edge.from);
  const to = blocks.value.find((block) => block.id === edge.to);
  if (!from || !to) return [];
  return [{ ...edge, d: connectorPath(from.x + NODE_WIDTH, from.y + NODE_HEIGHT / 2, to.x, to.y + NODE_HEIGHT / 2) }];
}));
const previewPath = computed(() => {
  if (connectingFrom.value === null) return "";
  const from = blocks.value.find((block) => block.id === connectingFrom.value);
  if (!from) return "";
  return connectorPath(from.x + NODE_WIDTH, from.y + NODE_HEIGHT / 2, connectionPointer.value.x, connectionPointer.value.y);
});

function markDirty() { saved.value = false; }
function saveStrategy(showMessage = true) {
  if (!codeReady.value) { message.value = "请先修正代码并等待画布同步完成"; return; }
  saved.value = true;
  current.value.updated = "刚刚";
  if (!showMessage) return;
  message.value = "策略配置已保存";
  window.setTimeout(() => (message.value = ""), 1800);
}
function confirmSaveBeforeLeaving() {
  if (saved.value) return true;
  if (!codeReady.value) { message.value = "请先修正代码并等待画布同步完成"; return false; }
  if (!window.confirm("当前策略有未保存修改。保存后继续吗？")) return false;
  saveStrategy(false);
  return true;
}
function resetCanvasSelection() {
  selectedBlockId.value = null;
  selectedEdgeId.value = null;
  menuBlockId.value = null;
  zoom.value = 0.75;
  pan.value = { x: 20, y: 20 };
}
function selectStrategy(index: number) {
  if (index === selected.value || !confirmSaveBeforeLeaving()) return;
  selected.value = index;
  saved.value = true;
  message.value = "";
  activeTab.value = "画布";
  resetCanvasSelection();
}
function createStrategy() {
  if (!confirmSaveBeforeLeaving()) return;
  const fallback = `未命名策略 ${strategies.value.length + 1}`;
  const name = window.prompt("请输入新策略名称", fallback)?.trim();
  if (!name) return;
  const seed = nextGraphId();
  strategies.value.push({
    name, type: "自定义", status: "草稿", returnRate: "--", updated: "未保存", annualReturn: "--", drawdown: "--", sharpe: "--", config: defaultConfig(),
    blocks: [
      { id: seed, category: "行情输入", title: "选择行情数据", description: "配置策略的数据来源", color: "blue", x: 220, y: 420, parameters: [parameter("标的", "沪深 300")] },
      { id: seed + 1, category: "条件判断", title: "新建条件", description: "编辑参数后连接后续节点", color: "cyan", x: 700, y: 420, parameters: [parameter("参数", "待配置")] },
    ],
    edges: [], code: "class CustomStrategy(Strategy):\n    def on_bar(self, bar):\n        pass",
  });
  initializeGraphSource(strategies.value[strategies.value.length - 1]);
  selected.value = strategies.value.length - 1;
  activeTab.value = "画布";
  resetCanvasSelection();
  selectedBlockId.value = seed + 1;
  saved.value = false;
  message.value = "新策略已创建，请配置节点后保存";
}

function addBlock() {
  const id = nextGraphId();
  const center = toWorld((viewport.value?.getBoundingClientRect().left ?? 0) + (viewport.value?.clientWidth ?? 600) / 2, (viewport.value?.getBoundingClientRect().top ?? 0) + (viewport.value?.clientHeight ?? 600) / 2);
  blocks.value.push({ id, category: "条件判断", title: "新建条件", description: "从端口拖线连接节点", color: "cyan", x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2, parameters: [parameter("参数", "待配置")] });
  selectedBlockId.value = id;
  selectedEdgeId.value = null;
  markDirty();
}
function removeBlock(id: number) {
  blocks.value = blocks.value.filter((block) => block.id !== id);
  edges.value = edges.value.filter((edge) => edge.from !== id && edge.to !== id);
  menuBlockId.value = null;
  if (selectedBlockId.value === id) selectedBlockId.value = null;
  markDirty();
}
function duplicateBlock(id: number) {
  const sourceIndex = blocks.value.findIndex((block) => block.id === id);
  if (sourceIndex < 0) return;
  const source = blocks.value[sourceIndex];
  const clone = { ...source, parameters: source.parameters.map((item) => ({ ...item })), id: nextGraphId(), title: `${source.title} 副本`, x: source.x + 48, y: source.y + 110 };
  blocks.value.splice(sourceIndex + 1, 0, clone);
  selectedBlockId.value = clone.id;
  menuBlockId.value = null;
  markDirty();
}
function configureBlock(block: Block) {
  selectedBlockId.value = block.id;
  selectedEdgeId.value = null;
  menuBlockId.value = null;
  editingBlock.value = { ...block, parameters: block.parameters.map((item) => ({ ...item })) };
}
function closeBlockEditor() { editingBlock.value = null; }
function applyBlockEditor() {
  if (!editingBlock.value) return;
  const index = blocks.value.findIndex((block) => block.id === editingBlock.value?.id);
  if (index < 0) return;
  blocks.value.splice(index, 1, { ...editingBlock.value, parameters: editingBlock.value.parameters.map((item) => ({ ...item })) });
  editingBlock.value = null;
  markDirty();
}
function toggleNodeMenu(id: number) { menuBlockId.value = menuBlockId.value === id ? null : id; }
function removeSelectedEdge() {
  if (selectedEdgeId.value === null) return;
  edges.value = edges.value.filter((edge) => edge.id !== selectedEdgeId.value);
  selectedEdgeId.value = null;
  markDirty();
}

function toWorld(clientX: number, clientY: number) {
  const rect = viewport.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: (clientX - rect.left - pan.value.x) / zoom.value, y: (clientY - rect.top - pan.value.y) / zoom.value };
}

let interactionCleanup: (() => void) | null = null;
function bindPointerInteraction(onMove: (event: PointerEvent) => void, onUp: (event: PointerEvent) => void) {
  interactionCleanup?.();
  const cleanup = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", finish); interactionCleanup = null; };
  const finish = (event: PointerEvent) => { cleanup(); onUp(event); };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish);
  interactionCleanup = cleanup;
}
function startNodeDrag(block: Block, event: PointerEvent) {
  if ((event.target as HTMLElement).closest("button, .node-port")) return;
  event.preventDefault(); event.stopPropagation();
  selectedBlockId.value = block.id; selectedEdgeId.value = null; menuBlockId.value = null;
  const startX = event.clientX; const startY = event.clientY; const originX = block.x; const originY = block.y;
  bindPointerInteraction((moveEvent) => {
    block.x = Math.max(0, Math.min(SURFACE_WIDTH - NODE_WIDTH, originX + (moveEvent.clientX - startX) / zoom.value));
    block.y = Math.max(0, Math.min(SURFACE_HEIGHT - NODE_HEIGHT, originY + (moveEvent.clientY - startY) / zoom.value));
    markDirty();
  }, () => {});
}
function startCanvasPan(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest(".flow-node, .flow-summary, .connection-hit")) return;
  event.preventDefault(); menuBlockId.value = null; selectedBlockId.value = null; selectedEdgeId.value = null; isPanning.value = true;
  const startX = event.clientX; const startY = event.clientY; const origin = { ...pan.value };
  bindPointerInteraction((moveEvent) => { pan.value = { x: origin.x + moveEvent.clientX - startX, y: origin.y + moveEvent.clientY - startY }; }, () => { isPanning.value = false; });
}
function startConnection(fromId: number, event: PointerEvent) {
  event.preventDefault(); event.stopPropagation();
  connectingFrom.value = fromId; selectedEdgeId.value = null; connectionPointer.value = toWorld(event.clientX, event.clientY);
  bindPointerInteraction((moveEvent) => { connectionPointer.value = toWorld(moveEvent.clientX, moveEvent.clientY); }, (upEvent) => {
    const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest<HTMLElement>("[data-input-id]");
    const toId = Number(target?.dataset.inputId);
    if (toId && toId !== fromId && !edges.value.some((edge) => edge.from === fromId && edge.to === toId)) {
      edges.value.push({ id: nextGraphId(), from: fromId, to: toId }); markDirty();
    }
    connectingFrom.value = null;
  });
}
function setZoom(nextZoom: number, clientX?: number, clientY?: number) {
  const rect = viewport.value?.getBoundingClientRect();
  if (!rect) return;
  const next = Math.max(0.35, Math.min(1.6, Number(nextZoom.toFixed(2))));
  const anchorX = clientX ?? rect.left + rect.width / 2; const anchorY = clientY ?? rect.top + rect.height / 2;
  const world = toWorld(anchorX, anchorY);
  zoom.value = next;
  pan.value = { x: anchorX - rect.left - world.x * next, y: anchorY - rect.top - world.y * next };
}
function changeZoom(step: number) { setZoom(zoom.value + step); }
function handleWheel(event: WheelEvent) { setZoom(zoom.value - event.deltaY * 0.0012, event.clientX, event.clientY); }
function fitCanvas() {
  const rect = viewport.value?.getBoundingClientRect();
  if (!rect || !blocks.value.length) return;
  const minX = Math.min(...blocks.value.map((block) => block.x)); const minY = Math.min(...blocks.value.map((block) => block.y));
  const maxX = Math.max(...blocks.value.map((block) => block.x + NODE_WIDTH)); const maxY = Math.max(...blocks.value.map((block) => block.y + NODE_HEIGHT));
  const next = Math.max(0.35, Math.min(1, Math.min((rect.width - 80) / (maxX - minX), (rect.height - 80) / (maxY - minY))));
  zoom.value = Number(next.toFixed(2));
  pan.value = { x: (rect.width - (maxX - minX) * zoom.value) / 2 - minX * zoom.value, y: (rect.height - (maxY - minY) * zoom.value) / 2 - minY * zoom.value };
}
function runBacktest() { if (!codeReady.value) return; running.value = true; message.value = "回测任务已提交，正在计算"; window.setTimeout(() => { running.value = false; activeTab.value = "回测"; message.value = "回测完成"; }, 900); }
function handleBeforeUnload(event: BeforeUnloadEvent) { if (!saved.value) event.preventDefault(); }

onBeforeRouteLeave(() => confirmSaveBeforeLeaving());
onMounted(() => window.addEventListener("beforeunload", handleBeforeUnload));
onBeforeUnmount(() => { clearTimeout(parseTimer); parseController?.abort(); interactionCleanup?.(); window.removeEventListener("beforeunload", handleBeforeUnload); });
</script>

<template>
  <section class="strategy-page">
    <header class="strategy-toolbar">
      <div>
        <div class="strategy-title-line">
          <h1>{{ current.name }}</h1>
          <span :class="['strategy-state', current.status === '已启用' ? 'enabled' : 'draft']">{{ current.status }}</span>
          <span v-if="!saved" class="unsaved-dot">未保存</span>
        </div>
      </div>
      <div class="page-actions">
        <button class="button ghost" type="button" :disabled="saved || !codeReady" @click="saveStrategy()">{{ saved ? "已保存" : "保存" }}</button>
        <button class="button primary" type="button" :disabled="running || !codeReady" @click="runBacktest">{{ running ? "运行中…" : "开始回测" }}</button>
      </div>
    </header>

    <p v-if="message" class="page-notice strategy-message">{{ message }}</p>

    <div class="strategy-workbench">
      <aside class="strategy-library panel">
        <div class="workspace-panel-head">
          <div><span>STRATEGIES</span><h2>策略列表</h2></div>
          <button type="button" aria-label="新建策略" @click="createStrategy">＋</button>
        </div>
        <div class="strategy-list">
          <button v-for="(strategy, index) in strategies" :key="strategy.name" type="button" :class="{ active: selected === index }" @click="selectStrategy(index)">
            <div class="strategy-list-title"><strong>{{ strategy.name }}</strong><i :class="strategy.status === '已启用' ? 'online' : ''"></i></div>
            <p>{{ strategy.type }}策略 · 更新于{{ strategy.updated }}</p>
            <div><span>{{ strategy.status }}</span><b>{{ strategy.returnRate }}</b></div>
          </button>
        </div>
        <button class="new-strategy-button" type="button" @click="createStrategy">＋ 新建策略</button>
      </aside>

      <main class="strategy-canvas panel">
        <div class="canvas-topbar">
          <div class="canvas-tabs">
            <button v-for="tab in ['画布', '代码', '回测']" :key="tab" type="button" :class="{ active: activeTab === tab }" :disabled="tab !== '代码' && !codeReady" @click="activeTab = tab as typeof activeTab">{{ tab }}</button>
          </div>
          <div v-if="activeTab === '画布'" class="canvas-tools"><button type="button" aria-label="缩小画布" @click="changeZoom(-0.1)">－</button><span>{{ Math.round(zoom * 100) }}%</span><button type="button" aria-label="放大画布" @click="changeZoom(0.1)">＋</button><button type="button" @click="fitCanvas">适配</button></div>
        </div>

        <div v-if="activeTab === '画布'" class="flow-canvas">
          <div class="flow-summary"><span>策略节点图</span><small>拖动画布 · 滚轮缩放 · 从右侧端口拖至任意节点左侧</small><div><button v-if="selectedEdgeId !== null" class="danger" type="button" @click="removeSelectedEdge">删除连线</button><button type="button" @click="addBlock">＋ 添加节点</button></div></div>
          <div ref="viewport" class="flow-viewport" :class="{ panning: isPanning }" :style="{ backgroundSize: `${20 * zoom}px ${20 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }" @pointerdown="startCanvasPan" @wheel.prevent="handleWheel">
            <div class="flow-surface" :style="surfaceStyle">
              <svg class="flow-wires" :width="SURFACE_WIDTH" :height="SURFACE_HEIGHT">
                <g v-for="wire in edgePaths" :key="wire.id">
                  <path class="connection-hit" :d="wire.d" @pointerdown.stop @click.stop="selectedEdgeId = wire.id; selectedBlockId = null" />
                  <path class="flow-wire" :class="{ selected: selectedEdgeId === wire.id }" :d="wire.d" />
                </g>
                <path v-if="previewPath" class="flow-wire preview" :d="previewPath" />
              </svg>
              <article v-for="(block, index) in blocks" :key="block.id" class="flow-node" :class="[block.color, { selected: selectedBlockId === block.id }]" :style="{ left: `${block.x}px`, top: `${block.y}px` }" @pointerdown="startNodeDrag(block, $event)" @click.stop="selectedBlockId = block.id; selectedEdgeId = null; menuBlockId = null">
                <div class="node-port in" :data-input-id="block.id" title="输入端口"></div>
                <span class="node-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <div class="node-copy"><small>{{ block.category }}</small><strong>{{ block.title }}</strong><p>{{ block.description }}</p></div>
                <button class="node-menu-trigger" type="button" aria-label="节点操作菜单" @pointerdown.stop @click.stop="toggleNodeMenu(block.id)">···</button>
                <div v-if="menuBlockId === block.id" class="node-action-menu" @pointerdown.stop @click.stop>
                  <button type="button" @click="configureBlock(block)">编辑参数</button>
                  <button type="button" @click="duplicateBlock(block.id)">复制节点</button>
                  <button class="danger" type="button" @click="removeBlock(block.id)">删除节点</button>
                </div>
                <div class="node-port out" title="拖动以创建连线" @pointerdown.stop="startConnection(block.id, $event)"></div>
              </article>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === '代码'" class="strategy-code-panel">
          <div class="code-editor-help">
            <button class="button ghost" type="button" :disabled="codePending" @click="validateCode(true)">{{ codePending ? '校验中…' : '校验' }}</button>
            <span v-if="codeError || validationMessage" role="status" :class="{ 'code-error': codeError }">{{ codeError || validationMessage }}</span>
            <details><summary>节点格式与连线示例</summary><pre>{"id": 100, "category": "条件判断", "title": "新条件", "description": "自定义信号", "color": "cyan", "x": 440, "y": 200, "parameters": [{"label": "周期", "value": "10", "unit": "日"}]}
连线：{"id": 200, "from": 1, "to": 100}
id 必须唯一，连线端点必须存在。其他 Python 策略代码不会因画布编辑被覆盖。</pre></details>
          </div>
          <div class="code-preview">
            <div style="overflow: hidden"><pre class="code-lines" aria-hidden="true" :style="{ transform: `translateY(-${codeScroll}px)` }">{{ codeLineNumbers }}</pre></div>
            <textarea aria-label="策略 Python 代码" :value="current.code" rows="25" spellcheck="false" autocapitalize="off" @scroll="codeScroll = ($event.target as HTMLTextAreaElement).scrollTop" @input="updateCode" @keydown.tab="indentCode"></textarea>
          </div>
        </div>

        <div v-else-if="activeTab === '回测'" class="backtest-preview">
          <div><span>累计收益</span><strong class="positive">{{ current.returnRate }}</strong></div>
          <div><span>年化收益</span><strong>{{ current.annualReturn }}</strong></div>
          <div><span>最大回撤</span><strong class="negative">{{ current.drawdown }}</strong></div>
          <div><span>夏普比率</span><strong>{{ current.sharpe }}</strong></div>
          <p>最近回测区间：{{ current.config.start }} 至 {{ current.config.end }}</p>
          <section class="backtest-config">
            <div class="workspace-panel-head"><div><span>CONFIGURATION</span><h2>回测配置</h2></div><small>{{ saved ? "已保存" : "自动保存关闭 · 未保存" }}</small></div>
            <div class="config-section">
              <h3>基础设置</h3>
              <label><span>初始资金</span><div><input v-model="current.config.capital" @input="markDirty" /><em>CNY</em></div></label>
              <label><span>回测区间</span><div class="date-pair"><input v-model="current.config.start" @input="markDirty" /><b>—</b><input v-model="current.config.end" @input="markDirty" /></div></label>
              <label><span>基准指数</span><select v-model="current.config.benchmark" @change="markDirty"><option>沪深 300</option><option>中证 500</option><option>中证 1000</option></select></label>
            </div>
            <div class="config-section">
              <h3>交易参数</h3>
              <label><span>手续费率</span><div><input v-model="current.config.fee" @input="markDirty" /><em>%</em></div></label>
              <label><span>滑点</span><div><input v-model="current.config.slippage" @input="markDirty" /><em>bp</em></div></label>
              <label><span>最大仓位</span><div><input v-model="current.config.maxPosition" @input="markDirty" /><em>%</em></div></label>
            </div>
            <div class="config-section config-checks">
              <h3>运行选项</h3>
              <label><input v-model="current.config.adjusted" type="checkbox" @change="markDirty" /><span>使用前复权价格</span></label>
              <label><input v-model="current.config.riskControl" type="checkbox" @change="markDirty" /><span>启用风险控制节点</span></label>
              <label><input v-model="current.config.snapshots" type="checkbox" @change="markDirty" /><span>保存每日持仓快照</span></label>
            </div>
            <div class="config-foot"><span>预计耗时</span><strong>约 18 秒</strong><button class="button primary" type="button" :disabled="running || !codeReady" @click="runBacktest">{{ running ? "正在回测" : "运行回测" }}</button></div>
          </section>
        </div>
      </main>

      <aside class="strategy-ai panel">
        <div class="workspace-panel-head"><div><span>AI STRATEGY</span><h2>AI 对话生成策略</h2></div></div>
      </aside>
    </div>

    <div v-if="editingBlock" class="modal-backdrop" @pointerdown.self="closeBlockEditor">
      <section class="node-editor-modal panel" role="dialog" aria-modal="true" aria-label="编辑节点参数">
        <header><div><span>NODE PARAMETERS</span><h2>编辑节点参数</h2></div><button type="button" aria-label="关闭" @click="closeBlockEditor">×</button></header>
        <div class="node-editor-body">
          <div class="selected-node-summary"><i :class="editingBlock.color"></i><div><small>{{ editingBlock.category }}</small><strong>{{ editingBlock.title }}</strong></div></div>
          <div class="config-section">
            <h3>节点信息</h3>
            <label><span>节点类型</span><div><input v-model="editingBlock.category" /></div></label>
            <label><span>节点名称</span><div><input v-model="editingBlock.title" /></div></label>
            <label><span>节点描述</span><div><input v-model="editingBlock.description" /></div></label>
          </div>
          <div class="config-section node-parameters">
            <h3>运行参数</h3>
            <label v-for="(item, index) in editingBlock.parameters" :key="`${item.label}-${index}`"><span>{{ item.label }}</span><div><input v-model="item.value" /><em v-if="item.unit">{{ item.unit }}</em></div></label>
          </div>
        </div>
        <footer><button class="button ghost" type="button" @click="closeBlockEditor">取消</button><button class="button primary" type="button" @click="applyBlockEditor">应用参数</button></footer>
      </section>
    </div>
  </section>
</template>