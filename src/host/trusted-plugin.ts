import { Context, Inject, type Plugin } from '@deepseek-ai/cordis'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { randomBytes } from 'node:crypto'
import type { ClientModuleDefinition } from './services/client-modules'

interface TrustedManifest {
  id: string; name?: string; version: string; main: string; description?: string; author?: string
  engines: { dsh: string }
  contributes: { tools: string[]; skills: string[] }
  client?: { main: string; inject: string[] }
}

// 从部署根解析包与相对路径，不依赖编译后 composition 文件所在目录。
export async function loadTrustedPlugin(name: string, root: string, hostVersion: string, compositionId?: string): Promise<Plugin> {
  const require = createRequire(resolve(root, 'package.json'))
  const semver = require('semver') as { valid(value: string): string | null; validRange(value: string): string | null; satisfies(value: string, range: string): boolean }
  const entry = name.startsWith('.') || isAbsolute(name) ? resolve(root, name) : require.resolve(name)
  let directory = dirname(entry)
  while (!existsSync(resolve(directory, 'package.json')) && dirname(directory) !== directory) directory = dirname(directory)
  const packageJson = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { name?: string; dsh?: { client?: { platform?: string } } }
  const manifestPath = resolve(directory, 'plugin.json')
  if (!existsSync(manifestPath)) throw new Error(`Trusted plugin requires plugin.json: ${name}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as TrustedManifest
  if (!manifest || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(manifest.id) || !semver.valid(manifest.version) || !manifest.engines || !semver.validRange(manifest.engines.dsh) || !semver.satisfies(hostVersion, manifest.engines.dsh)) throw new Error(`Invalid or incompatible trusted manifest: ${name}`)
  if (!manifest.contributes || !Array.isArray(manifest.contributes.tools) || !Array.isArray(manifest.contributes.skills)) throw new Error(`Trusted plugin requires contributes.tools and contributes.skills: ${name}`)
  for (const declarations of [manifest.contributes.tools, manifest.contributes.skills]) {
    if (declarations.some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(value)) || new Set(declarations).size !== declarations.length) throw new Error(`Invalid contribution declarations: ${name}`)
  }
  const inside = (path: string) => {
    if (typeof path !== 'string' || !path) throw new Error(`Missing plugin entry: ${name}`)
    const target = resolve(directory, path)
    const local = relative(directory, target)
    if (local.startsWith('..') || isAbsolute(local)) throw new Error(`Plugin entry escapes package: ${name}`)
    return target
  }
  const imported = await import(pathToFileURL(inside(manifest.main)).href)
  const nodePlugin = imported.default as Plugin
  if (!nodePlugin || (typeof nodePlugin !== 'function' && (typeof nodePlugin !== 'object' || typeof nodePlugin.apply !== 'function'))) throw new Error(`Invalid Node plugin export: ${name}`)
  let html: string | undefined
  if (manifest.client || packageJson.dsh?.client) {
    if (name.startsWith('.') || isAbsolute(name) || packageJson.name !== name || packageJson.dsh?.client?.platform !== 'web' || !manifest.client || !Array.isArray(manifest.client.inject) || manifest.client.inject.some(value => value !== '@deepseek-ai/dsh-client-runtime')) throw new Error(`Browser halves require a bare package name and dsh.client.platform=web: ${name}`)
    const exportedClient = require.resolve(`${name}/client`)
    if (resolve(exportedClient) !== inside(manifest.client.main)) throw new Error(`Browser export does not match manifest: ${name}`)
    const clientSource = `import { Context } from '@deepseek-ai/cordis'; import plugin from ${JSON.stringify(exportedClient)};
const ctx = new Context();
ctx.provide('@deepseek-ai/dsh-client-runtime', Object.freeze({ root: document.getElementById('plugin-root'), invokeTool: (name, args = {}) => window.nextleek.invokeTool(name,args), readSkill: name => window.nextleek.readSkill(name) }));
const fiber = ctx.plugin(plugin);
ctx.effect(() => { const dispose = () => { void ctx.fiber.dispose() }; window.addEventListener('pagehide', dispose); return () => window.removeEventListener('pagehide', dispose) });
fiber.await().catch(error => { document.getElementById('plugin-root').textContent = error.message; void ctx.fiber.dispose() });`
    const bundle = await build({ stdin: { contents: clientSource, resolveDir: root, sourcefile: 'trusted-client.ts', loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome134', minify: true })
    const nonce = randomBytes(18).toString('base64')
    const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
    html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"></head><body><main id="plugin-root"></main><script nonce="${nonce}">${js}</script></body></html>`
  }
  return {
    name: manifest.id,
    inject: { ...Inject.resolve(nodePlugin.inject), tools: null, skills: null, ...(html ? { clientModules: null } : {}) },
    async apply(ctx: Context, config: unknown) {
      // Node 半面的依赖注入由其自身 Fiber 管理；失败会随包装 Fiber 一起回滚。
      const child = ctx.plugin(nodePlugin, config)
      await child.await()
      const verify = () => {
        for (const kind of ['tools', 'skills'] as const) for (const declaration of manifest.contributes[kind]) if (!ctx[kind].has(declaration, child.ctx)) throw new Error(`Unregistered ${kind} declaration: ${manifest.id}/${declaration}`)
      }
      verify()
      if (html) {
        const definition: ClientModuleDefinition = {
          metadata: { id: compositionId || manifest.id, name: manifest.name || packageJson.name || manifest.id, version: manifest.version, description: manifest.description || '', author: manifest.author || '', enabled: true, deploymentManaged: true }, html,
          async invoke(method, args) {
            if (method === 'runtimeSummary') return { version: hostVersion, platform: process.platform, mode: 'desktop', status: 'ready', installed: ctx.clientModules.list().length, enabled: ctx.clientModules.list().length }
            if (!args || typeof args !== 'object') throw new TypeError('Invalid tool request')
            const input = args as { kind?: string; name?: string; args?: Record<string, unknown> }
            if ((input.kind !== 'tools' && input.kind !== 'skills') || typeof input.name !== 'string' || !manifest.contributes[input.kind].includes(input.name) || !input.args || typeof input.args !== 'object' || Array.isArray(input.args)) throw new Error('Undeclared browser capability')
            return ctx[input.kind].invoke(input.name, input.args)
          },
        }
        ctx.clientModules.register(ctx, definition)
      }
    },
  }
}
