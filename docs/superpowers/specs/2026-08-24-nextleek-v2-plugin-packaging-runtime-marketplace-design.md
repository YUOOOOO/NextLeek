# NextLeek v2 插件打包、运行与市场设计

## 目标

为 `nextleek-v2` 建立可交付的 JavaScript 插件闭环：Creator 编辑插件源码，Rust 内核生成可复现的 `.nlplugin` 包，桌面端从独立 GitHub 市场安装和更新插件，并在应用主内容区运行插件。

系统保留 Rust 作为可信边界。插件使用 HTML、CSS 和 JavaScript，不允许携带或执行 EXE、DLL、SO、DYLIB、Shell 脚本或 Sidecar。

## 产品界面

桌面壳侧栏只保留三个主入口：

1. 首页
2. 创造模式
3. 插件市场

侧栏底部左侧显示 Creator 版本号，右侧显示设置入口。

插件市场统一承载插件生命周期，不再单独设置“已安装”或“运行时”导航项。市场卡片根据本地状态显示以下动作：

- 未安装：安装
- 已安装且为最新版：打开、卸载
- 存在新版本：更新、打开、卸载
- 安装或运行失败：显示可操作的具体错误

点击“打开”后，插件在 Creator 主内容区运行。运行视图保留返回插件市场的入口。关闭或崩溃只销毁该插件视图，不退出 Creator。

设置页包含：

- Creator 版本信息
- 市场仓库地址
- 手动刷新市场
- 本地数据目录
- 已提升为可信模式的市场插件列表
- 撤销插件可信状态

## 插件源码与包格式

开发态插件是普通目录：

```text
plugin-root/
├── manifest.json
├── ui/
│   ├── index.html
│   ├── main.js
│   └── style.css
└── assets/                 可选
    └── icon.png
```

`.nlplugin` 是上述目录的 ZIP 容器，仅使用专用扩展名区分普通压缩包。包根目录只允许：

- `manifest.json`
- `ui/`
- `assets/`

Manifest 保留现有字段并扩展市场和兼容信息：

```json
{
  "id": "com.nextleek.notes",
  "name": "Notes",
  "version": "1.0.0",
  "entry": "ui/index.html",
  "description": "本地笔记插件",
  "author": "NextLeek",
  "icon": "assets/icon.png",
  "minCreatorVersion": "0.1.0",
  "capabilities": ["notes.read", "notes.write"],
  "permissions": ["storage:local"]
}
```

`description`、`author`、`icon` 为可选展示字段；`minCreatorVersion` 为必填兼容边界。`entry` 必须位于 `ui/`。

## 确定性打包

Rust `CreatorWorkspace` 新增真实打包能力。打包过程：

1. 验证草稿 ID 和 Manifest。
2. 递归检查草稿文件。
3. 拒绝绝对路径、父级跳转、符号链接和非 UTF-8 相对路径。
4. 拒绝 EXE、DLL、SO、DYLIB、Shell 脚本和名称包含 `sidecar` 的文件。
5. 要求 Manifest 入口文件存在。
6. 按规范化相对路径排序文件。
7. 使用固定 ZIP 时间戳、权限和压缩参数写入临时文件。
8. 计算最终包 SHA-256。
9. 原子重命名到 `Data/creator-packages/<id>-<version>.nlplugin`。
10. 返回包路径、SHA-256、大小和文件清单。

同一草稿内容必须生成相同字节和相同 SHA-256。

安全限制：

- 单文件最大 5 MiB
- 未压缩总大小最大 25 MiB
- 文件数量最大 500
- 压缩包最大 25 MiB
- 禁止重复归一化路径
- 解压时再次执行全部限制，防止伪造包绕过 Creator

## 独立 GitHub 插件市场

市场仓库固定为 `YUOOOOO/NextLeek-Plugins`，默认索引地址：

```text
https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/index.json
```

市场仓库结构：

```text
NextLeek-Plugins/
├── index.json
└── packages/
    ├── com.nextleek.notes-1.0.0.nlplugin
    └── com.nextleek.stocks-1.0.0.nlplugin
```

`index.json` 格式：

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-24T00:00:00Z",
  "plugins": [
    {
      "id": "com.nextleek.notes",
      "name": "Notes",
      "version": "1.0.0",
      "description": "本地笔记插件",
      "author": "NextLeek",
      "iconUrl": "https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/icons/notes.png",
      "packageUrl": "https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/packages/com.nextleek.notes-1.0.0.nlplugin",
      "sha256": "64-character-lowercase-hex",
      "minCreatorVersion": "0.1.0",
      "permissions": ["storage:local"]
    }
  ]
}
```

客户端要求 HTTPS，限制重定向次数、响应大小和超时。索引中的 Manifest 摘要必须与包内 Manifest 一致。SHA-256 不匹配时禁止安装。

## 安装、更新与卸载

本地目录：

```text
Data/
├── creator-drafts/
├── creator-packages/
├── installed-plugins/
│   └── com.nextleek.notes/
│       ├── active.json
│       └── 1.0.0/
├── downloads/
└── settings.json
```

安装流程：

1. 下载到 `Data/downloads/*.tmp`。
2. 校验市场 SHA-256。
3. 在临时目录安全解压。
4. 验证 Manifest、入口、文件限制和 Creator 版本兼容性。
5. 将解压目录原子移动到插件版本目录。
6. 原子更新 `active.json` 指向新版本。
7. 成功后删除下载临时文件。

更新沿用相同流程。只有新版本完整安装后才切换 `active.json`，因此更新失败不影响旧版本运行。

卸载删除插件的全部版本、激活记录、私有存储和信任状态。卸载操作在界面中要求确认。

随主程序编译的 Notes 和 Stocks 作为内置资源加载，默认可信，不依赖远程市场即可运行。市场中存在同 ID 新版本时，可按普通更新流程安装；更新后的远程版本不自动继承内置信任，除非它仍属于应用内置资源。

## 双模式信任

### 沙箱模式

所有市场插件安装后默认进入沙箱模式：

- iframe 使用 `sandbox="allow-scripts"`
- 插件不能访问宿主 DOM
- 插件不能调用任意 Tauri command
- 插件不能访问 Node.js
- CSP 禁止直接外联和外部脚本
- 宿主能力只能通过 `window.nextleek` SDK 和消息桥调用
- Rust 同时校验插件 ID、运行实例令牌、Manifest 权限和请求参数

### 可信模式

内置插件默认可信。市场插件只有在用户阅读风险提示并明确确认后才能提升为可信模式。

可信插件仍通过 `window.nextleek` SDK 调用能力，但获得较宽松的文件与 HTTPS API：

- `storage.get/set/delete`
- `fs.readText/writeText/listDir/createDir/remove`
- `network.fetchHttps`

可信模式不开放：

- Shell 命令
- 任意 Tauri invoke
- 进程启动
- 动态库加载
- EXE/DLL/SO/DYLIB
- Sidecar

可信状态记录于 `Data/settings.json`，按插件 ID 保存。用户可随时在设置页撤销；撤销后下一次调用立即按沙箱权限处理。

## 插件运行协议

Rust 为每次启动创建随机运行实例令牌，并将插件入口映射到内部只读资源协议。协议处理器将令牌绑定到一个已安装插件版本和根目录，所有资源请求执行规范化路径检查。

Shell UI 创建 sandbox iframe 并加载入口。宿主与插件通过 `postMessage` 通信：

```ts
interface PluginRequest {
  requestId: string
  token: string
  method: string
  params: unknown
}

interface PluginResponse {
  requestId: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}
```

Shell 只负责转发结构化请求；权限和路径判断在 Rust 完成。请求和响应按 `requestId` 关联，单次调用设置超时。插件视图销毁时，Rust 注销实例令牌，旧页面不能继续调用能力。

## Creator 编辑流程

创造模式提供四类编辑内容：

- Manifest 表单
- `ui/index.html`
- `ui/main.js`
- `ui/style.css`

创建草稿时写入可运行模板。保存操作写入 Rust 隔离草稿目录。点击“验证”显示 Manifest、入口和文件检查结果。点击“打包”生成真实 `.nlplugin`，界面显示：

- 输出文件名
- 文件位置
- SHA-256
- 包大小
- 包含文件

已打包文件不自动安装，避免开发草稿覆盖当前运行版本。开发者可通过插件市场的“安装本地包”入口选择 `.nlplugin` 并按正常校验流程安装。

## 错误处理

错误使用稳定代码和可读中文消息：

- `MARKET_UNAVAILABLE`
- `MARKET_INDEX_INVALID`
- `DOWNLOAD_FAILED`
- `HASH_MISMATCH`
- `PACKAGE_INVALID`
- `PACKAGE_TOO_LARGE`
- `INCOMPATIBLE_VERSION`
- `PLUGIN_NOT_INSTALLED`
- `PLUGIN_ENTRY_MISSING`
- `PERMISSION_DENIED`
- `RUNTIME_TOKEN_INVALID`
- `PLUGIN_RUNTIME_FAILED`

错误详情不暴露非必要绝对路径。下载、解压、打包失败后清理临时文件。更新失败时保留旧激活版本。

## 验收标准

1. Creator 能编辑示例插件的 HTML、CSS 和 JavaScript，并生成真实 `.nlplugin`。
2. 相同内容连续打包得到相同 SHA-256。
3. 原生文件、Sidecar、路径穿越、符号链接和超限包均被拒绝。
4. Creator 能读取独立 GitHub 市场索引并展示插件状态。
5. 用户能从市场安装、更新、打开和卸载插件。
6. 更新下载或校验失败时旧版本仍可打开。
7. Notes 和 Stocks 无网络时仍可作为内置插件运行。
8. 市场插件默认沙箱，不能直接访问 Tauri、Node、宿主 DOM或网络。
9. 用户能把市场插件提升为可信并撤销；可信插件只能使用规定的 JS SDK，仍不能启动进程或加载原生代码。
10. 插件在主内容区运行，返回后不会残留有效运行令牌。
11. Windows x64 便携包解压后，插件、设置和草稿均写入旁边的 `Data` 目录。
12. GitHub Actions 构建成功并发布包含该功能的便携版 Release。
