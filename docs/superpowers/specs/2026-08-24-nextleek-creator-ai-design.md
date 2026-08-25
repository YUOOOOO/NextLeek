# NextLeek 第二阶段：创造模式内置 AI 插件生成设计

## 目标

在现有 Creator 的“创造模式”内增加 AI 对话能力。用户用自然语言描述插件功能，Creator 通过项目内置的固定 AI Skill 生成完整插件草稿，并继续走现有的 Rust 校验、编辑、预览和 `.nlplugin` 打包流程。

本阶段不新增独立 AI 页面，不实现同步，不让 AI 直接执行插件代码。

## 已确认决策

- AI 接入使用 OpenAI 兼容的 `chat/completions` 接口。
- 支持配置 `baseUrl`、`apiKey`、`model` 和 `temperature`。
- 请求由 Tauri/Rust 发起，Vue 不直接持有 AI 网络调用逻辑。
- 固定 AI Skill 写在当前项目中，由 Rust 请求层统一注入。
- AI 返回结构化 JSON，禁止返回仅含伪代码或 TODO 的半成品。
- AI 生成结果必须经过本地结构校验和现有 Rust 草稿校验。
- 只有用户点击“应用到编辑器”后，生成内容才覆盖当前编辑器。
- 生成失败时保留原草稿，不自动安装、不自动发布市场。

## 用户流程

```text
输入插件需求
  -> 点击生成
  -> Rust 读取 AI 设置并请求模型
  -> 解析结构化插件草稿
  -> 前端显示说明和文件变更
  -> 用户点击应用到编辑器
  -> 写入 creator-draft
  -> 执行 Manifest/文件校验
  -> 用户继续预览或打包
```

AI 对话支持三类意图：

1. 从零生成插件。
2. 基于当前草稿修改功能或界面。
3. 根据最近一次校验错误修复草稿。

## 固定 AI Skill

Skill 内容固定包含：

- Manifest 必填字段和命名规则。
- `ui/index.html`、`ui/main.js`、`ui/style.css` 文件契约。
- 允许的能力和权限列表。
- `navigation` 配置格式。
- 禁止 EXE、DLL、SO、DYLIB、Sidecar、Shell 和任意原生调用。
- 禁止路径穿越和外部任意资源依赖。
- 必须输出完整文件内容。
- 必须输出可解析 JSON，不得使用 Markdown 包裹 JSON。
- 修改草稿时保留未涉及文件的行为。

Skill 不通过用户设置编辑，避免破坏安全和生成契约。

## 数据契约

### 请求

```ts
interface GeneratePluginRequest {
  instruction: string
  currentDraft: {
    manifest: PluginManifest
    files: Record<string, string>
  }
  validationErrors?: string[]
}
```

### 响应

```ts
interface GeneratePluginResponse {
  manifest: PluginManifest
  files: {
    'ui/index.html': string
    'ui/main.js': string
    'ui/style.css': string
  }
  explanation: string
}
```

Rust 层必须验证：

- JSON 可解析。
- Manifest 字段合法。
- 文件集合完整。
- 文件路径只能是允许的 `ui/` 路径。
- 响应大小不超过固定上限。
- 模型返回的权限和能力符合项目允许集合。

## AI 设置

```json
{
  "ai": {
    "enabled": true,
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "...",
    "model": "gpt-4.1-mini",
    "temperature": 0.2
  }
}
```

设置位于现有 `Data/settings.json`。首版沿用当前本地设置存储；系统安全存储不在本阶段扩展。

## UI 设计

创造模式保持单页面，不新增路由：

- 左侧保留 Manifest 和代码编辑区域。
- 右侧增加 AI 对话卡片。
- 显示用户消息、AI 说明、生成状态、错误和待应用文件列表。
- “生成插件”只生成待确认结果。
- “应用到编辑器”写入当前表单和编辑器。
- “保存并验证”继续使用现有流程。
- API Key 不显示在对话内容和错误信息中。

## 错误处理

使用稳定错误前缀：

- `AI_DISABLED`
- `AI_CONFIG_INVALID`
- `AI_REQUEST_FAILED`
- `AI_RESPONSE_INVALID`
- `AI_RESPONSE_TOO_LARGE`
- `AI_PLUGIN_INVALID`
- `AI_TIMEOUT`

失败时不修改当前草稿；错误消息不得包含 API Key 或完整请求头。

## 非目标

- 独立 AI 聊天页面。
- WebDAV、多设备同步。
- 流式输出。
- 多 Agent 编排。
- AI 自动安装、自动发布和自动提交 Git。
- AI 生成原生插件或交易指令。

## 验收标准

1. Creator 设置可保存并读取 AI 配置。
2. 创造模式可输入需求并请求 OpenAI 兼容接口。
3. 有效响应显示生成说明和文件变更，不立即覆盖编辑器。
4. 点击应用后，Manifest、HTML、CSS、JavaScript 同步更新。
5. 生成结果可继续通过 Rust 草稿校验。
6. 校验通过后可以继续生成 `.nlplugin`。
7. 非法 JSON、缺失文件、危险路径和非法权限被拒绝。
8. 请求失败时原草稿保持不变。
9. API Key 不出现在 UI 错误和日志中。
10. 前端测试、类型检查和生产构建通过。
