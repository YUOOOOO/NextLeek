# Desktop Agent Launcher

基于 Cordis 微内核的桌面常驻 Agent 运行时，参考 ZTools 的交互与布局。
桌面端优先，手机端后置。一切皆插件。

---

## 技术栈

- 运行时内核：Cordis 4.x（`@deepseek-ai/cordis`）
- 宿主环境：Electron 41 + Node.js 24 + Chrome 146
- 前端框架：Vue 3 + TypeScript + Pinia
- 构建工具：Vite + electron-vite
- 本地存储：LMDB（主数据）+ SQLite（结构化查询）
- 插件运行时：Cordis Fiber + Effect
- 插件语言：TypeScript / JavaScript（原生）
- Python 集成：MCP Server（JSON-RPC over stdio）
- Rust 集成：napi-rs Native Addon 或 Sidecar
- GPU 扩展：通过 MCP 或 Sidecar 桥接，非核心
- 包管理：pnpm
- UI 渲染：WebContentsView（每插件独立渲染进程）
- 主题：系统/亮色/暗色，6 种主题色
- 在线更新：`electron-updater` + GitHub Releases，仅 Windows NSIS 安装版支持；便携 ZIP、开发模式和未签名 macOS 不支持自动安装。
- 发版：先提升 `package.json` 版本，推送 `v4` 后 Actions 验证并发布安装包、blockmap、`latest.yml`；禁止覆盖已发布标签。
- 启动器：首次无历史、无固定项且空查询时只显示输入栏；有历史或固定项时展开首页，设置返回保留查询并展开结果。搜索页只保留正常尺寸清空按钮，不显示页面关闭按钮；设置侧栏不提供退出操作。快捷键录制期间暂停已保存的全局快捷键，Windows 临时接收 Alt+Space 并传入录制框，结束后释放并恢复已保存快捷键。
- 窗口恢复：全局快捷键隐藏再唤起保留当前页面、查询和结果；Esc 隐藏后返回空查询启动器首页（有最近使用或固定项则展开，否则仅输入栏）。搜索页非空查询的第一次 Esc 先清空，第二次隐藏；录制框 Esc 只取消录制内容。最近使用持久化执行过的指令，不持久化搜索词。
- Everything：Windows 文件搜索复用已安装并运行的 Everything 索引，通过随包 ES CLI 查询；只打包经过固定 SHA256 校验的官方 ES 和许可证，不分发 Everything 主程序。提供者通过 Cordis 服务注入，查询进程绑定 effect，文件操作只接受宿主签发的结果 ID；缺少引擎或非 Windows 必须明确显示不可用状态。

---

## Cordis 核心概念

开发前必须理解以下五个概念：

| 概念 | 含义 | 代码体现 |
|---|---|---|
| **插件** | 实现 Service 的对象 | `apply(ctx)` 函数或 `Service` 子类 |
| **上下文** | 服务容器 | `ctx.tools` / `ctx.llm` / `ctx.storage` |
| **依赖声明** | inject 等待服务就绪 | `export const inject = ['tools']` |
| **可逆副作用** | 所有注册走 effect | `ctx.effect()` / `ctx.on()` / `ctx.tools.register()` |
| **Fiber** | 插件实例的生命周期单元 | `loading` → `active` → `disposed` |

---

## 目录结构
project/
├── package.json # name/version + main/exports + dsh.*
├── cordis.patch.yml # 组合层配置
├── cordis.yml # 开发环境插件树
│
├── src/
│ ├── host/ # Node.js 宿主端
│ │ ├── index.ts # Cordis entry: apply(ctx)
│ │ ├── services/ # 宿主服务（storage, tools, sessions）
│ │ ├── plugins/ # 宿主插件
│ │ └── infra/ # 基础设施（LMDB, IPC, 窗口管理）
│ │
│ ├── client/ # 浏览器端（渲染进程）
│ │ ├── index.ts # 客户端入口
│ │ ├── slots/ # 插槽系统
│ │ ├── plugins/ # 微前端插件
│ │ └── ui/ # ZTools 风格 UI 组件
│ │
│ └── shared/ # 共享类型与工具
│
├── plugins/ # 内置插件
│ ├── quick-launch/ # 快速启动（核心）
│ ├── clipboard/ # 剪贴板管理
│ ├── plugin-market/ # 插件市场
│ ├── settings/ # 设置面板
│ └── theme/ # 主题系统
│
├── scripts/ # 构建与门禁
│ └── gates/ # 质量门禁
│
└── docs/

---

## 硬性规则

1. **所有副作用必须走 `ctx.effect()`**。任何注册（事件监听、定时器、服务注册、工具注册）都必须绑定清理函数，Cordis 在 Fiber 卸载时自动按 LIFO 顺序回滚。

2. **依赖通过 `inject` 声明，不直接 import 实现**。插件依赖的是接口/服务名，不是具体实现。缺少依赖时 Fiber 进入 `PENDING` 状态，不抛 Fatal。

3. **禁止隐藏的全局状态**。不使用模块级可变变量，所有状态通过 `ctx` 管理。

4. **每个 Cordis 配置项必须有显式 `id`**。无 id 的条目在配置编辑时会被误判为删除+新增，导致不必要的重载。

5. **UI 插件必须遵循双面插件规范**：
   - Node 端：`lib/index.ts`（Cordis entry）
   - Browser 端：`lib/client.ts`（通过 `dsh.client` 声明）
   - 浏览器半侧只挂在裸包名行上

6. **插件包根 = 仓库根**。`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`。

7. **Capability Seam 三位一体**：每个能力拆分为定义（接口）、提供者（实现）、消费者（使用）三个独立角色。缺少 Provider 则工具无法消费；重复配置同名 Provider 会触发服务重名冲突。

---

## Cordis 插件开发规范

### 最小插件

```typescript
// src/host/plugins/hello/index.ts
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  greeting: string
  targets: string[]
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export const inject = ['storage', 'tools']

export function apply(ctx: Context, config: Config) {
  for (const target of config.targets) {
    ctx.logger.info(`${config.greeting}, ${target}!`)
  }
}
```

注册可逆副作用

```typescript
export function apply(ctx: Context) {
  // 注册工具（自动跟随 Fiber 生命周期）
  ctx.tools.register('my_tool', {
    description: 'Do something',
    parameters: { input: { type: 'string' } },
    async execute(args) {
      return { result: args.input.toUpperCase() }
    },
  })

  // 监听事件
  ctx.on('session/start', (session) => {
    ctx.logger.info(`session started: ${session.id}`)
  })

  // 手动注册 effect（需要显式清理函数）
  ctx.effect(() => {
    const timer = setInterval(() => { /* ... */ }, 1000)
    return () => clearInterval(timer)
  })
}
```

事件派发模式

| 模式 | 语义 | 用途 |
|---|---|---|
| emit | 同步通知，无返回值 | 日志、观察 |
| waterfall | 同步环绕中间件，监听器收 `(...args, next)`，调 `next()` 执行下游，不调即短路 | 修改输入、拦截 |
| parallel | Promise.all 并发等待全部 settle | 并行任务 |
| serial | 按序 await，返回结果数组 | 顺序执行 |
| bail | 按序直到某监听器返回 bail 值 | 竞速、短路 |

配置校验

```typescript
// 导出的 Config 同时是 TypeScript 接口和运行时 Schema
// 消费方拿类型，Cordis 拿校验器
// 禁止导出 plain object，必须实现 Standard Schema 接口
```

配置校验失败时，Fiber 进入 `FAILED` 状态，启动器以退出码 1 报错。

### package.json — dsh 字段契约

```json
{
  "name": "desktop-agent-launcher",
  "version": "0.1.0",
  "type": "module",
  "main": "./lib/index.mjs",
  "exports": {
    ".": "./lib/index.mjs",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web"
    }
  }
}
```

- `dsh.bundle.patch`：指向组合层配置，声明即 bundle
- `dsh.client.platform: web`：声明浏览器端模块
- `exports["./client"]`：client bundle 路径
- `main/exports["."]`：Cordis entry（name/inject/apply）

### cordis.patch.yml — 组合层配置

```yaml
- insert:
    - id: quick-launch
      name: ./plugins/quick-launch
      config:
        hotkey: Alt+Z
        maxResults: 20

    - id: clipboard
      name: ./plugins/clipboard

    - id: settings
      name: ./plugins/settings

    - id: plugin-market
      name: ./plugins/plugin-market

    - id: hmr
      name: '@deepseek-ai/cordis-plugin-hmr'
      config:
        root: ['.']
```

---

## ZTools 风格桌面布局

### 主界面结构

```text
┌─────────────────────────────────────────────────┐
│  [搜索框: 输入应用名或命令...]          [设置]  │
├─────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────┐  │
│  │  📌 常用应用（固定到顶部）                 │  │
│  │  [浏览器] [微信] [VS Code] [文件管理器]   │  │
│  ├───────────────────────────────────────────┤  │
│  │  🔍 搜索结果                              │  │
│  │  ▸ 浏览器 — 打开默认浏览器                │  │
│  │  ▸ 剪贴板历史 — 查看最近复制的 100 条     │  │
│  │  ▸ 插件市场 — 浏览和安装插件              │  │
│  ├───────────────────────────────────────────┤  │
│  │  ⚡ 插件操作（选中后展开）                 │  │
│  │  [翻译] [压缩图片] [格式化 JSON]          │  │
│  └───────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│  [超级面板] [剪贴板] [插件市场] [设置]  [头像] │
└─────────────────────────────────────────────────┘
```

### 交互规范

- 快捷键：Alt+Z（Windows）/ Option+Z（macOS）唤起
- 导航：↑↓←→ 移动，Enter 确认，Esc 退出
- 固定：右键应用图标 → “固定到搜索框”，固定项显示在结果顶部
- 超级面板：选中文本/图片后唤起，自动匹配可用操作
- 紧凑模式：可开启“紧凑顶部栏”，缩小搜索框和插件顶部栏
- ESC 隐藏：在插件中按 Esc 直接隐藏主窗口，下次唤出时返回搜索状态

### 插件渲染

每个 UI 插件运行在独立的 WebContentsView 中，由 PluginManager 管理生命周期：

```typescript
// src/host/infra/pluginManager.ts
class PluginManager {
  private views = new Map<string, WebContentsView>()

  createView(pluginId: string, entry: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: getPreloadPath(pluginId),
        contextIsolation: true,
      },
    })
    view.webContents.loadFile(entry)
    this.views.set(pluginId, view)
    return view
  }

  destroyView(pluginId: string) {
    const view = this.views.get(pluginId)
    if (view) {
      view.webContents.close()
      this.views.delete(pluginId)
    }
  }
}
```

---

## 内置插件清单

### quick-launch（快速启动）

- 输入应用名/命令，模糊搜索
- 拼音搜索、正则匹配、历史记录
- 固定项管理
- 插件命令注册与触发

### clipboard（剪贴板管理）

- 历史记录（文本 + 图片）
- 搜索、固定、删除
- 跨平台原生实现
- 数据存储在 LMDB 独立命名空间

### plugin-market（插件市场）

- 在线浏览和安装插件
- 插件更新检测与一键升级
- 插件详情（描述、版本、作者）
- 已安装插件管理（打开/升级）
- 插件包格式：ZIP 包含 plugin.json + 插件文件

### settings（设置）

- 主题定制（系统/亮色/暗色，6 种主题色）
- 通用设置（紧凑模式、ESC 隐藏、开机自启）
- 插件管理（启用/禁用/卸载）

### theme（主题系统）

- 亮色/暗色/系统跟随
- 6 种主题色
- 通过 CSS 变量注入

---

## 插件 manifest 格式

```json
{
  "id": "acme/cool-tool",
  "version": "0.1.0",
  "main": "./index.mjs",
  "engines": { "dsh": ">=0.0.1" },
  "contributes": {
    "tools": ["cool_read"],
    "skills": []
  },
  "client": {
    "main": "./lib/client.js",
    "inject": ["@deepseek-ai/dsh-client-runtime"]
  }
}
```

- `id`：publisher/name 格式，严格两段
- `main`：Node half 入口
- `contributes`：声明即契约，声明了但入口未注册 → 启用报错回滚
- `client`：浏览器 half，声明后才会被 client-modules 扫描

---

## 多语言集成

### Python（通过 MCP）

```typescript
// 在插件中启动 Python MCP Server
ctx.effect(() => {
  const proc = spawn('python', ['-m', 'my_mcp_server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // 建立 JSON-RPC over stdio 通信
  return () => proc.kill()
})
```

### Rust（通过 napi-rs）

```typescript
// 在插件中调用 Rust native addon
import native from './native/index.node'

ctx.tools.register('native_compute', {
  async execute(args) {
    return native.compute(args.input)
  },
})
```

---

## 命令

- 安装依赖：`pnpm install`
- 开发模式：`pnpm dev`
- 构建：`pnpm build`
- 构建 macOS：`pnpm build:mac`
- 构建 Windows：`pnpm build:win`
- 构建 Linux：`pnpm build:linux`
- 静态检查：`pnpm check`
- 类型检查：`pnpm typecheck`
- 质量门禁：`pnpm gates`
- 运行测试：`pnpm test`

---

## 架构约束测试

`scripts/gates/run.mjs` 必须通过以下检查：

```javascript
// 禁止隐藏的全局状态
// 所有 ctx 注册必须走 effect
// 禁止模块级可变变量
// 每个 cordis 配置项必须有显式 id
// 禁止直接 import 具体实现（必须通过 inject）
```

---

## 给 Agent 的工作流

接到任务后按顺序回答：

1. 这次改动属于哪个插件？需要新建插件还是修改已有插件？
2. 插件声明了哪些 inject？依赖的服务是否已存在？
3. 所有注册是否通过 `ctx.effect()` / `ctx.on()` / `ctx.tools.register()` 完成？
4. 是否需要 Browser half？如果是，`dsh.client` 是否正确声明？
5. 是否引入了隐藏的全局状态或模块级可变变量？

然后才写代码。完成后运行：

```text
pnpm typecheck
pnpm gates
pnpm test
```

---

## 验证 Agent 是否理解架构

### 自检问题一

我要给快速启动插件添加一个“最近使用”排序功能，代码写在哪？

→ 在 `plugins/quick-launch/` 中添加 effect 注册的定时持久化逻辑，排序逻辑作为纯函数放在 `shared/`。

### 自检问题二

插件的定时器忘记清理会怎样？

→ Cordis 的 Fiber 不会自动清理未通过 `ctx.effect()` 注册的副作用，会导致内存泄漏和僵尸定时器。必须用 `ctx.effect(() => { const t = setInterval(...); return () => clearInterval(t) })`。

### 自检问题三

两个插件都注册了同名工具会怎样？

→ Cordis 工具注册表有单调守卫，重复注册会报错。应该使用命名空间前缀（如 `clipboard.read` / `clipboard.write`）避免冲突。

---

## 成功标准

新增一个插件时，不需要修改核心代码，只需在 `cordis.patch.yml` 中添加一条配置项。

---

## 与旧版 AGENTS.md 的关键变化

| 维度 | 旧版（Tauri + Rust） | 新版（Cordis + Electron） |
|---|---|---|
| **核心哲学** | 分层与契约，编译期组装 | 一切皆插件，运行时组合 |
| **组合方式** | Host 启动时注入 Adapter | cordis.patch.yml 声明式配置 |
| **插件模型** | WASM + WIT，沙箱隔离 | Cordis 插件 + Effect，可逆副作用 |
| **依赖管理** | 静态注入 Arc<dyn Port> | 声明式 inject + 响应式 Coeffect |
| **状态清理** | 手动实现 | 自动 LIFO 回滚 |
| **语言** | Rust Core + TypeScript UI | TypeScript 全栈 |
| **热插拔** | 需自行实现 | 原生支持（HMR） |
| **UI 架构** | Tauri WebView | Electron WebContentsView |
| **布局** | 自定义 | ZTools 风格 |
| **GPU 扩展** | ComputePort 适配器 | MCP / Sidecar 桥接 |
