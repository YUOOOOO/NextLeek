<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

type Mode = "research" | "strategies" | "live";
type Item = { id: string; name: string; description: string; detail: string; tags: string[]; state: string; created_at: string };

const props = defineProps<{ mode: Mode }>();
const configs = {
  research: { eyebrow: "FACTOR LAB", title: "因子研究", lead: "记录可复现的因子假设、表达式与研究边界。", noun: "因子", detailLabel: "表达式 / 研究说明", detailPlaceholder: "例如：rank(close / sma(close, 20))" },
  strategies: { eyebrow: "STRATEGY STUDIO", title: "策略管理", lead: "把研究结论组织成清晰、可审阅的策略定义。", noun: "策略", detailLabel: "规则 / 风险约束", detailPlaceholder: "描述入场、退出、仓位和风控规则" },
  live: { eyebrow: "LIVE OPERATIONS", title: "实时运行", lead: "管理运行定义及其启用状态；策略执行仍由隔离 runtime 承担，不在 API 进程内伪执行。", noun: "运行定义", detailLabel: "运行配置", detailPlaceholder: "描述数据源、频率、标的范围或执行要求" },
} as const;

const items = ref<Item[]>([]);
const loading = ref(true);
const saving = ref(false);
const message = ref("");
const error = ref("");
const form = reactive({ name: "", description: "", detail: "", tags: "" });
const config = computed(() => configs[props.mode]);

async function loadItems() {
  loading.value = true;
  error.value = "";
  try {
    const response = await fetch(`/api/workspaces/${props.mode}`);
    if (!response.ok) throw new Error(`加载失败 (${response.status})`);
    const payload = await response.json();
    items.value = payload.items;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function createItem() {
  if (form.name.trim().length < 2) {
    error.value = `请输入至少两个字的${config.value.noun}名称`;
    return;
  }
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    const response = await fetch(`/api/workspaces/${props.mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        detail: form.detail,
        tags: form.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      }),
    });
    if (!response.ok) throw new Error(`保存失败 (${response.status})`);
    form.name = "";
    form.description = "";
    form.detail = "";
    form.tags = "";
    message.value = `${config.value.noun}已保存`;
    await loadItems();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "保存失败";
  } finally {
    saving.value = false;
  }
}

async function changeState(item: Item, state: "enabled" | "paused") {
  error.value = "";
  const response = await fetch(`/api/workspaces/live/${item.id}/state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) {
    error.value = `状态更新失败 (${response.status})`;
    return;
  }
  message.value = state === "enabled" ? "运行定义已启用" : "运行定义已暂停";
  await loadItems();
}

async function removeItem(item: Item) {
  const response = await fetch(`/api/workspaces/${props.mode}/${item.id}`, { method: "DELETE" });
  if (!response.ok) {
    error.value = `删除失败 (${response.status})`;
    return;
  }
  message.value = `${config.value.noun}已删除`;
  await loadItems();
}

watch(() => props.mode, loadItems);
onMounted(loadItems);
</script>

<template>
  <section class="workbench">
    <header class="workbench-hero">
      <div>
        <p class="eyebrow">{{ config.eyebrow }}</p>
        <h1>{{ config.title }}</h1>
        <p class="lead">{{ config.lead }}</p>
      </div>
      <button class="refresh-button" type="button" @click="loadItems">刷新</button>
    </header>

    <div class="workbench-grid">
      <form class="editor-card" @submit.prevent="createItem">
        <div class="card-kicker">NEW {{ config.noun.toUpperCase() }}</div>
        <h2>新建{{ config.noun }}</h2>
        <label>名称<input v-model="form.name" maxlength="80" :placeholder="config.noun + '名称'" /></label>
        <label>摘要<input v-model="form.description" maxlength="280" placeholder="一句话说明用途与目标" /></label>
        <label>{{ config.detailLabel }}<textarea v-model="form.detail" rows="7" :placeholder="config.detailPlaceholder" /></label>
        <label>标签<input v-model="form.tags" placeholder="逗号分隔，例如：日频, A股" /></label>
        <button class="primary-action" type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存" + config.noun }}</button>
        <p v-if="message" class="inline-message success">{{ message }}</p>
        <p v-if="error" class="inline-message error">{{ error }}</p>
      </form>

      <div class="library-panel">
        <div class="library-heading">
          <div><p class="eyebrow">WORKSPACE</p><h2>已保存{{ config.noun }}</h2></div>
          <span>{{ items.length }} 项</span>
        </div>
        <div v-if="loading" class="state-card">正在读取工作区…</div>
        <div v-else-if="items.length === 0" class="state-card empty">
          <strong>工作区为空</strong>
          <p>从左侧创建第一项；所有内容会保存到 v3 独立状态文件。</p>
        </div>
        <article v-for="item in items" v-else :key="item.id" class="record-card">
          <div class="record-topline">
            <span class="state-pill" :class="item.state">{{ item.state }}</span>
            <time>{{ new Date(item.created_at).toLocaleString("zh-CN", { hour12: false }) }}</time>
          </div>
          <h3>{{ item.name }}</h3>
          <p v-if="item.description">{{ item.description }}</p>
          <pre v-if="item.detail">{{ item.detail }}</pre>
          <div v-if="item.tags.length" class="tag-row"><span v-for="tag in item.tags" :key="tag">{{ tag }}</span></div>
          <div class="record-actions">
            <template v-if="props.mode === 'live'">
              <button v-if="item.state !== 'enabled'" type="button" @click="changeState(item, 'enabled')">启用定义</button>
              <button v-else type="button" @click="changeState(item, 'paused')">暂停定义</button>
            </template>
            <button class="danger" type="button" @click="removeItem(item)">删除</button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
