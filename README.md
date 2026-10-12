# NextTools

NextTools is a desktop-first command launcher built with Electron, Vue 3, TypeScript, Pinia, and Cordis.

## Features

- Full-width command and application search, recent commands, pinned commands, and Windows Everything file search.
- Protected built-in search, settings, theme, and marketplace plugins composed through Cordis lifecycle effects.
- A marketplace backed by [NextLeek-Plugins](https://github.com/YUOOOOO/NextLeek-Plugins), accessible from Settings → Plugin Marketplace or its built-in command.
- Plugin pages hosted in independent sandboxed Electron `WebContentsView` surfaces, with verified static packages and a restricted bridge.
- Light, dark, and system themes, six accent colors, and configurable launcher and command shortcuts.
- Explicit Windows NSIS update check, download, install, and relaunch flow.

The launcher and basic settings pages use source components adapted from the MIT-licensed upstream project. Application search, file search, settings, theme, command shortcuts, and updates are owned by Cordis plugins. Account/sync, provider configuration, and AI integration are not included in this basic release.

Hiding and showing the window preserves the current page, search query, results, and an open plugin's live view. Escape navigates back one page level; in search it clears a nonempty query and otherwise stays at search. Escape at the top level does not hide the window. The launcher shortcut can toggle visibility; native window close hides rather than quits.

In the marketplace, Discover offers installation and available updates; Installed offers opening and package management. Back first closes an open plugin and returns to the list, then returns to the settings or installed-plugin menu used to enter the marketplace. The marketplace itself is part of the host UI; opened plugin content uses an independent view, not an iframe.

Installation, uninstall, and dependency-disabling confirmations stay inside the marketplace page, retaining permission and dependency details without moving focus to a native dialog that can hide the launcher.

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
