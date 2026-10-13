# NextTools

NextTools is a desktop-first command launcher built with Electron, Vue 3, TypeScript, Pinia, and Cordis.

## Features

- Full-width command and application search, recent commands, pinned commands, and Windows Everything file search.
- Protected built-in search, settings, theme, and marketplace plugins composed through Cordis lifecycle effects.
- A marketplace backed by [NextLeek-Plugins](https://github.com/YUOOOOO/NextLeek-Plugins), accessible from Settings → Plugin Marketplace or its built-in command.
- Plugin pages hosted in independent sandboxed Electron `WebContentsView` surfaces, with verified static packages and a restricted bridge.
- Light, dark, and system themes, six accent colors, and configurable launcher and command shortcuts.
- General Settings online updates: current version, manual check/download/restart installation, automatic checks, and opt-in GitHub prerelease updates. Downloads and installation always require user action; Windows NSIS installations support online installation, while portable ZIP builds update manually.

The launcher and settings use the original MIT-licensed source pages, including their templates, styles, router, state, and handlers. Their native calls are adapted to Cordis-owned application search, file search, settings, shortcuts, HTTP, local-launch, floating-ball, and SuperPanel services. Account/sync, provider configuration, and AI integration are not included in this basic release.

Hiding and showing the window preserves the current page, search query, results, and an open plugin's live view. Escape navigates back one page level from settings and plugins; in search it hides the window without clearing the query. The search window has a fixed width, cannot be manually resized, and grows with results up to its height limit; excess results scroll vertically. The launcher shortcut can toggle visibility; native window close hides rather than quits.

The plugin marketplace and installed-plugin manager are host Vue pages. Closing an opened package returns to the originating marketplace or installed-plugin list. Opened plugin content uses an independent native view, not an iframe; closing it ends that session, and reopening creates a new one.

Marketplace downloads install approved static packages directly after host validation; there is no separate installation-permission dialog. Package permissions must be empty. Package management retains the source page's confirmations. Local executable registration separately requires a native approval dialog; it is not a marketplace package or an authorization bypass.

## Plugin contracts

There are two separate deployment paths:

- **Marketplace `.nlplugin` packages** are ZIP archives containing `manifest.json` and static HTML/JS/CSS/assets. They are hash-, path-, version-, and declaration-checked before installation. They cannot execute a Node plugin or import arbitrary host services. The dedicated bridge exposes a read-only runtime summary and declared data-source method calls; the host validates dependencies and performs those requests. Direct page networking, Node integration, popups, and external navigation are blocked.
- **Trusted deployed Cordis plugins** are selected by entries in the deployed `cordis.patch.yml`, not installed from the marketplace. Their package-root `plugin.json` declares a Node entry, compatible `engines.dsh`, and `contributes.tools` / `contributes.skills`. An optional Browser half additionally requires a bare package name, `package.json` with `dsh.client.platform: "web"`, and a matching `./client` export. The Node half runs with host trust; this is not a security sandbox for untrusted packages.

Tools and skills register with the plugin's owning Cordis context: `ctx.tools.register(ctx, name, definition)` and `ctx.skills.register(ctx, name, content)`. Contributions, generated launcher commands, Browser sessions, and native views are reversible lifecycle resources. See [agent.md](agent.md) for the precise loader and ownership contract. General Node package installation, marketplace Node execution, and plugin hot reload are not provided by these contracts.

## Development

For an already provisioned development environment:

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

Do not install a local development toolchain when the work is restricted to existing tools; use the repository's GitHub Actions Windows packaging workflow for release builds in that case.

## Windows distribution

Use the NSIS installer for automatic in-app updates:

- [Latest Windows installer](https://github.com/YUOOOOO/NextLeek/releases/latest)
- Portable ZIP builds are available for manual use but do not install updates automatically.

The Windows release workflow builds once, verifies the portable package structure and checksum, and checks NSIS installation integrity before publishing. Interactive launcher, native-search, marketplace, and installed-upgrade smoke scenarios remain available as standalone scripts; they do not block release packaging.

The application product name is **NextTools**. The stable Electron application ID remains `com.nextleek.desktop` so existing installation identity and user data remain compatible.

Copied product components retain their upstream MIT copyright and permission notice in [the bundled attribution file](resources/icons/ZTools-LICENSE). `electron-builder.yml` includes this file in distributed `icons/` resources; retain it when redistributing those components. Windows Everything resources also include their own license notices through the `LICENSE-*` resource filter.
