import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { unzipSync } from 'fflate'
import type { MarketEntry } from './shared'

export const CATALOG_URL = 'https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/index.json'
export const MAX_PACKAGE_BYTES = 16 * 1024 * 1024
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024
const MAX_FILES = 512
const utf8 = new TextDecoder('utf-8', { fatal: true })

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object')
  return value as Record<string, unknown>
}
function text(value: unknown, field: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`Invalid ${field}`)
  return value
}
export function pluginId(value: unknown): string {
  const id = text(value, 'plugin id', 128)
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id)) throw new TypeError('Invalid plugin id')
  return id
}
function version(value: unknown): string {
  const result = text(value, 'version', 64)
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(result)) throw new TypeError('Invalid version')
  return result
}
export function ensureCompatible(current: string, minimum: string): void {
  version(current); version(minimum)
  const [core, prerelease] = current.split('-')
  const [minCore, minPrerelease] = minimum.split('-')
  const actual = core!.split('.').map(Number)
  const required = minCore!.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (actual[index]! > required[index]!) return
    if (actual[index]! < required[index]!) throw new Error(`Plugin requires NextTools ${minimum} or newer`)
  }
  if (prerelease && !minPrerelease) throw new Error(`Plugin requires NextTools ${minimum} or newer`)
  if (prerelease && minPrerelease) {
    const a = prerelease.split('.'); const b = minPrerelease.split('.')
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if (a[index] === b[index]) continue
      const left = a[index]; const right = b[index]
      if (left === undefined) throw new Error(`Plugin requires NextTools ${minimum} or newer`)
      if (right === undefined) return
      const numericLeft = /^\d+$/.test(left); const numericRight = /^\d+$/.test(right)
      const comparison = numericLeft && numericRight ? Number(left) - Number(right) : numericLeft ? -1 : numericRight ? 1 : left < right ? -1 : 1
      if (comparison < 0) throw new Error(`Plugin requires NextTools ${minimum} or newer`)
      return
    }
  }
}
export function packageUrl(value: unknown): string {
  const input = text(value, 'package URL')
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.host !== 'raw.githubusercontent.com' || url.username || url.password || url.search || url.hash || !/^\/YUOOOOO\/NextLeek-Plugins\/main\/packages\/[a-zA-Z0-9._-]+\.nlplugin$/.test(url.pathname)) throw new Error('Package URL must be in the pinned NextLeek-Plugins repository')
  return input
}
function permissions(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError('Invalid permissions')
  if (value.length) throw new Error(`Unsupported plugin permissions: ${value.join(', ')}`)
  return []
}
export function marketEntry(value: unknown): MarketEntry {
  const entry = object(value)
  const sha256 = text(entry.sha256, 'SHA-256', 64)
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError('Invalid SHA-256')
  return { id: pluginId(entry.id), name: text(entry.name, 'name', 128), version: version(entry.version), description: text(entry.description, 'description'), author: text(entry.author, 'author', 128), sha256, packageUrl: packageUrl(entry.packageUrl), minCreatorVersion: version(entry.minCreatorVersion), permissions: permissions(entry.permissions) }
}
export function parseCatalog(bytes: Uint8Array): MarketEntry[] {
  const data = object(JSON.parse(utf8.decode(bytes)))
  if (data.schemaVersion !== 1 || !Array.isArray(data.plugins) || data.plugins.length > 500) throw new Error('Unsupported marketplace index')
  const entries = data.plugins.map(marketEntry)
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate marketplace plugin id')
  return entries
}
function safePath(name: string): void {
  if (!name || name.length > 512 || name.includes('\\') || /[\x00-\x1f]/.test(name) || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(part => part === '..' || part === '.')) throw new Error(`Unsafe package path: ${name}`)
}
// Inspect sizes and Unix file modes before fflate allocates decompressed buffers.
function inspectZip(bytes: Uint8Array): Set<string> {
  if (bytes.byteLength > MAX_PACKAGE_BYTES || bytes.byteLength < 22) throw new Error('Invalid or oversized plugin package')
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (data.getUint32(offset, true) === 0x06054b50 && offset + 22 + data.getUint16(offset + 20, true) === bytes.length) { end = offset; break }
  }
  if (end < 0 || data.getUint16(end + 4, true) || data.getUint16(end + 6, true)) throw new Error('Unsupported ZIP archive')
  const count = data.getUint16(end + 10, true)
  const centralSize = data.getUint32(end + 12, true)
  const centralOffset = data.getUint32(end + 16, true)
  if (!count || count > MAX_FILES || count !== data.getUint16(end + 8, true) || centralOffset + centralSize !== end) throw new Error('Invalid ZIP directory or file limit exceeded')
  const names = new Set<string>(); let total = 0; let offset = centralOffset
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP directory')
    const flags = data.getUint16(offset + 8, true)
    const method = data.getUint16(offset + 10, true)
    const compressed = data.getUint32(offset + 20, true)
    const expanded = data.getUint32(offset + 24, true)
    const length = data.getUint16(offset + 28, true)
    const extra = data.getUint16(offset + 30, true)
    const comment = data.getUint16(offset + 32, true)
    const local = data.getUint32(offset + 42, true)
    const next = offset + 46 + length + extra + comment
    if (next > end || flags & 1 || ![0, 8].includes(method) || data.getUint16(offset + 34, true)) throw new Error('Unsupported ZIP entry')
    const name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + length)); safePath(name)
    if (names.has(name)) throw new Error('Duplicate package path')
    names.add(name)
    const mode = data.getUint32(offset + 38, true) >>> 16
    if ((mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000)) throw new Error('Package symlinks and special files are forbidden')
    total += expanded
    if (expanded > MAX_EXPANDED_BYTES || total > MAX_EXPANDED_BYTES || compressed > MAX_PACKAGE_BYTES || local + 30 > centralOffset || data.getUint32(local, true) !== 0x04034b50) throw new Error('ZIP expansion limit exceeded or invalid entry')
    const localNameLength = data.getUint16(local + 26, true)
    const localExtraLength = data.getUint16(local + 28, true)
    if (local + 30 + localNameLength + localExtraLength + compressed > centralOffset || utf8.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name || data.getUint16(local + 6, true) !== flags || data.getUint16(local + 8, true) !== method) throw new Error('Mismatched ZIP entry')
    offset = next
  }
  if (offset !== end) throw new Error('Invalid ZIP directory size')
  return names
}
export interface VerifiedPackage { entry: string; files: Record<string, Uint8Array> }
export function verifyPackage(bytes: Uint8Array, catalog: MarketEntry, creatorVersion: string): VerifiedPackage {
  ensureCompatible(creatorVersion, catalog.minCreatorVersion)
  if (createHash('sha256').update(bytes).digest('hex') !== catalog.sha256) throw new Error('Plugin package SHA-256 verification failed')
  const names = inspectZip(bytes)
  const files = unzipSync(bytes)
  if (Object.keys(files).length !== names.size || Object.keys(files).some(name => !names.has(name)) || Object.values(files).reduce((sum, file) => sum + file.length, 0) > MAX_EXPANDED_BYTES) throw new Error('Invalid decompressed package')
  if (!files['manifest.json']) throw new Error('Plugin manifest is missing')
  const manifest = object(JSON.parse(utf8.decode(files['manifest.json'])))
  for (const key of ['id', 'name', 'version', 'description', 'author', 'minCreatorVersion'] as const) if (manifest[key] !== catalog[key]) throw new Error(`Plugin manifest ${key} does not match marketplace index`)
  permissions(manifest.permissions)
  if (manifest.capabilities !== undefined && (!Array.isArray(manifest.capabilities) || manifest.capabilities.length)) throw new Error('Unsupported plugin capabilities')
  const entry = text(manifest.entry, 'entry', 512); safePath(entry)
  if (!entry.endsWith('.html') || !files[entry]) throw new Error('Only existing static HTML plugin entries are supported')
  return { entry, files }
}
const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const bridge = `(()=>{let serial=0;const pending=new Map();window.addEventListener('message',event=>{const data=event.data;if(event.source!==parent||!data||data.type!=='nextleek:runtime-response'||typeof data.id!=='string')return;const item=pending.get(data.id);if(!item)return;pending.delete(data.id);clearTimeout(item.timer);data.error?item.reject(new Error(String(data.error))):item.resolve(data.result)});window.nextleek=Object.freeze({runtimeSummary:()=>new Promise((resolve,reject)=>{const id='summary-'+(++serial);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Runtime summary timed out'))},5000);pending.set(id,{resolve,reject,timer});parent.postMessage({type:'nextleek:runtime-request',id,method:'runtimeSummary'},'*')})})})();`
function escapeScript(source: string): string { return source.replace(/<\/script/gi, '<\\/script') }
export function renderPackage(pkg: VerifiedPackage): string {
  function resource(reference: string, origin: string): string {
    if (/[\x00-\x20\\]/.test(reference) || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(reference) || reference.includes('?') || reference.includes('#')) throw new Error(`Only local package assets are supported: ${reference}`)
    const path = posix.normalize(posix.join(posix.dirname(origin), reference)); safePath(path)
    if (!pkg.files[path]) throw new Error(`Package asset is missing: ${path}`)
    return path
  }
  function dataAsset(reference: string, origin: string): string {
    const path = resource(reference, origin)
    const type = mime[posix.extname(path).toLowerCase()]
    if (!type) throw new Error(`Unsupported static asset: ${path}`)
    return `data:${type};base64,${Buffer.from(pkg.files[path]!).toString('base64')}`
  }
  function css(source: string, origin: string): string {
    if (/@import\b/i.test(source)) throw new Error('CSS imports are unsupported; bundle styles in the package')
    return source.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote: string, ref: string) => `url("${dataAsset(ref, origin)}")`)
  }
  let html = utf8.decode(pkg.files[pkg.entry]!)
  const slots: string[] = []
  const marker = 'NEXTLEEK_VERIFIED_ASSET_'
  if (html.includes(marker)) throw new Error('Reserved package asset marker')
  function slot(content: string): string { return `<!--${marker}${slots.push(content) - 1}-->` }
  html = html.replace(/<meta\b[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '')
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_all, attrs: string, body: string) => {
    if (/\btype\s*=\s*['"]?module/i.test(attrs)) throw new Error('Module scripts must be bundled to a classic script')
    const source = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    if (source) { const path = resource(source[1] ?? source[2] ?? source[3]!, pkg.entry); if (!path.endsWith('.js')) throw new Error('Invalid script asset'); body = utf8.decode(pkg.files[path]!) }
    return slot(`<script>${escapeScript(body)}</script>`)
  })
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_all, source: string) => slot(`<style>${css(source, pkg.entry).replace(/<\/style/gi, '<\\/style')}</style>`))
  html = html.replace(/<link\b([^>]*)>/gi, (_all, attrs: string) => {
    const rel = /\brel\s*=\s*["']?([^\s"'>]+)/i.exec(attrs)?.[1]
    if (rel?.toLowerCase() !== 'stylesheet') throw new Error('Only local stylesheet links are supported')
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    if (!href) throw new Error('Stylesheet asset is missing')
    const path = resource(href[1] ?? href[2] ?? href[3]!, pkg.entry)
    if (!path.endsWith('.css')) throw new Error('Invalid stylesheet asset')
    return slot(`<style>${css(utf8.decode(pkg.files[path]!), path).replace(/<\/style/gi, '<\\/style')}</style>`)
  })
  // srcset and active embedded documents require a richer parser; reject rather than silently fetch.
  if (/\bsrcset\s*=|<(?:iframe|object|embed|frame)\b/i.test(html)) throw new Error('Embedded documents and srcset are unsupported')
  html = html.replace(/<[a-z][^>]*>/gi, tag => tag.replace(/\b(src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_all, attr: string, a: string, b: string, c: string) => `${attr}="${dataAsset(a ?? b ?? c, pkg.entry)}"`))
  html = html.replace(/\s+on[a-z][a-z0-9_-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  html = html.replace(/\s+(?:href|action|formaction|cite|ping)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  html = html.replace(/<!--NEXTLEEK_VERIFIED_ASSET_(\d+)-->/g, (_all, index: string) => slots[Number(index)]!)
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'"
  const prefix = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><script>${bridge}document.addEventListener('click',event=>{if(event.target.closest?.('a'))event.preventDefault()},true);document.addEventListener('submit',event=>event.preventDefault(),true);</script>`
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, match => match + prefix)
  return `<!doctype html><html><head>${prefix}</head><body>${html}</body></html>`
}
