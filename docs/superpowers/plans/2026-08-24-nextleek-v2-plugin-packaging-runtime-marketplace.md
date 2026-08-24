# NextLeek v2 Plugin Packaging, Runtime, and Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver real `.nlplugin` packaging, local/remote installation, marketplace lifecycle management, and in-app JavaScript plugin execution for NextLeek Creator.

**Architecture:** Extend the Rust kernel with deterministic ZIP packages and an atomic installed-plugin store. Expose the store, GitHub marketplace client, runtime sessions, scoped SDK operations, and settings through Tauri commands; keep Vue responsible only for editing and presentation. Built-ins and remote packages share one manifest and runtime model, while trust is enforced in Rust.

**Tech Stack:** Rust 1.85, Tauri 2, serde, semver, zip, sha2, reqwest, uuid, Vue 3, TypeScript, Vitest.

---

### Task 1: Manifest and deterministic package format

**Files:**
- Modify: `nextleek-v2/Cargo.toml`
- Modify: `nextleek-v2/crates/kernel/Cargo.toml`
- Modify: `nextleek-v2/crates/kernel/src/lib.rs`
- Modify: `nextleek-v2/crates/kernel/tests/manifest.rs`
- Modify: `nextleek-v2/crates/kernel/tests/creator.rs`
- Modify: `nextleek-v2/schemas/plugin-manifest.schema.json`

- [ ] Extend manifest fixtures with `description`, `author`, `icon`, and required `minCreatorVersion`; verify invalid compatibility versions and unsafe icon paths fail.
- [ ] Run targeted manifest tests and confirm they fail because fields and validation are missing.
- [ ] Add optional display fields and required Creator compatibility field to Rust and JSON Schema.
- [ ] Add package tests proving a real ZIP is emitted, the declared entry exists, two builds are byte-identical, and native/sidecar/symlink/oversize content is rejected.
- [ ] Run package tests and confirm the packaging API is missing.
- [ ] Add `zip` and `sha2`; implement bounded file collection, fixed ZIP metadata, atomic output, SHA-256, package size, and inventory return.
- [ ] Run kernel tests and confirm all package and manifest contracts pass.

### Task 2: Atomic installed-plugin store

**Files:**
- Modify: `nextleek-v2/crates/kernel/src/lib.rs`
- Create: `nextleek-v2/crates/kernel/src/package.rs`
- Create: `nextleek-v2/crates/kernel/src/store.rs`
- Create: `nextleek-v2/crates/kernel/tests/store.rs`

- [ ] Write tests for install from bytes, hash mismatch, malformed archive, traversal entry, version activation, failed update preserving the prior active version, list state, and uninstall cleanup.
- [ ] Run store tests and confirm `PluginStore` is absent.
- [ ] Extract reusable package validation into `package.rs` and implement `PluginStore` with temporary extraction plus atomic active-record updates.
- [ ] Keep the public kernel API small: `install_package`, `list_installed`, `active_plugin`, `uninstall`, and package inspection.
- [ ] Run all kernel tests and confirm the existing creator and registry behavior remains green.

### Task 3: Built-in executable plugin resources

**Files:**
- Modify: `nextleek-v2/plugins/builtin/notes/manifest.json`
- Modify: `nextleek-v2/plugins/builtin/notes/ui/index.html`
- Create: `nextleek-v2/plugins/builtin/notes/ui/main.js`
- Create: `nextleek-v2/plugins/builtin/notes/ui/style.css`
- Modify: `nextleek-v2/plugins/builtin/stocks/manifest.json`
- Modify: `nextleek-v2/plugins/builtin/stocks/ui/index.html`
- Create: `nextleek-v2/plugins/builtin/stocks/ui/main.js`
- Create: `nextleek-v2/plugins/builtin/stocks/ui/style.css`
- Modify: `nextleek-v2/apps/desktop/src-tauri/Cargo.toml`
- Modify: `nextleek-v2/apps/desktop/src-tauri/src/lib.rs`
- Modify: `nextleek-v2/apps/desktop/src-tauri/tests/commands.rs`

- [ ] Write command integration tests proving built-ins expose complete source files, are available offline, and are marked trusted.
- [ ] Run the command test and confirm current built-ins only expose manifests.
- [ ] Add usable Notes and Stocks HTML/CSS/JS resources; embed each directory at compile time and provision it into the installed store on startup.
- [ ] Make provisioning idempotent and ensure a remote update does not inherit built-in trust.
- [ ] Run desktop command tests.

### Task 4: Marketplace, settings, and lifecycle commands

**Files:**
- Modify: `nextleek-v2/apps/desktop/src-tauri/Cargo.toml`
- Create: `nextleek-v2/apps/desktop/src-tauri/src/marketplace.rs`
- Create: `nextleek-v2/apps/desktop/src-tauri/src/settings.rs`
- Modify: `nextleek-v2/apps/desktop/src-tauri/src/lib.rs`
- Modify: `nextleek-v2/apps/desktop/src-tauri/tests/commands.rs`

- [ ] Write tests with a local HTTP fixture for valid index loading and bounded package download; add invalid schema, HTTP URL, oversized response, hash mismatch, and incompatible-version cases.
- [ ] Run targeted tests and confirm marketplace commands are absent.
- [ ] Implement the schema-v1 marketplace client with HTTPS enforcement in production, bounded redirects/timeouts/body sizes, and typed errors.
- [ ] Implement atomic `settings.json` with default `YUOOOOO/NextLeek-Plugins` raw index URL and per-plugin trust overrides.
- [ ] Expose commands for refresh market, list installed, install/update, local package install, uninstall, read settings, update market URL, promote trust, and revoke trust.
- [ ] Run desktop command tests.

### Task 5: Runtime session and trusted SDK boundary

**Files:**
- Create: `nextleek-v2/apps/desktop/src-tauri/src/runtime.rs`
- Modify: `nextleek-v2/apps/desktop/src-tauri/src/lib.rs`
- Modify: `nextleek-v2/apps/desktop/src-tauri/tests/commands.rs`

- [ ] Write tests proving launch returns an entry document plus random token, asset reads stay under plugin root, closing invalidates the token, and uninstalled IDs fail.
- [ ] Write permission tests proving sandbox plugins cannot use filesystem/network, trusted plugins can use text filesystem operations and HTTPS, and shell/process/native loading methods are never registered.
- [ ] Run tests and confirm runtime APIs are missing.
- [ ] Implement in-memory runtime sessions bound to plugin ID/version/root and trust state.
- [ ] Implement bounded UTF-8 resource loading and SDK dispatch for private storage, trusted filesystem text operations, and HTTPS fetch.
- [ ] Re-evaluate trust on every request so revocation takes effect immediately.
- [ ] Expose Tauri commands `launch_plugin`, `read_plugin_asset`, `plugin_sdk_call`, and `close_plugin`.
- [ ] Run desktop tests.

### Task 6: Shell API and product navigation

**Files:**
- Modify: `nextleek-v2/apps/shell-ui/src/api.ts`
- Modify: `nextleek-v2/apps/shell-ui/src/App.vue`
- Modify: `nextleek-v2/apps/shell-ui/src/style.css`
- Modify: `nextleek-v2/apps/shell-ui/src/main.ts`
- Modify: `nextleek-v2/apps/shell-ui/tests/api.spec.ts`
- Modify: `nextleek-v2/apps/shell-ui/tests/App.spec.ts`

- [ ] Write API adapter tests for package result, marketplace state, install/update/uninstall, runtime launch/close, trust settings, and SDK requests.
- [ ] Write component tests proving sidebar contains only 首页/创造模式/插件市场, version is bottom-left, settings is bottom-right, marketplace state drives action buttons, and opening a plugin replaces main content with a return action.
- [ ] Run Vitest and confirm failures against the current shell.
- [ ] Expand `KernelApi` and the browser memory adapter to the same observable contract as Tauri.
- [ ] Rebuild `App.vue` around three pages plus settings and runtime subviews; include Manifest/HTML/CSS/JS editing and real package result display.
- [ ] Implement runtime iframe `srcdoc` assembly with `sandbox="allow-scripts"`, strict CSP, injected `window.nextleek`, request correlation, timeout, and teardown.
- [ ] Implement marketplace status/actions and explicit trust warning confirmation.
- [ ] Replace the one-line stylesheet with maintainable responsive layout styles while preserving the existing dark green visual identity.
- [ ] Run Vitest, typecheck, and frontend production build.

### Task 7: Independent plugin marketplace repository

**Files in `YUOOOOO/NextLeek-Plugins`:**
- Create: `index.json`
- Create: `packages/com.nextleek.notes-1.0.0.nlplugin`
- Create: `packages/com.nextleek.stocks-1.0.0.nlplugin`
- Create: `README.md`

- [ ] Generate built-in packages using the implemented deterministic packer.
- [ ] Compute package SHA-256 values and build schema-v1 `index.json` with raw GitHub package URLs.
- [ ] Create `YUOOOOO/NextLeek-Plugins` if absent, push the marketplace files, and verify the raw index and package URLs return the expected bytes.
- [ ] Exercise Creator against the real remote index and verify installed/latest/update status calculation.

### Task 8: End-to-end verification and release

**Files:**
- Modify as required by verification failures only.

- [ ] Run `cargo test --workspace` from `nextleek-v2`.
- [ ] Run `cargo clippy --workspace --all-targets -- -D warnings` when the local Rust toolchain is available; otherwise rely on the identical GitHub runner step and state the local limitation.
- [ ] Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from `nextleek-v2`.
- [ ] Launch the shell in a real browser, create and package a JS plugin, install it through the marketplace flow, open it in the main content area, return, and uninstall it.
- [ ] Review the final changed-file set and ensure unrelated strategy-api artifacts remain untracked and uncommitted.
- [ ] Commit implementation changes, push `dev`, create the next unused `v*` tag, and wait for GitHub Actions.
- [ ] Verify the Actions run succeeds, the GitHub Release exists, and both portable ZIP and SHA-256 assets are downloadable.
