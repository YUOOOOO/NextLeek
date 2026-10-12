<!-- MIT Copyright (c) 2025 lzx8589561; adapted to the NextTools Cordis desktop contract. -->
<script setup lang="ts">
import { computed } from 'vue'
import { useDesktopStore } from '../../../../../src/client/store'
const desktop=useDesktopStore()
const appVersion=computed(()=>desktop.updateState?.currentVersion??'未读取')
const labels={unsupported:'当前安装方式不支持在线更新',idle:'尚未检查更新',checking:'正在检查更新',available:'发现新版本','not-available':'已是最新版本',downloading:'正在下载更新',downloaded:'更新已下载',installing:'正在重启安装',error:'更新失败'}
const updateInProgress=computed(()=>desktop.updateBusy||['checking','downloading','installing'].includes(desktop.updateState?.status??''))
const isCheckingUpdate=computed(()=>desktop.updateState?.status==='checking')
// 更新动作完全交给宿主更新服务，保留实际错误与支持状态。
function handleCheckUpdate(){void desktop.checkForUpdates()}
</script>
<template><div class="content-panel">    <div class="about-container">
      <!-- Logo -->
      <div class="about-logo">
        <div class="i-z-info" style="font-size:64px" />
      </div>

      <!-- 应用名称 -->
      <h1 class="about-title">NextTools</h1>

      <!-- 版本号 -->
      <div class="about-version">v{{ appVersion }}</div>

      <!-- 信息卡片 -->
      <div class="about-cards">
        <div class="about-card">
          <div class="card-icon card-icon-author">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle
                cx="12"
                cy="7"
                r="4"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div class="card-label">原始界面来源（MIT）</div>
          <div class="card-value">ZTools · lzx8589561</div>
        </div></div>      <!-- 检查更新按钮 -->
      <button class="check-update-btn" :disabled="updateInProgress || !desktop.updateState?.supported" @click="handleCheckUpdate">
        <svg v-if="!isCheckingUpdate" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M23 4V10H17"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M20.49 15C19.84 16.8399 18.6096 18.4187 16.9842 19.4985C15.3588 20.5783 13.4315 21.1006 11.4952 20.9866C9.55886 20.8726 7.70756 20.1286 6.22015 18.8667C4.73274 17.6047 3.6894 15.8932 3.24965 13.9901C2.8099 12.087 2.99716 10.0952 3.78477 8.30479C4.57238 6.51435 5.91702 5.02117 7.61403 4.04909C9.31105 3.07702 11.27 2.67856 13.2091 2.91282C15.1481 3.14708 16.9632 4.0015 18.36 5.35L23 10"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else class="spinning" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path
            d="M12 18V22"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            opacity="0.3"
          />
          <path
            d="M4.93 4.93L7.76 7.76"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
          <path
            d="M16.24 16.24L19.07 19.07"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            opacity="0.3"
          />
          <path
            d="M2 12H6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            opacity="0.5"
          />
          <path
            d="M18 12H22"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            opacity="0.5"
          />
          <path
            d="M4.93 19.07L7.76 16.24"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            opacity="0.3"
          />
          <path
            d="M16.24 7.76L19.07 4.93"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        {{ isCheckingUpdate ? '检查中...' : '检查更新' }}
      </button><p role="status">{{desktop.updateState?labels[desktop.updateState.status]:'未读取更新状态'}}<span v-if="desktop.updateState?.version"> · {{desktop.updateState.version}}</span></p><p>{{desktop.updateState?.message}}</p><progress v-if="desktop.updateState?.status==='downloading'" :value="desktop.updateState.progress?.percent??0" max="100" /><button v-if="desktop.updateState?.status==='available'" class="check-update-btn" :disabled="updateInProgress" @click="desktop.downloadUpdate()">下载更新</button><button v-if="desktop.updateState?.status==='downloaded'" class="check-update-btn" :disabled="updateInProgress" @click="desktop.installUpdate()">重启并安装</button><p v-if="desktop.updateError" role="alert">{{desktop.updateError}}</p><p>自动检查更新偏好、Beta 通道与外链打开未提供对应安全 API。</p><div class="about-copyright">MIT Copyright (c) 2025 lzx8589561</div></div></div></template>
<style scoped>
.content-panel {
  position: relative;
  height: 100%;
}

.about-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 32px 32px;
  box-sizing: border-box;
}

.about-logo {
  width: 96px;
  height: 96px;
  margin-bottom: 16px;
}

.about-logo img {
  width: 100%;
  height: 100%;
  border-radius: 22px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
}

.about-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-color);
  margin: 0 0 6px;
}

.about-version {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 28px;
}

/* 卡片区域 */
.about-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  width: 100%;
  max-width: 560px;
  margin-bottom: 24px;
}

.about-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 12px 16px;
  border-radius: 12px;
  border: 1px solid var(--control-border);
  background: var(--card-bg);
  transition: all 0.2s;
}

.about-card.clickable {
  cursor: pointer;
}

.about-card.clickable:hover {
  border-color: var(--primary-color);
  background: var(--active-bg);
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}

.card-icon-author {
  background: #e0f2fe;
  color: #0284c7;
}

.card-icon-qq {
  background: #dcfce7;
  color: #16a34a;
}

.card-icon-github {
  background: #f3f4f6;
  color: #374151;
}

.card-icon-sponsor {
  background: #fce7f3;
  color: #ec4899;
}

.card-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.card-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  display: flex;
  align-items: center;
  gap: 4px;
}

.external-icon {
  color: var(--text-secondary);
}

/* 核心技术标签 */
.about-techs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-bottom: 28px;
}

.tech-tag {
  padding: 5px 14px;
  border-radius: 16px;
  font-size: 13px;
  color: var(--text-secondary);
  border: 1px solid var(--control-border);
  background: var(--card-bg);
}

/* 检查更新按钮 */
.check-update-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 32px;
  border-radius: 10px;
  border: none;
  background: #10b981;
  color: var(--text-on-primary);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 24px;
}

.check-update-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.check-update-btn:active:not(:disabled) {
  transform: translateY(0);
}

.check-update-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.spinning {
  animation: spin 1s linear infinite;
}

/* 自动检查更新 */
.auto-update-row {
  position: absolute;
  top: 16px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1;
}

.auto-update-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.update-options-wrapper {
  position: relative;
}

.update-options-button {
  font-size: 17px;
}

.update-options-button:hover,
.update-options-button[aria-expanded='true'] {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.update-options-menu {
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  width: 276px;
  display: flex;
  align-items: center;
  gap: 18px;
  box-sizing: border-box;
  border: 1px solid var(--divider-color);
  border-radius: 7px;
  background: var(--dialog-bg);
  box-shadow: 0 10px 28px var(--shadow-color);
  padding: 13px 14px;
  color: var(--text-color);
}

.update-options-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 4px;
}

.update-options-copy span {
  font-size: 13px;
  font-weight: 600;
}

.update-options-copy small {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.beta-update-toggle {
  flex: none;
}

.update-options-enter-active,
.update-options-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.update-options-enter-from,
.update-options-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 版权信息 */
.about-copyright {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.6;
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .card-icon-author {
    background: rgba(2, 132, 199, 0.15);
  }

  .card-icon-qq {
    background: rgba(22, 163, 74, 0.15);
  }

  .card-icon-github {
    background: rgba(255, 255, 255, 0.1);
    color: #d1d5db;
  }

  .card-icon-sponsor {
    background: rgba(236, 72, 153, 0.15);
  }
}
</style>
