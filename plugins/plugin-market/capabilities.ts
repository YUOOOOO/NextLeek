import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { pipeline, Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { CapabilityRequirement, DataSourceDeclaration, DataSourceMethod, MarketManifest, SourceAuthentication } from './shared'

const nativeFetch = globalThis.fetch
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_ARGUMENT_BYTES = 64 * 1024
const unsafeKeys: Record<string, true> = { ['__proto__']: true, prototype: true, constructor: true } as const
// Explicit credential names, not a substring heuristic: e.g. passwordResetCount is ordinary data.
const credentialKeys: Record<string, true> = { password: true, passwd: true, secret: true, authorization: true, cookie: true, setcookie: true, accesstoken: true, refreshtoken: true, apikey: true, sessiontoken: true }
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '')
const sensitiveKey = (key: string): boolean => unsafeKeys[key.toLowerCase()] === true || credentialKeys[normalizeKey(key)] === true

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError('Expected a plain object')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => unsafeKeys[key.toLowerCase()] === true)) throw new TypeError('Reserved object key')
  return result
}
function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  const result = record(value)
  if (Object.keys(result).some(key => !allowed.includes(key))) throw new TypeError('Unknown declaration field')
  return result
}
function string(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || !value.length || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError(`Invalid ${label}`)
  return value
}
function id(value: unknown): string {
  const result = string(value, 'capability id', 128)
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(result) || unsafeKeys[result] === true) throw new TypeError('Invalid capability id')
  return result
}
function methodName(value: unknown): string {
  const result = string(value, 'method name', 64)
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(result) || sensitiveKey(result)) throw new TypeError('Invalid method name')
  return result
}
export function validateVersion(value: unknown): string {
  const result = string(value, 'version', 64)
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(result)) throw new TypeError('Invalid version')
  const prerelease = result.split('+')[0]!.split('-').slice(1).join('-')
  if (prerelease.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) throw new TypeError('Invalid prerelease version')
  return result
}
export function compareVersions(left: string, right: string): number {
  validateVersion(left); validateVersion(right)
  const parse = (value: string): [string[], string[] | undefined] => {
    const clean = value.split('+')[0]!
    const dash = clean.indexOf('-')
    return [clean.slice(0, dash < 0 ? clean.length : dash).split('.'), dash < 0 ? undefined : clean.slice(dash + 1).split('.')]
  }
  const [a, ap] = parse(left); const [b, bp] = parse(right)
  for (let index = 0; index < 3; index++) {
    const x = BigInt(a[index]!); const y = BigInt(b[index]!)
    if (x !== y) return x > y ? 1 : -1
  }
  if (!ap || !bp) return ap ? -1 : bp ? 1 : 0
  for (let index = 0; index < Math.max(ap.length, bp.length); index++) {
    const x = ap[index]; const y = bp[index]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number, number]
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) !== 6) return false
  // Only global-unicast space; exclude transition, benchmarking and documentation space.
  const parts = address.toLowerCase().split(':')
  const first = parseInt(parts[0] || '0', 16); const second = parseInt(parts[1] || '0', 16)
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff && !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8))
}
function sourceUrl(value: unknown): string {
  const input = string(value, 'source origin', 512)
  const url = new URL(input)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || /[\s\\]/.test(input) || (input !== url.origin && input !== `${url.origin}/`)) throw new TypeError('Source URL must be a fixed HTTPS origin')
  if (isIP(hostname) ? !publicAddress(hostname) : !hostname.includes('.') || hostname.endsWith('.') || /(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion|arpa|home|lan)$/.test(hostname)) throw new Error('Source host must be public')
  return url.origin
}
function endpointPath(value: unknown): string {
  const result = string(value, 'endpoint path', 512)
  if (!/^\/[A-Za-z0-9_./~-]*$/.test(result) || result.includes('//') || result.split('/').some(part => part === '.' || part === '..')) throw new TypeError('Invalid fixed endpoint path')
  return result
}
function parseMethod(value: unknown): DataSourceMethod {
  const item = fields(value, ['name', 'method', 'path', 'timeoutMs', 'parameters'])
  if (item.method !== 'GET' && item.method !== 'POST') throw new TypeError('Unsupported source HTTP method')
  const timeoutMs = item.timeoutMs === undefined ? 10_000 : item.timeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 20_000) throw new TypeError('Invalid source timeout')
  let parameters: DataSourceMethod['parameters']
  if (item.parameters !== undefined) {
    const values = record(item.parameters)
    if (Object.keys(values).length > 64) throw new TypeError('Too many source parameters')
    parameters = {}
    for (const [key, type] of Object.entries(values)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || sensitiveKey(key) || (type !== 'string' && type !== 'number' && type !== 'boolean')) throw new TypeError('Invalid source parameter')
      parameters[key] = type
    }
  }
  return { name: methodName(item.name), method: item.method, path: endpointPath(item.path), timeoutMs, ...(parameters ? { parameters } : {}) }
}
function parseSource(value: unknown): DataSourceDeclaration {
  const item = fields(value, ['id', 'version', 'baseUrl', 'methods', 'authentication'])
  if (!Array.isArray(item.methods) || !item.methods.length || item.methods.length > 64) throw new TypeError('Invalid source methods')
  const methods = item.methods.map(parseMethod)
  if (new Set(methods.map(method => method.name)).size !== methods.length) throw new TypeError('Duplicate source method')
  let authentication: DataSourceDeclaration['authentication']
  if (item.authentication !== undefined) {
    const auth = fields(item.authentication, ['path', 'passwordField', 'cookieName'])
    const passwordField = string(auth.passwordField, 'password field', 64)
    const cookieName = string(auth.cookieName, 'cookie name', 128)
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(passwordField) || unsafeKeys[passwordField.toLowerCase()] === true || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookieName) || unsafeKeys[cookieName.toLowerCase()] === true) throw new TypeError('Invalid source authentication')
    authentication = { path: endpointPath(auth.path), passwordField, cookieName }
    if (methods.some(method => method.path === authentication!.path || Object.keys(method.parameters ?? {}).some(key => normalizeKey(key) === normalizeKey(passwordField) || normalizeKey(key) === normalizeKey(cookieName)))) throw new Error('Authentication endpoint and fields are reserved')
  }
  return { id: id(item.id), version: validateVersion(item.version), baseUrl: sourceUrl(item.baseUrl), methods, ...(authentication ? { authentication } : {}) }
}
function parseRequirement(value: unknown): CapabilityRequirement {
  const item = fields(value, ['sourcePluginId', 'sourceId', 'minVersion', 'methods'])
  if (!Array.isArray(item.methods) || !item.methods.length || item.methods.length > 64) throw new TypeError('Invalid required methods')
  const methods = item.methods.map(methodName)
  if (new Set(methods).size !== methods.length) throw new TypeError('Duplicate required method')
  return { sourcePluginId: id(item.sourcePluginId), sourceId: id(item.sourceId), minVersion: validateVersion(item.minVersion), methods }
}
export function validateDeclarations(value: unknown): { dataSources?: DataSourceDeclaration[]; requires?: CapabilityRequirement[] } {
  const item = record(value)
  const result: { dataSources?: DataSourceDeclaration[]; requires?: CapabilityRequirement[] } = {}
  if (item.dataSources !== undefined) {
    if (!Array.isArray(item.dataSources) || item.dataSources.length > 32) throw new TypeError('Invalid data sources')
    result.dataSources = item.dataSources.map(parseSource)
    if (new Set(result.dataSources.map(source => source.id)).size !== result.dataSources.length) throw new TypeError('Duplicate data source')
  }
  if (item.requires !== undefined) {
    if (!Array.isArray(item.requires) || item.requires.length > 32) throw new TypeError('Invalid capability requirements')
    result.requires = item.requires.map(parseRequirement)
    if (new Set(result.requires.map(requirement => `${requirement.sourcePluginId}/${requirement.sourceId}`)).size !== result.requires.length) throw new TypeError('Duplicate capability requirement')
  }
  return result
}
export function dependencyErrors(consumer: MarketManifest, providers: MarketManifest[]): string[] {
  const errors: string[] = []
  for (const requirement of consumer.requires ?? []) {
    const provider = providers.find(item => item.id === requirement.sourcePluginId)
    const source = provider?.dataSources?.find(item => item.id === requirement.sourceId)
    const label = `${requirement.sourcePluginId}/${requirement.sourceId}`
    if (!source) errors.push(`Required data source ${label} is unavailable`)
    else if (source.version.split('.')[0] !== requirement.minVersion.split('.')[0] || compareVersions(source.version, requirement.minVersion) < 0) errors.push(`Data source ${label} requires compatible version ${requirement.minVersion} or newer within the same major`)
    else for (const method of requirement.methods) if (!source.methods.some(item => item.name === method)) errors.push(`Data source ${label} does not provide ${method}`)
  }
  return errors
}

interface RequestOptions { fetch: typeof globalThis.fetch; signal: AbortSignal; cookie?: string }
function cancellable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    if (signal.aborted) { operation.catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
async function resolvePublic(url: URL, signal: AbortSignal): Promise<{ address: string; family: number }> {
  signal.throwIfAborted()
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await cancellable(lookup(hostname, { all: true, verbatim: true }), signal)
  signal.throwIfAborted()
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Source DNS must resolve only to public addresses')
  return addresses[0]!
}
export function decodeSourceBody(readable: Readable, encoding?: string | null): Readable {
  if (encoding == null) return readable
  const encodings = encoding.split(',').map(value => value.trim().toLowerCase())
  if (encodings.some(value => !['identity', 'gzip', 'deflate', 'br'].includes(value))) throw new Error('Unsupported source content encoding')
  const decoders = encodings.reverse().filter(value => value !== 'identity').map(value => value === 'gzip' ? createGunzip() : value === 'deflate' ? createInflate() : createBrotliDecompress())
  if (!decoders.length) return readable
  // Pipeline propagates decoder errors and cancellation back to the raw response.
  pipeline([readable, ...decoders], () => {})
  return decoders[decoders.length - 1]!
}
async function send(url: URL, init: RequestInit, transport: typeof globalThis.fetch, signal: AbortSignal): Promise<Response> {
  const address = await resolvePublic(url, signal)
  // Production pins the validated address: a second DNS lookup would allow rebinding.
  // Substituted fetch is a trusted host/test transport, never supplied by a market package.
  if (transport !== nativeFetch) return cancellable(transport(url, { ...init, signal, redirect: 'error', credentials: 'omit' }), signal)
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, {
      method: init.method, headers: init.headers as Record<string, string>, signal, agent: false, family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, response => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode > 599) { response.destroy(); reject(new Error('Invalid source response status')); return }
      if (response.statusCode! >= 300 && response.statusCode! < 400) { response.destroy(); reject(new Error('Source redirects are forbidden')); return }
      try {
        const headers = new Headers()
        for (let index = 0; index < response.rawHeaders.length; index += 2) headers.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!)
        const status = response.statusCode ?? 502
        const decoded = decodeSourceBody(response, headers.get('content-encoding'))
        if (decoded !== response) headers.delete('content-length')
        headers.delete('content-encoding')
        const body = status === 204 || status === 205 || status === 304 ? null : Readable.toWeb(decoded) as ReadableStream<Uint8Array>
        if (!body) decoded.resume()
        resolve(new Response(body, { status, headers }))
      } catch (error) { response.destroy(); reject(error) }
    })
    req.on('error', reject)
    req.end(typeof init.body === 'string' ? init.body : undefined)
  })
}
async function boundedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) { void response.body?.cancel().catch(() => {}); throw new Error('Source response is too large') }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const chunk = await cancellable(reader.read(), signal)
      if (chunk.done) break
      size += chunk.value.length
      if (size > MAX_RESPONSE_BYTES) throw new Error('Source response is too large')
      chunks.push(chunk.value)
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
function validateResult(value: unknown, source: DataSourceDeclaration, cookie?: string, depth = 0): void {
  if (depth > 32) throw new Error('Source JSON is too deeply nested')
  const cookieValue = cookie?.slice(cookie.indexOf('=') + 1)
  if (typeof value === 'string') {
    if (cookieValue && value.includes(cookieValue)) throw new Error('Source response contains authentication material')
    return
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid JSON number')
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey(key) || (cookieValue && key.includes(cookieValue)) || (source.authentication && [source.authentication.passwordField, source.authentication.cookieName].some(field => normalizeKey(key) === normalizeKey(field)))) throw new Error('Source response contains a reserved credential key')
    validateResult(child, source, cookie, depth + 1)
  }
}
function cookieHeader(source: DataSourceDeclaration, cookie?: string): string | undefined {
  if (!source.authentication) { if (cookie !== undefined) throw new Error('Source does not declare authentication'); return undefined }
  const prefix = `${source.authentication.cookieName}=`
  if (!cookie || !cookie.startsWith(prefix) || cookie.length > 4096 || !/^[\x21-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(cookie.slice(prefix.length))) throw new Error('Data source is not authenticated')
  return cookie
}
export async function executeSource(declaration: DataSourceDeclaration, name: string, args: unknown, options: RequestOptions): Promise<unknown> {
  const source = parseSource(declaration)
  const method = source.methods.find(item => item.name === name)
  if (!method) throw new Error('Unknown source method')
  const input = record(args)
  const parameters: Record<string, string | number | boolean> = {}
  if (Object.keys(input).length > 64) throw new TypeError('Too many capability arguments')
  for (const [key, value] of Object.entries(input)) {
    const type = method.parameters?.[key]
    if (!type || typeof value !== type || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 8192)) throw new TypeError('Invalid capability argument')
    parameters[key] = value as string | number | boolean
  }
  const json = JSON.stringify(parameters)
  if (Buffer.byteLength(json) > MAX_ARGUMENT_BYTES) throw new Error('Capability arguments are too large')
  const url = new URL(method.path, source.baseUrl)
  if (method.method === 'GET') for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value))
  const cookie = cookieHeader(source, options.cookie)
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(method.timeoutMs)])
  try {
    const response = await send(url, { method: method.method, headers: { Accept: 'application/json', ...(method.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(method.method === 'POST' ? { body: json } : {}) }, options.fetch, signal)
    if (response.redirected || !response.ok) { void response.body?.cancel().catch(() => {}); throw new Error(`Source request failed (${response.status})`) }
    if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { void response.body?.cancel().catch(() => {}); throw new Error('Source response must be JSON') }
    const bytes = await boundedBody(response, signal)
    signal.throwIfAborted()
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    validateResult(result, source, cookie)
    return result
  } catch {
    // Network errors may embed request details. Never relay them or remote response bodies.
    if (signal.aborted) throw new Error(options.signal.aborted ? 'Capability request cancelled' : 'Capability request timed out')
    throw new Error('Source request failed or returned unsafe data')
  }
}
export async function authenticateSource(declaration: DataSourceDeclaration, password: string, options: Omit<RequestOptions, 'cookie'>): Promise<SourceAuthentication> {
  const source = parseSource(declaration)
  const auth = source.authentication
  if (!auth) throw new Error('Source does not support authentication')
  if (typeof password !== 'string' || !password.length || password.length > 8192) throw new TypeError('Invalid source password')
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
  try {
    const response = await send(new URL(auth.path, source.baseUrl), { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ [auth.passwordField]: password }) }, options.fetch, signal)
    const receivedAt = Date.now()
    if (response.redirected || !response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('Authentication failed') }
    const cookies = response.headers.getSetCookie().filter(value => value.startsWith(`${auth.cookieName}=`))
    await boundedBody(response, signal)
    signal.throwIfAborted()
    if (cookies.length !== 1) throw new Error('Authentication did not provide the declared cookie')
    const segments = cookies[0]!.split(';')
    const cookie = segments[0]!.trim()
    let maxAge: number | undefined; let expires: number | undefined
    for (const segment of segments.slice(1)) {
      const [key, ...parts] = segment.trim().split('='); const value = parts.join('=').trim()
      const attribute = key?.trim().toLowerCase()
      if (attribute === 'max-age') {
        if (maxAge !== undefined || !/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid authentication cookie lifetime')
        maxAge = Number(value)
      }
      if (attribute === 'expires') {
        if (expires !== undefined || !Number.isFinite(Date.parse(value))) throw new Error('Invalid authentication cookie lifetime')
        expires = Date.parse(value)
      }
      if (attribute === 'domain' && value.replace(/^\./, '').toLowerCase() !== new URL(source.baseUrl).hostname.toLowerCase()) throw new Error('Authentication cookie domain does not match source')
    }
    const expiresAt = maxAge !== undefined ? receivedAt + maxAge * 1000 : expires ?? null
    if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt > 8_640_000_000_000_000 || expiresAt <= Date.now())) throw new Error('Authentication cookie is expired')
    return { cookie: cookieHeader(source, cookie)!, expiresAt }
  } catch {
    if (signal.aborted) throw new Error(options.signal.aborted ? 'Authentication cancelled' : 'Authentication timed out')
    throw new Error('Data source authentication failed')
  }
}
