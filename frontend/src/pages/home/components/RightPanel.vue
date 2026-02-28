<template>
  <aside class="panel-right">
    <div class="ai-chat-placeholder">
      <div class="ai-title">AI 助手</div>
      <div class="ai-body">对话功能开发中...</div>
    </div>
  </aside>
</template>

<style scoped>
.panel-right {
  width: 280px;
  flex-shrink: 0;
}
.ai-chat-placeholder {
  height: 100%;
  background: #1a2536;
  border: 1px solid #2a3a4e;
  border-radius: 8px;
  padding: 0.8rem;
  display: flex;
  flex-direction: column;
}
.ai-title { font-size: 0.9em; font-weight: 600; margin-bottom: 0.5rem; }
.ai-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.3);
  font-size: 0.85em;
}

@media (max-width: 768px) {
  .panel-right { width: 100%; }
  .ai-chat-placeholder { min-height: 200px; }
}
</style>
