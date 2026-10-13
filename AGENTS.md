# NextTools — Agent 开发契约

NextTools 是 Electron + Vue 3 + TypeScript + Pinia + Cordis 桌面启动器。本文记录当前源码契约，不把规划中的能力写成已实现功能。`AGENTS.md` 与本文保持一致。

## 已实现范围

- Cordis `@deepseek-ai/cordis` 4.0.4；Electron 41；Node 24；electron-vite；pnpm。
- LMDB 存储设置、固定项、最近执行指令和命令快捷键。没有已接入的 SQLite、LLM、会话或 MCP 服务。
- 内置服务：storage、commands、pluginEndpoints、search、desktop、tools、skills、clientModules。内置插件：设置、主题、受保护搜索、插件市场、命令快捷键。
- 搜索聚合应用、指令和文件提供者；最近使用与固定指令独立展示。Everything 原生索引搜索仅 Windows x64；不可用时明确报告状态，不伪装成功。
- 设置提供主题、六种强调色、紧凑顶栏、开机自启、全局唤醒键和命令快捷键。录制快捷键时暂停正常全局快捷键，结束后恢复。
- 在线更新走 `electron-updater` 和 GitHub Releases；Windows NSIS 支持安装更新，便携 ZIP 手动更新。

## 窗口与页面契约

隐藏/唤出保留当前页面、查询、结果、选择和打开插件的活视图；`shown` 只请求恢复焦点，不清空搜索。搜索空查询且无有效历史/固定项时收缩到输入栏；内容超出可用高度时在内容区滚动。

Esc 按页面层级返回：打开插件先关闭其会话并回来源列表（插件市场或已安装插件）；设置/插件管理等页面返回搜索。搜索页非空查询时清空，空查询时留在搜索并聚焦，重复 Esc 不隐藏窗口。不存在“第二次 Esc 隐藏”或“ESC 隐藏”设置。原生关闭隐藏窗口；唤醒快捷键可切换显隐；退出由托盘执行。

市场本身是宿主 Vue 页面。打开的市场包及可信 Browser half 使用独立 `WebContentsView`，不是 iframe。窗口隐藏仅收起 surface，重新显示复用同一 contents；显式返回关闭插件会话，下一次打开创建新会话。

## 源码定位

- `cordis.patch.yml`：部署组合声明。
- `src/host/composition.ts`：解析 insert 配置，选择内置工厂或可信包加载器。
- `src/host/trusted-plugin.ts`：可信 `plugin.json`、Node half、Browser bundle 及声明校验。
- `src/host/runtime.ts`：Fiber 启停、核心保护、串行变更与退出清理。
- `src/host/services/contributions.ts`：tools / skills 注册和调用。
- `src/host/services/client-modules.ts`：Browser 定义、打开命令与子会话 Fiber。
- `src/host/services/plugin-views.ts`：Electron 原生视图、权限、IPC 校验和释放。
- `src/client/`：宿主嵌入层；`plugins/launcher/renderer/src/` 与 `plugins/settings/src/`：原版启动器、设置路由及页面逻辑；`plugins/plugin-market/`：静态包验证、管理端点和数据源能力。
- `src/preload/`：宿主桥与受限插件桥，不能混用。
- `src/host/services/settings-native.ts`、`source-native.ts`：原版页面受校验的窄原生桥；`plugins/native-system-settings/`、`native-context/`、`auxiliary-surfaces/`：设置与原生资源的 Cordis 生命周期。
- `resources/source-floating-ball.html`、`source-floating-ball.js`：原版浮球页面与外部脚本；通过受限 preload 访问原生能力，不放宽宿主 CSP。

## Cordis 组合

宿主通过包导出的 `nexttools/cordis.patch.yml` 读取 YAML；根文档是含 `insert` 数组的列表。每项必须有唯一显式 `id` 和非空 `name`，可选 `label`、布尔 `protected`、`config`。内置 `nexttools/*` 名称映射到现有工厂，其余名称交给可信加载器，从部署 patch 所在目录解析。配置顺序决定启用顺序，依赖通过 `inject` 声明。

```yaml
- insert:
    - id: acme-reader
      name: '@acme/reader'
      label: Reader
      protected: false
      config:
        greeting: Hello
```

这是启动时部署组合，不是通用 HMR、任意配置补丁编辑器或在线 npm 安装器。外部包及其依赖必须已部署且可解析；不能仅添加 YAML 就宣称发行包已经包含这些文件。宿主 `package.json` 的 `dsh.bundle.patch` 指向该 patch；当前宿主不是通过 `./client` 导出 UI 的外部双面包。

## 可信部署 plugin.json

可信包不是市场 `.nlplugin`。Node half 在宿主内执行，拥有 Node 权限，只能部署经过信任的代码。

```json
{
  "id": "acme/reader",
  "name": "Reader",
  "version": "1.0.0",
  "main": "./lib/index.mjs",
  "engines": { "dsh": ">=4.0.0 <5" },
  "contributes": { "tools": ["reader_read"], "skills": ["reader_help"] },
  "client": {
    "main": "./lib/client.js",
    "inject": ["@deepseek-ai/dsh-client-runtime"]
  }
}
```

- `id` 严格两段 publisher/name；版本与 `engines.dsh` 使用 semver，并须兼容宿主版本。
- `main` 为包内 Node 入口，默认导出 Cordis 插件；entry 不能逃出包目录。
- 两个贡献数组必须存在，名称由字母/数字/下划线/点/横杠组成，数组内不得重复。Node 子 Fiber 就绪后用 `has(name, child.ctx)` 验证声明由该 Node Fiber 自身或其后代 Fiber 注册；不能借用其他插件的同名贡献，缺失或归属不符即启用失败并回滚。声明不是自动注册。
- Node-only 插件可以省略 `client`。Browser half 只允许通过裸包名加载；相对路径或绝对路径配置不允许携带 Browser half。
- Browser half 的 `package.json.name` 必须匹配配置名，`dsh.client.platform` 必须为 `web`，`exports["./client"]` 必须解析到 `plugin.json.client.main`。`client.inject` 当前只接受 `@deepseek-ai/dsh-client-runtime`。
- Browser 默认导出 Cordis 插件；加载器用 esbuild 打成浏览器 IIFE，提供独立 Browser Context 与 `@deepseek-ai/dsh-client-runtime` 服务。服务包含 `root` DOM 节点、`invokeTool(name, args = {})` 和 `readSkill(name)`，分别通过 preload 的专用 `window.nextleek.invokeTool` / `readSkill` 方法传参；宿主只允许调用该 manifest 声明的工具/技能。不要 import Node 实现或使用宿主 `window.desktop`。

## 工具与技能：必须指定 owner

`register(owner, name, definition)` 的第一个参数是注册插件的 Context，不能省略或改用服务提供者的 Context。服务将注册绑到 `owner.effect()`，owner Fiber 卸载自动撤销。工具定义为 description、parameters、execute；技能定义为文本。重复/空名称报错；调用不存在的贡献报错。

```typescript
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'acme-reader',
  inject: ['tools', 'skills'],
  apply(ctx: Context) {
    ctx.tools.register(ctx, 'reader_read', {
      description: '读取输入',
      parameters: { type: 'object', properties: { input: { type: 'string' } } },
      execute(args) { return { input: args.input } },
    })
    ctx.skills.register(ctx, 'reader_help', 'Reader 使用说明')
  },
}
```

调用为 `ctx.tools.invoke(name, args)` / `ctx.skills.invoke(name, args)`。`has(name)` 检查存在性；`has(name, owner)` 额外检查注册 Fiber 是否为 owner 自身或其后代。`parameters` 是元数据；注册服务本身不执行 JSON Schema 参数校验，工具应自行校验需要的输入。所有监听、定时器、原生资源和注册均绑定插件作用域的 effect，禁止隐藏的模块级可变状态。

## 双面生命周期

可信加载器创建包装 Fiber，Node half 是其子 Fiber。Node half 就绪且声明校验通过后，包装作用域注册 Browser 定义与 `client.<composition-id>.open` 命令（`/` 替换为 `.`）。界面身份使用部署组合 ID，与宿主设置启停和快捷键分组一致；包 manifest ID 仍用于声明校验。打开界面再创建包装作用域下的子会话 Fiber，原生视图和 IPC handler 绑定该会话；关闭会话释放这些资源，但不卸载 Node half。Browser 自己的 Context 在页面离开时 dispose。

禁用部署插件或退出运行时会 dispose owner Fiber，连带撤销 Node 子 Fiber、贡献、Browser 定义、打开命令、现有会话及原生视图。不能将窗口 hide 当成 Fiber dispose。受保护内置插件不可禁用；失败启用必须撤销新 Fiber，不保留半成品。

原生视图使用独立非持久化 partition、sandbox、contextIsolation，关闭 Node integration / webview / 不安全内容；拒绝权限、弹窗、导航和直接网络/文件请求。受限 IPC 同时检查 contents、主 frame、文档 URL、会话及方法，不接受宿主页面或子 frame 冒充。不要把独立 view 写成“保证每插件独立 OS 进程”。

## 市场包保持受限

`.nlplugin` 是 ZIP，包含 `manifest.json` 和静态 HTML/JS/CSS/资源，不能使用可信 `plugin.json` 的 Node/main/client/contributes 协议。安装校验固定目录来源、SHA256、大小/路径、兼容版本、元数据与声明一致性，并原子持久化。权限数组当前必须为空；不存在任意宿主服务授权。

静态资源内联并使用 nonce CSP；禁止 module script、嵌入文档、直接联网、弹窗和外部导航。市场页面可用的 `window.nextleek` 桥契约是 `runtimeSummary()` 和 `invokeCapability(sourcePluginId, sourceId, method, args)`；后者仅调用 manifest 声明的 dataSources/requires 数据源方法，由宿主校验依赖、认证及请求限制后代理。共用 preload 虽还提供可信模块使用的 `invokeTool` / `readSkill` 方法，市场宿主不会接受它们的工具/技能请求；桥方法存在不代表授权。它不是任意 IPC。认证配置只由宿主 UI 管理，不能暴露给插件页面。

市场包启停/更新/卸载与可信部署插件启停是不同路径；共用视图入口不代表共享权限。不要在市场安装流程增加 Node half，也不要向静态包自动授予 tools/skills。

## 分发、署名与工作纪律

产品名 NextTools；安装 ID `com.nextleek.desktop`、既有用户目录和 NextLeek 仓库地址保持稳定。README 仅介绍 NextTools，不写竞品比较。

从 `D:/YU/_tmp_ztools_reference` 复制的产品组件必须保留 MIT 署名：`Copyright (c) 2025 lzx8589561`。完整许可现存于 `resources/icons/ZTools-LICENSE`；`electron-builder.yml` 已通过 icons 的 extraResources filter 将其随包分发。该许可覆盖所复制组件，不应描述成只给图标的许可。Windows Everything 资源另由 `LICENSE-*` filter 分发各自许可证；不得删除这些署名或许可文件。

先提升版本，再按用户明确授权提交并推送 v4 分支；GitHub Actions 验证后自动创建未使用的发布标签，打包 Windows 安装 EXE、便携 ZIP、校验和、blockmap、latest.yml。禁止提前手动打标签或覆盖已发布标签；源码由 GitHub Source code 提供，不混入便携包。

修改前读实际 loader / services / caller；复用现有契约，不臆造服务或已实现功能。用户禁止本地安装开发环境时只用已有工具，禁止安装 Node/Rust/MSVC 等工具链。跨任务工作不运行中途 formatter、lint、build 或项目测试；统一验证由集成负责人在所有改动落地后执行。文档工作不声称完成运行时验证。
