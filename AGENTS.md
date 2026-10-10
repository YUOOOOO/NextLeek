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
- 发版：先提升 `package.json` 版本，推送 `v4` 后 Actions 验证并分别发布安装 EXE、便携 ZIP、blockmap、`latest.yml`；源码使用独立 GitHub Source code 下载，不上传混合构建 artifact，不嵌套安装包或源码到便携 ZIP；禁止覆盖已发布标签。
- 启动器：按 ZTools 默认聚合搜索行为，空查询无有效历史和固定项时只显示输入栏；有内容时按实际内容高度展开，最高不超过当前显示器工作区。首页先显示最近使用，再独立显示固定指令，允许同一指令同时出现在两组。返回搜索清空查询；不显示独立搜索清空按钮或页面关闭按钮，Esc 清空搜索。设置侧栏不提供退出操作。快捷键录制期间暂停已保存的全局快捷键，Windows 临时接收 Alt+Space 并传入录制框，结束后释放并恢复已保存快捷键。
- 窗口恢复：搜索页重新唤起清空查询并重置选择；隐藏插件/设置后唤起保留页面、查询和结果并恢复焦点。搜索页非空查询第一次 Esc 清空、第二次隐藏；插件第一次 Esc 清空插件查询，空查询时默认退出到空搜索页。ESC 隐藏默认关闭，开启后插件 Esc/原生关闭只隐藏，不退出页面，下次唤起恢复该页面；原生关闭搜索页只隐藏。录制框 Esc 只取消录制内容。最近使用持久化执行过的指令，不持久化搜索词。
- Everything：仅 Windows x64 支持原生索引搜索，随包分发经过固定 SHA256 校验的 ZTools Everything addon 与 Everything.exe，并保留 MIT 及第三方许可证说明；不再使用 ES CLI、独立 Everything 页面或下载入口。宿主复用已运行的引擎，否则以 `-startup` 启动随包引擎，等待数据库就绪后调用同步 `everythingSearch(query, 1, limit, offset)`。内置 Cordis 插件注入 `search`、`everything`，通过 effect 注册到主启动器的通用搜索提供者注册表；禁用插件移除贡献，主界面不得硬编码 Everything。文件操作只接受宿主结果能力表中登记的不透明 ID（capability ID，不是密码学签名）；未知、篡改或过期 ID 必须拒绝。引擎未就绪、组件缺失或非 Windows 平台必须明确显示不可用或不支持状态。
- 应用搜索：独立 Cordis 插件注入 `search`，接入主搜索提供者注册表，与 Everything 文件搜索并存。Windows 扫描用户和公共开始菜单及桌面 `.lnk`，macOS 扫描应用目录 `.app`，按显示名称、去空格名称和通用首字母缩写匹配；图标来自 Electron 原生 `app.getFileIcon()`，打开原快捷方式或应用包以保留参数与工作目录。搜索结果使用宿主登记的不透明 ID 授权启动；缓存有界，查询时按 60 秒刷新，Fiber 卸载清理状态。
- 搜索展示：应用优先显示为原生图标和名称网格，不显示快捷方式路径或文件元数据；Windows 解析 `.lnk` 的指定图标或目标程序获取图标，启动仍使用原快捷方式。搜索窗口按内容收缩，最多 690 逻辑像素且小屏幕保留 48 像素工作区余量，溢出结果在内容区滚动，尺寸变化保留窗口中心。
- 聚合结果：应用和指令合并到“最佳搜索结果”，参照 ZTools 每行 9 项、32px 图标、86px 卡片，默认两行，超出通过展开/收起切换；首页最近使用和已固定同样折叠。文件提供者结果使用紧凑列表；固定、文件定位和复制路径通过右键菜单操作，键盘只选择当前可见项目。
- 搜索插件：插件列表只显示一个可启停的 `builtin-search`（搜索），内部组合 Everything 服务、文件结果提供者和应用提供者，子 Fiber 随组合插件一起卸载和恢复。旧 `everything-provider`、`everything`、`applications` 开关迁移到统一键并删除；显式新键优先，旧文件与应用开关同时关闭时默认迁移为关闭。

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
- ESC 隐藏：开启后，插件空查询时按 Esc 只隐藏主窗口；下次唤出恢复原页面，不自动返回搜索。

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
