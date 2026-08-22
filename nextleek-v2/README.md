# NextLeek Creator MVP

Rust 微内核 + Tauri 2 配置 + Vue 3 桌面壳的声明式插件 Creator MVP。

## 开发校验

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm --filter @nextleek/shell-ui test
pnpm typecheck
pnpm build
```

MVP 禁止原生插件、任意 Sidecar 与可执行文件。Creator 草稿和已安装插件目录由 Rust 强制隔离。
