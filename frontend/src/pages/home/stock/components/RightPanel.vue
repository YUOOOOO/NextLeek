<template>
  <aside class="panel-right">
    <div class="ai-chat">
      <div class="ai-title">AI 助手</div>
      <div class="strategy-selector">
        <select v-model="selectedStrategy" :disabled="loading">
          <option v-for="s in strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="ai-messages" ref="messagesRef">
        <template v-for="(msg, i) in messages" :key="i">
          <div v-if="msg.role === 'user'" class="msg user">
            <div class="msg-content">{{ msg.content }}</div>
          </div>
          <div v-else class="msg-group">
            <div v-for="(agent, j) in msg.agents" :key="j" class="agent-block">
              <div class="agent-label" :class="{ error: agent.error }">{{ agent.name }}</div>
              <div class="agent-response">{{ agent.response }}</div>
            </div>
            <div v-if="msg.decision" class="agent-block decision">
              <div class="agent-label decision-label">{{ msg.decision.name }}</div>
              <div class="agent-response">{{ msg.decision.response }}</div>
            </div>
          </div>
        </template>
        <div v-if="loading" class="msg-group">
          <div class="agent-block"><div class="agent-response loading-dots">思考中...</div></div>
        </div>
      </div>
      <div class="ai-input">
        <input v-model="input" placeholder="输入消息..." @keydown.enter="send" :disabled="loading" />
        <button @click="send" :disabled="loading || !input.trim()">发送</button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000'

interface AgentResult { agentId: string; name: string; type: string; response: string; error?: boolean }
interface StrategyItem { id: string; name: string }
interface UserMsg { role: 'user'; content: string }
interface AssistantMsg { role: 'assistant'; agents: AgentResult[]; decision?: AgentResult }
type Message = UserMsg | AssistantMsg

const messages = ref<Message[]>([])
const input = ref('')
const loading = ref(false)
const messagesRef = ref<HTMLElement>()
const strategies = ref<StrategyItem[]>([])
const selectedStrategy = ref('')

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/ai/strategies`)
    const data: StrategyItem[] = await res.json()
    strategies.value = data
    if (data.length) selectedStrategy.value = data[0].id
  } catch {}
})

function scrollBottom() {
  nextTick(() => { if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight })
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return
  messages.value.push({ role: 'user', content: text })
  input.value = ''
  loading.value = true
  scrollBottom()
  try {
    const res = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, strategyId: selectedStrategy.value }),
    })
    const data = await res.json()
    messages.value.push({ role: 'assistant', agents: data.agents || [], decision: data.decision })
  } catch (e: any) {
    messages.value.push({ role: 'assistant', agents: [{ agentId: 'error', name: '系统', type: 'system', response: `请求失败: ${e.message}`, error: true }] })
  }
  loading.value = false
  scrollBottom()
}
</script>

<style scoped>
.panel-right { width: 280px; flex-shrink: 0; }
.ai-chat {
  height: 100%;
  background: #1a2536;
  border: 1px solid #2a3a4e;
  border-radius: 8px;
  padding: 0.8rem;
  display: flex;
  flex-direction: column;
}
.ai-title { font-size: 0.9em; font-weight: 600; margin-bottom: 0.5rem; }
.strategy-selector { margin-bottom: 0.5rem; }
.strategy-selector select {
  width: 100%; background: #0f1923; color: #e0e0e0;
  border: 1px solid #2a3a4e; border-radius: 4px;
  padding: 0.3rem 0.4rem; font-size: 0.8em; outline: none;
}
.ai-messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-bottom: 0.5rem;
}
.msg.user { align-self: flex-end; max-width: 90%; }
.msg.user .msg-content {
  background: #2563eb; color: #fff;
  font-size: 0.82em; padding: 0.4rem 0.6rem;
  border-radius: 6px; line-height: 1.4;
}
.msg-group {
  display: flex; flex-direction: column; gap: 0.4rem;
}
.agent-block {
  background: #1e2d40;
  border: 1px solid #2a3a4e;
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
}
.agent-block.decision {
  border-color: #f59e0b;
  background: #1e2a1e;
}
.agent-label {
  font-size: 0.72em; font-weight: 600;
  color: #60a5fa; margin-bottom: 0.2rem;
}
.agent-label.error { color: #ef4444; }
.agent-label.decision-label { color: #f59e0b; }
.agent-response {
  font-size: 0.78em; color: #d1d5db;
  line-height: 1.4; white-space: pre-wrap;
  word-break: break-word;
}
.loading-dots { opacity: 0.5; }
.ai-input { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
.ai-input input {
  flex: 1; background: #0f1923;
  border: 1px solid #2a3a4e; border-radius: 4px;
  color: #e0e0e0; padding: 0.35rem 0.5rem;
  font-size: 0.82em; outline: none;
}
.ai-input button {
  background: #2563eb; color: #fff; border: none;
  border-radius: 4px; padding: 0.35rem 0.7rem;
  font-size: 0.82em; cursor: pointer;
}
.ai-input button:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 768px) {
  .panel-right { width: 100%; }
  .ai-chat { min-height: 200px; }
}
</style>
