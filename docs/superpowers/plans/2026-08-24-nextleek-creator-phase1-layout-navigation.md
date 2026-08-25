# NextLeek 第一阶段布局与插件导航实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固定 Creator 侧边栏并让右侧独立滚动，同时支持插件按 Manifest 配置是否注册侧边栏入口，并在 UI 中明确展示插件来源。

**Architecture:** Vue 壳将视口滚动隔离为固定侧栏和独立主内容滚动区。Manifest 增加可选 navigation 配置，Rust 在返回 PluginState 时附加不可伪造的 source 字段；UI 只根据 navigation.enabled 注册插件菜单，根据 source 显示来源标签。

**Tech Stack:** Vue 3 + TypeScript, Tauri 2, Rust/Serde, Vitest, Cargo tests.

---

### Task 1: 固定布局滚动边界

**Files:**
- Modify: `nextleek-v2/apps/shell-ui/src/style.css`
- Test: `nextleek-v2/apps/shell-ui/tests/App.spec.ts`

- [ ] 为 `.shell`、`aside`、`main` 建立 `height/min-height/overflow` 约束。
- [ ] 保持侧栏菜单不随主内容滚动。
- [ ] 在测试中断言布局类存在，并运行前端测试。

### Task 2: Manifest 增加侧边栏导航声明

**Files:**
- Modify: `nextleek-v2/crates/kernel/src/lib.rs`
- Modify: `nextleek-v2/schemas/plugin-manifest.schema.json`
- Modify: `nextleek-v2/apps/shell-ui/src/api.ts`
- Modify: `nextleek-v2/plugins/builtin/notes/manifest.json`
- Modify: `nextleek-v2/plugins/builtin/stocks/manifest.json`
- Test: `nextleek-v2/crates/kernel/tests/manifest.rs`

- [ ] 增加 `NavigationConfig { enabled, label, icon, order }`，默认 `enabled=false`。
- [ ] 校验 label 非空、icon 只能位于 `assets/`、order 使用默认值。
- [ ] Notes 配置启用侧边栏入口；Stocks 保持关闭，验证两种行为。

### Task 3: 标识官方、用户与本地插件来源

**Files:**
- Modify: `nextleek-v2/apps/desktop/src-tauri/src/lib.rs`
- Modify: `nextleek-v2/apps/shell-ui/src/api.ts`
- Modify: `nextleek-v2/apps/shell-ui/src/App.vue`
- Modify: `nextleek-v2/apps/shell-ui/src/style.css`
- Test: `nextleek-v2/apps/desktop/src-tauri/tests/commands.rs`
- Test: `nextleek-v2/apps/shell-ui/tests/App.spec.ts`

- [ ] 为 `PluginState` 增加 `source`，内置插件为 `builtin`，市场安装为 `official-market`，本地导入为 `local-import`。
- [ ] 禁止使用 Manifest.author 作为来源判定。
- [ ] 市场卡片和侧边栏菜单显示来源标签。
- [ ] 插件卸载后菜单和来源状态同步消失。

### Task 4: 第一阶段验证

**Files:**
- No new files.

- [ ] 运行 `pnpm test`。
- [ ] 运行 `pnpm build`。
- [ ] 若 Cargo 可用，运行 `cargo test --workspace`；否则记录环境阻塞。
- [ ] 检查 `git diff --check`。
