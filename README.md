# NextTools

NextTools is a desktop-first command launcher built with Electron, Vue 3, TypeScript, Pinia, and Cordis.

## Features

- ZTools-style launcher with full-width search results.
- Built-in application and Everything file search on Windows.
- Protected built-in search plugin with reversible Cordis lifecycle effects.
- Built-in plugin marketplace backed by [NextLeek-Plugins](https://github.com/YUOOOOO/NextLeek-Plugins).
- Sandboxed static plugin pages with verified package hashes and a read-only runtime summary bridge.
- Light, dark, system themes and configurable global shortcuts.
- Explicit Windows NSIS update check, download, install, and relaunch flow.

## Development

```text
pnpm install
pnpm check
pnpm dev
```

Build targets:

```text
pnpm build:win
pnpm build:mac
pnpm build:linux
```

## Windows distribution

Use the NSIS installer for automatic in-app updates:

- [Latest Windows installer](https://github.com/YUOOOOO/NextLeek/releases/latest)
- Portable ZIP builds are available for manual use but do not install updates automatically.

The application product name is **NextTools**. The stable Electron application ID remains `com.nextleek.desktop` so existing installation identity and user data remain compatible.
