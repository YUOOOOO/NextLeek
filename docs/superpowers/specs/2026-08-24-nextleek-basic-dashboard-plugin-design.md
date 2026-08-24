# NextLeek 基础仪表盘插件设计

## 目标

将插件市场中的旧 `Notes` 与 `Stocks` 示例插件替换为一个可安装、可运行、带应用菜单入口的基础插件，用于验证市场下载、安装、导航和运行链路。

## 产品形态

插件名称：`仪表盘`

插件 ID：`com.nextleek.dashboard`

版本：`1.0.0`

页面内容：

- 欢迎标题和插件说明
- 当前日期
- Creator 版本
- 插件运行状态
- 基础统计卡片：已安装插件数、运行模式、当前插件版本

页面使用插件运行时注入的安全数据；没有网络权限，不调用外部接口。日期由页面运行时生成，Creator 版本和插件状态由插件页面通过 SDK 获取；如果 SDK 数据不可用，页面显示明确的本地降级文本，不阻塞页面打开。

## 菜单接入

清单声明：

```json
"navigation": {
  "enabled": true,
  "label": "仪表盘",
  "order": 10
}
```

现有壳程序已经根据已安装插件的 `manifest.navigation` 动态生成左侧菜单，因此不新增硬编码菜单。点击菜单后，壳程序启动该插件并显示其页面。

## 包结构

```text
com.nextleek.dashboard-1.0.0.nlplugin
├─ manifest.json
└─ ui/
   ├─ index.html
   ├─ main.js
   └─ style.css
```

市场仓库只保留：

```text
index.json
packages/com.nextleek.dashboard-1.0.0.nlplugin
```

删除旧 `Notes` 和 `Stocks` 条目及包文件，避免市场继续展示已废弃插件。

## 数据流

```text
GitHub index.json
  -> 插件市场刷新
  -> 安装并校验 SHA-256
  -> 已安装插件列表
  -> 根据 navigation 生成左侧菜单
  -> launch_plugin_command
  -> sandbox iframe 加载 ui/index.html
  -> 页面通过 SDK 获取运行摘要
```

## 校验与安全

- 使用现有 Manifest 校验器和插件打包器，不新增并行协议。
- 权限数组为空，插件不访问网络和本地存储。
- 页面继续使用现有 sandbox 运行方式。
- 市场索引的 `packageUrl` 指向 `raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/...`。
- `sha256` 使用最终 `.nlplugin` 文件计算，不使用源码目录摘要。

## 验证

- 插件清单通过内核校验。
- `.nlplugin` 包包含四个必需文件：`manifest.json`、`ui/index.html`、`ui/main.js`、`ui/style.css`。
- 市场索引只包含 `com.nextleek.dashboard`。
- 前端测试覆盖：插件导航按钮存在、点击后打开运行页面。
- 通过现有 shell-ui 测试、类型检查和构建验证。
- 对生成包重新计算 SHA-256，并检查 GitHub Raw 地址可读。
