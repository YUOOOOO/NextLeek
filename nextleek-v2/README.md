# NextLeek

Rust 微内核 + Tauri 2 + Vue 3 的桌面插件创造与运行环境。

Creator 当前支持：

- 固定左侧导航，右侧内容区域独立滚动。
- 在创造模式中编辑插件 HTML / CSS / JavaScript。
- 使用 Rust 校验插件 Manifest、资源路径、能力声明和权限声明。
- 生成 `.nlplugin` 插件包并计算 SHA-256。
- 安装、卸载、运行本地插件和市场插件。
- 通过 GitHub 市场索引加载官方与社区插件。
- 通过 Manifest 配置把插件显示到 Creator 侧边栏。
- 展示插件来源：内置、官方市场、本地导入。

当前版本仍禁止原生插件、任意 Sidecar 与可执行文件。Creator 草稿和已安装插件目录由 Rust 强制隔离。

## 目录结构

```text
nextleek-v2/
├─ apps/
│  ├─ shell-ui/          # Vue 3 Creator 桌面壳
│  └─ desktop/           # Tauri 2 宿主与命令接口
├─ crates/
│  └─ kernel/            # Manifest、插件包、插件存储与能力校验
├─ plugins/builtin/      # 内置示例插件
├─ schemas/              # 插件 Manifest JSON Schema
└─ .github/workflows/    # GitHub Actions 打包流程
```

## 开发环境

- Node.js 22+
- pnpm 11+
- Rust stable
- Windows 构建需要 `x86_64-pc-windows-msvc` target
- Tauri Windows 运行环境需要 WebView2 Evergreen Runtime

## 本地开发

在 `nextleek-v2/` 目录执行：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## 校验与构建

```bash
# 前端类型检查
pnpm typecheck

# 前端测试
pnpm test

# 前端生产构建
pnpm build

# Rust 工作区测试
cargo test --workspace

# Rust 静态检查
cargo clippy --workspace --all-targets -- -D warnings
```

桌面端开发运行：

```bash
pnpm tauri dev
```

## 插件 Manifest

Manifest 定义位于 `schemas/plugin-manifest.schema.json`。最小示例：

```json
{
  "$schema": "https://nextleek.local/schemas/plugin-manifest.schema.json",
  "id": "com.example.clock",
  "name": "Clock",
  "version": "1.0.0",
  "entry": "ui/index.html",
  "description": "一个示例插件",
  "author": "Community",
  "icon": "assets/icon.png",
  "minCreatorVersion": "0.1.0",
  "capabilities": ["clock.read"],
  "permissions": [],
  "navigation": {
    "enabled": true,
    "label": "时钟",
    "icon": "assets/icon.png",
    "order": 100
  }
}
```

### 资源约束

- 入口必须位于 `ui/`，例如 `ui/index.html`。
- 图标必须位于 `assets/`。
- 禁止绝对路径、反斜杠路径和路径穿越。
- `capabilities` 不允许重复。
- 当前允许的权限：
  - `storage:local`
  - `network:https`
  - `filesystem:trusted`

### 侧边栏导航

插件只有在以下配置启用后才会显示在 Creator 左侧菜单：

```json
"navigation": {
  "enabled": true,
  "label": "我的插件",
  "order": 100
}
```

`order` 越小越靠前。未启用导航的插件仍可从插件市场或已安装列表打开。

## 插件来源

Creator 在插件状态中记录来源：

| 来源 | 说明 |
|------|------|
| `builtin` | 随 Creator 内置的插件 |
| `official-market` | 从配置的官方/市场索引安装 |
| `local-import` | 从本地 `.nlplugin` 文件导入 |
| `user-created` | 用户在创造模式生成的插件来源标识 |

## GitHub Actions 自动打包

工作流文件：

```text
.github/workflows/build-windows-portable.yml
```

工作流会构建 Windows x64 便携版，并上传：

```text
NextLeek-portable-windows-x64.zip
NextLeek-portable-windows-x64.zip.sha256
```

### 手动触发

1. 将代码推送到 GitHub。
2. 打开仓库的 **Actions**。
3. 选择 `build-windows-portable`。
4. 点击 **Run workflow**。
5. 在运行记录的 **Artifacts** 下载便携包。

### 标签触发

工作流会在推送 `v*` 标签时自动运行：

```powershell
git tag v0.1.6
git push origin v0.1.6
```

例如 `v0.1.6`、`v1.0.0` 都会触发 Windows 打包。

### 常见失败

如果出现：

```text
icons/icon.ico not found
```

检查以下文件是否已提交到仓库：

```text
nextleek-v2/apps/desktop/src-tauri/icons/icon.ico
```

GitHub Actions 使用的是远程仓库中的文件，不会读取本地未提交的资源。

## GitHub 插件市场

Creator 市场通过 HTTPS 加载 JSON 索引。市场插件至少需要包含：

```json
{
  "id": "com.example.clock",
  "name": "Clock",
  "version": "1.0.0",
  "description": "Clock plugin",
  "author": "Community",
  "packageUrl": "https://example.com/clock.nlplugin",
  "sha256": "<64 位十六进制 SHA-256>",
  "minCreatorVersion": "0.1.0",
  "permissions": []
}
```

市场包安装前会校验 HTTPS、包大小、SHA-256、Manifest 和 Creator 版本兼容性。

## 当前范围

当前实现聚焦 Creator 第一阶段和插件运行基础能力：

- 已完成：布局、插件导航、来源标识、Manifest 校验、插件包、市场安装与运行。
- 暂不实现：WebDAV 同步、多设备同步、独立 AI 对话页面。
- 后续 AI 能力应集成在创造模式中，用于根据对话生成插件草稿、校验、修复和重新打包，而不是新增独立对话页面。
