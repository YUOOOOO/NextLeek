# Creator AI Plugin Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-page Creator AI workflow that generates validated plugin drafts through an OpenAI-compatible endpoint without replacing the existing draft/package path.

**Architecture:** Extend the shared `KernelApi` with AI settings and `generatePlugin`. Tauri stores the AI config in `Data/settings.json`, performs the HTTPS request in Rust, injects a fixed prompt, parses and validates a bounded JSON response, and exposes stable errors. The Vue Creator page displays a draft-only result in the existing 创造模式 and applies it only after explicit user action.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vitest, Rust, Tauri 2, reqwest, serde/serde_json.

---

### Task 1: Extend shared AI contracts and memory adapter

**Files:**
- Modify: `nextleek-v2/apps/shell-ui/src/api.ts`
- Modify: `nextleek-v2/apps/shell-ui/tests/api.spec.ts`
- Modify: `nextleek-v2/apps/shell-ui/tests/App.spec.ts`

- [x] Add `AiSettings`, `Settings.ai`, `PluginDraft`, `GeneratePluginRequest`, `GeneratePluginResponse`, and `KernelApi.generatePlugin`, `setAiSettings`.
- [x] Wire Tauri invoke names `generate_plugin_command` and `set_ai_settings_command`.
- [x] Make `createMemoryApi` return deterministic AI output and persist AI settings in memory.
- [x] Update all test API fixtures to satisfy the expanded interface.
- [x] Add tests proving AI output is returned and settings round-trip.
- [x] Run `pnpm --filter @nextleek/shell-ui test -- api.spec.ts` and expect PASS.

### Task 2: Add Rust AI settings and bounded response validation

**Files:**
- Modify: `nextleek-v2/apps/desktop/src-tauri/src/settings.rs`
- Modify: `nextleek-v2/apps/desktop/src-tauri/src/lib.rs`
- Modify: `nextleek-v2/apps/desktop/src-tauri/Cargo.toml` only if an existing dependency is insufficient

- [x] Add serde-defaulted `AiSettings` fields: `enabled`, `base_url`, `api_key`, `model`, `temperature`.
- [x] Validate HTTPS base URLs, non-empty model, finite temperature in `0..=2`, and reject oversized API keys/config values.
- [x] Preserve old `settings.json` files through serde defaults.
- [x] Define request/response structs with camelCase output compatibility.
- [x] Add a fixed Creator Skill prompt and a 2 MiB response limit.
- [x] Implement `generate_plugin` with reqwest JSON POST to `{base_url}/chat/completions`, timeout, authorization header, and structured JSON extraction.
- [x] Redact API keys from all returned errors.
- [x] Validate manifest/file paths and required `ui/index.html`, `ui/main.js`, `ui/style.css` before returning.
- [x] Add Tauri commands and register both commands.
- [ ] Add Rust unit tests for legacy settings load and response/path validation.
- [ ] Run `cargo test -p nextleek-desktop` and expect PASS.

### Task 3: Add Creator AI panel and settings controls

**Files:**
- Modify: `nextleek-v2/apps/shell-ui/src/App.vue`
- Modify: `nextleek-v2/apps/shell-ui/src/style.css`
- Modify: `nextleek-v2/apps/shell-ui/tests/App.spec.ts`

- [x] Load settings on mount and keep AI config separate from the draft.
- [x] Add AI prompt textarea, generate button, loading/error state, explanation, file list, and apply button inside 创造模式.
- [x] Send current manifest, current three editor files, and last validation errors to `generatePlugin`.
- [x] Apply returned data only after explicit click; do not alter editors on failed requests.
- [x] Add settings modal controls for enabled/base URL/model/API key/temperature and save through `setAiSettings`.
- [x] Ensure API key is never rendered after save and never included in error text.
- [x] Add tests for generate/apply flow and failed generation preserving existing editor content.
- [x] Run `pnpm --filter @nextleek/shell-ui test` and expect PASS.

### Task 4: Verify build and package path

**Files:**
- Modify: `docs/superpowers/plans/2026-08-24-nextleek-creator-ai.md` only if verification notes are needed

- [x] Run `pnpm --filter @nextleek/shell-ui typecheck`.
- [x] Run `pnpm --filter @nextleek/shell-ui build`.
- [ ] Run `cargo test --workspace` from `nextleek-v2` (blocked: Rust/Cargo is not installed locally).
- [x] Run the existing Tauri inspection command used by `.github/workflows/build-windows-portable.yml` up to environment inspection; local packaging is blocked by missing Rust/MSVC.
- [x] Verify the existing `create -> validate -> package` path still succeeds with generated editor contents through the UI tests and production build.
