import { strict as assert } from 'node:assert'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import { strToU8, zipSync } from 'fflate'
import { decodeSourceBody, executeSource } from '../plugins/plugin-market/capabilities'
import { marketPlugin } from '../plugins/plugin-market/host'
import { CATALOG_URL, parseCatalog, verifyPackage } from '../plugins/plugin-market/package'
import type { CapabilityRequirement, DataSourceDeclaration, InstalledPlugin, MarketEntry, OpenPlugin } from '../plugins/plugin-market/shared'
import { createRuntime, type Runtime } from '../src/host/runtime'
import { commandsPlugin } from '../src/host/services/commands'
import type { DesktopService } from '../src/host/services/contracts'
import { pluginEndpointsPlugin } from '../src/host/services/plugin-endpoints'

const producerId = 'com.nextleek.source'
const consumerId = 'com.nextleek.consumer'
const password = 'test-password-not-for-plugins'
const cookieSecret = 'test-session-not-for-plugins'
const cookie = `tf_session=${cookieSecret}`

function source(authenticated = false, version = '1.0.0'): DataSourceDeclaration {
  return {
    id: 'prices', version, baseUrl: 'https://example.com/',
    methods: [
      { name: 'latest', method: 'GET', path: '/api/latest', timeoutMs: 20_000, parameters: { symbol: 'string', limit: 'number', adjusted: 'boolean' } },
      { name: 'admin', method: 'POST', path: '/api/admin', timeoutMs: 20_000, parameters: { symbol: 'string' } },
    ],
    ...(authenticated ? { authentication: { path: '/api/auth/login', passwordField: 'password', cookieName: 'tf_session' } } : {}),
  }
}
function requirement(minVersion = '1.0.0', methods = ['latest']): CapabilityRequirement {
  return { sourcePluginId: producerId, sourceId: 'prices', minVersion, methods }
}
function fixture(id: string, declarations: { dataSources?: DataSourceDeclaration[]; requires?: CapabilityRequirement[] } = {}, version = '1.0.0', manifestOverride: Record<string, unknown> = {}) {
  const metadata = { id, name: id === producerId ? 'Price source' : 'Price consumer', version, description: 'Isolated capability fixture', author: 'NextLeek', minCreatorVersion: '0.1.0', permissions: [], ...declarations }
  const bytes = zipSync({
    'manifest.json': strToU8(JSON.stringify({ ...metadata, capabilities: [], entry: 'ui/index.html', ...manifestOverride })),
    'ui/index.html': strToU8('<!doctype html><html><head></head><body>Isolated fixture</body></html>'),
  })
  const entry: MarketEntry = { ...metadata, packageUrl: `https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/packages/${id}-${version}.nlplugin`, sha256: createHash('sha256').update(bytes).digest('hex') }
  return { bytes, entry }
}
interface PackageFixture { bytes: Uint8Array; entry: MarketEntry }
type SourceInstallation = InstalledPlugin & { authenticatedSources: string[] }
function catalog(entries: MarketEntry[]) { return strToU8(JSON.stringify({ schemaVersion: 1, plugins: entries })) }
function mockServer(packages: () => PackageFixture[], data: typeof globalThis.fetch = async () => Response.json({ price: 42 })): typeof globalThis.fetch {
  return async (input, init) => {
    const url = String(input)
    if (url === CATALOG_URL) return new Response(new Uint8Array(catalog(packages().map(item => item.entry))))
    const item = packages().find(item => item.entry.packageUrl === url)
    if (item) return new Response(new Uint8Array(item.bytes))
    if (new URL(url).origin === 'https://example.com') return data(input, init)
    throw new Error(`Unexpected network request: ${url}`)
  }
}
async function harness(directory: string, fetch: typeof globalThis.fetch) {
  const ctx = new Context()
  const endpoints = ctx.plugin(pluginEndpointsPlugin); await endpoints.await()
  const commands = ctx.plugin(commandsPlugin); await commands.await()
  const market = ctx.plugin(marketPlugin({ directory, version: '4.0.14', fetch })); await market.await()
  return { invoke: (method: string, args: unknown = null) => ctx.pluginEndpoints.invoke('plugin-market', method, args), dispose: () => ctx.fiber.dispose() }
}
function invokeArgs(session: string, method = 'latest', args: Record<string, unknown> = {}) {
  return { session, sourcePluginId: producerId, sourceId: 'prices', method, args }
}
function blockedRequest() {
  let start!: () => void
  let signal: AbortSignal | undefined
  const started = new Promise<void>(resolve => { start = resolve })
  const fetch: typeof globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    signal = init!.signal!
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal!.reason), { once: true })
    start()
  })
  return { fetch, started, signal: () => signal }
}
async function bounded<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 1_000)
    })])
  } finally { clearTimeout(timer) }
}
function decodedResponse(readable: Readable, encoding: string): Response {
  const body = Readable.toWeb(decodeSourceBody(readable, encoding)) as ReadableStream<Uint8Array>
  return new Response(body, { headers: { 'content-type': 'application/json' } })
}

test('catalog and ZIP declarations agree while legacy static packages remain installable', async () => {
  const producer = fixture(producerId, { dataSources: [source()] })
  const consumer = fixture(consumerId, { requires: [requirement()] })
  const parsed = parseCatalog(catalog([producer.entry, consumer.entry]))
  assert.deepEqual(parsed[0]!.dataSources, verifyPackage(producer.bytes, parsed[0]!, '4.0.14').manifest.dataSources)
  assert.deepEqual(parsed[1]!.requires, consumer.entry.requires)
  verifyPackage(consumer.bytes, parsed[1]!, '4.0.14')
  const mismatches = [
    fixture(producerId, { dataSources: [source()] }, '1.0.0', { dataSources: [{ ...source(), version: '2.0.0' }] }),
    fixture(consumerId, { requires: [requirement()] }, '1.0.0', { requires: [requirement('2.0.0')] }),
    fixture(producerId, { dataSources: [source()] }, '1.0.0', { dataSources: undefined }),
  ]
  for (const item of mismatches) assert.throws(() => verifyPackage(item.bytes, item.entry, '4.0.14'), /declaration|dataSources|requires|match/i)
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-static-'))
  const legacy = fixture('com.nextleek.static')
  const runtime = await harness(directory, mockServer(() => [legacy]))
  try {
    await runtime.invoke('install', { id: legacy.entry.id })
    assert.equal((await runtime.invoke('open', { id: legacy.entry.id }) as OpenPlugin).id, legacy.entry.id)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('catalog rejects SSRF origins, unsafe method/auth paths and invalid capability contracts', () => {
  const invalid: Record<string, unknown>[] = []
  for (const baseUrl of ['http://example.com/', 'https://user:password@example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://10.0.0.1/', 'https://169.254.169.254/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://example.com/?secret=yes', 'https://example.com/#fragment']) invalid.push({ ...source(), baseUrl })
  for (const path of ['https://example.com/api', '//example.com/api', '/api/../secret', '/api/%2e%2e/secret', '/api\\secret', '/api/latest?password=x', '/api/latest#fragment', '/api/%2fsecret']) {
    invalid.push({ ...source(), methods: [{ ...source().methods[0]!, path }] })
    invalid.push({ ...source(true), authentication: { ...source(true).authentication!, path } })
  }
  invalid.push({ ...source(), version: 'latest' }, { ...source(), methods: [{ ...source().methods[0]!, timeoutMs: 99 }] }, { ...source(), methods: [{ ...source().methods[0]!, timeoutMs: 20_001 }] }, { ...source(), methods: [{ ...source().methods[0]!, method: 'DELETE' }] }, { ...source(), methods: [source().methods[0]!, source().methods[0]!] }, { ...source(), methods: [{ ...source().methods[0]!, parameters: { token: 'object' } }] })
  for (const declaration of invalid) {
    const entry = { ...fixture(producerId).entry, dataSources: [declaration] }
    assert.throws(() => parseCatalog(catalog([entry as unknown as MarketEntry])))
  }
  for (const requires of [[{ ...requirement(), minVersion: 'latest' }], [{ ...requirement(), methods: [] }], [requirement(), requirement()]]) {
    assert.throws(() => parseCatalog(catalog([{ ...fixture(consumerId).entry, requires }])))
  }
})

test('missing, disabled, outdated or incomplete dependencies prevent opening and unauthorized calls never fetch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-dependencies-'))
  let packages = [fixture(producerId, { dataSources: [source()] }), fixture(consumerId, { requires: [requirement('2.0.0')] })]
  let calls = 0
  const runtime = await harness(directory, mockServer(() => packages, async () => { calls++; return Response.json({ price: 42 }) }))
  try {
    await runtime.invoke('install', { id: consumerId })
    const missing = (await runtime.invoke('installed') as InstalledPlugin[]).find(item => item.id === consumerId)!
    assert(missing.dependencyErrors!.length > 0)
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /depend|source|installed/i)
    await runtime.invoke('install', { id: producerId })
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /version|depend/i)
    packages[0] = fixture(producerId, { dataSources: [source(false, '2.0.0')] }, '2.0.0')
    await runtime.invoke('install', { id: producerId })
    const opened = await runtime.invoke('open', { id: consumerId }) as OpenPlugin
    assert(opened.session)
    await assert.rejects(runtime.invoke('invokeCapability', invokeArgs('invented-session')), /session/i)
    await assert.rejects(runtime.invoke('invokeCapability', invokeArgs(randomUUID())), /session/i)
    await assert.rejects(runtime.invoke('invokeCapability', invokeArgs(opened.session, 'admin')), /allow|declar|authoriz|method|require/i)
    await assert.rejects(runtime.invoke('invokeCapability', { ...invokeArgs(opened.session), sourceId: 'other' }), /allow|declar|authoriz|source|require/i)
    assert.equal(calls, 0)
    assert.deepEqual(await runtime.invoke('invokeCapability', invokeArgs(opened.session)), { price: 42 })
    assert.equal(calls, 1)
    await runtime.invoke('setEnabled', { id: producerId, enabled: false })
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /disabled|depend|source/i)
    await runtime.invoke('setEnabled', { id: producerId, enabled: true })
    packages[0] = fixture(producerId, { dataSources: [source(false, '2.1.0')] }, '2.1.0')
    await runtime.invoke('install', { id: producerId })
    assert((await runtime.invoke('open', { id: consumerId }) as OpenPlugin).session)
    packages[0] = fixture(producerId, { dataSources: [source(false, '3.0.0')] }, '3.0.0')
    await runtime.invoke('install', { id: producerId })
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /version|depend/i)
    packages[0] = fixture(producerId, { dataSources: [source(false, '2.1.0')] }, '4.0.0')
    await runtime.invoke('install', { id: producerId })
    packages[1] = fixture(consumerId, { requires: [requirement('2.0.0', ['not-declared'])] }, '2.0.0')
    await runtime.invoke('install', { id: consumerId })
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /method|depend/i)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('authentication sends password only to login, keeps cookie private and clears credentials on restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-auth-'))
  const packages = [fixture(producerId, { dataSources: [source(true)] }), fixture(consumerId, { requires: [requirement()] })]
  const requests: { url: string; init: RequestInit | undefined }[] = []
  const fetch = mockServer(() => packages, async (input, init) => {
    requests.push({ url: String(input), init })
    if (new URL(String(input)).pathname === '/api/auth/login') {
      assert.equal(init!.method, 'POST')
      assert.deepEqual(JSON.parse(String(init!.body)), { password })
      return new Response('{}', { headers: { 'content-type': 'application/json', 'set-cookie': `${cookie}; HttpOnly; Secure; Path=/` } })
    }
    assert.equal(new Headers(init!.headers).get('cookie'), cookie)
    return Response.json({ price: 42 })
  })
  let runtime = await harness(directory, fetch)
  try {
    for (const item of packages) await runtime.invoke('install', { id: item.entry.id })
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /auth|configur/i)
    assert.deepEqual(await runtime.invoke('configureSource', { id: producerId, sourceId: 'prices', password }), { id: producerId, sourceId: 'prices', authenticated: true })
    const opened = await runtime.invoke('open', { id: consumerId }) as OpenPlugin
    await assert.rejects(runtime.invoke('configureSource', { id: producerId, sourceId: 'prices', password, session: opened.session }), /session|credential/i)
    const result = await runtime.invoke('invokeCapability', invokeArgs(opened.session, 'latest', { symbol: 'A B', limit: 2, adjusted: true }))
    assert.deepEqual(result, { price: 42 })
    const dataUrl = new URL(requests.at(-1)!.url)
    assert.equal(dataUrl.searchParams.get('symbol'), 'A B')
    assert.equal(dataUrl.searchParams.get('limit'), '2')
    assert.equal(dataUrl.searchParams.get('adjusted'), 'true')
    assert.equal(requests.at(-1)!.init!.body, undefined)
    const installed = await runtime.invoke('installed') as SourceInstallation[]
    assert.deepEqual(installed.find(item => item.id === producerId)!.authenticatedSources, ['prices'])
    for (const publicValue of [opened, result, installed, await runtime.invoke('catalog'), await readFile(join(directory, 'market-state.json'), 'utf8')]) {
      const serialized = JSON.stringify(publicValue)
      assert(!serialized.includes(password)); assert(!serialized.includes(cookieSecret)); assert(!serialized.includes(cookie))
    }
    await runtime.dispose(); runtime = await harness(directory, fetch)
    assert.deepEqual((await runtime.invoke('installed') as SourceInstallation[]).find(item => item.id === producerId)!.authenticatedSources, [])
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /auth|configur/i)
    await assert.rejects(runtime.invoke('invokeCapability', invokeArgs(opened.session)), /session/i)
    assert.equal(requests.length, 2)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})
for (const lifetime of ['Max-Age', 'Expires', 'Max-Age overrides past Expires'] as const) {
  test(`${lifetime} expiration removes authentication and blocks existing and new consumers without HTTP`, async t => {
    const now = Date.UTC(2026, 0, 1)
    t.mock.timers.enable({ apis: ['Date'], now })
    const attributes = lifetime === 'Expires'
      ? `Expires=${new Date(now + 2_000).toUTCString()}`
      : `Max-Age=2${lifetime === 'Max-Age overrides past Expires' ? `; Expires=${new Date(now - 1_000).toUTCString()}` : ''}`
    const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-expiry-'))
    const packages = [fixture(producerId, { dataSources: [source(true)] }), fixture(consumerId, { requires: [requirement()] })]
    let calls = 0
    const runtime = await harness(directory, mockServer(() => packages, async (input, init) => {
      calls++
      if (new URL(String(input)).pathname === '/api/auth/login') return new Response('{}', { headers: { 'set-cookie': `${cookie}; ${attributes}` } })
      assert.equal(new Headers(init!.headers).get('cookie'), cookie)
      return Response.json({ price: 42 })
    }))
    try {
      for (const item of packages) await runtime.invoke('install', { id: item.entry.id })
      await runtime.invoke('configureSource', { id: producerId, sourceId: 'prices', password })
      const opened = await runtime.invoke('open', { id: consumerId }) as OpenPlugin
      t.mock.timers.setTime(now + 1_999)
      assert.deepEqual((await runtime.invoke('installed') as SourceInstallation[]).find(item => item.id === producerId)!.authenticatedSources, ['prices'])
      assert.deepEqual(await runtime.invoke('invokeCapability', invokeArgs(opened.session)), { price: 42 })
      assert.equal(calls, 2)
      t.mock.timers.setTime(now + 2_000)
      if (lifetime === 'Max-Age') await assert.rejects(runtime.invoke('invokeCapability', invokeArgs(opened.session)), /auth|configur|session/i)
      if (lifetime === 'Expires') await assert.rejects(runtime.invoke('open', { id: consumerId }), /auth|configur/i)
      assert.deepEqual((await runtime.invoke('installed') as SourceInstallation[]).find(item => item.id === producerId)!.authenticatedSources, [])
      await assert.rejects(runtime.invoke('open', { id: consumerId }), /auth|configur/i)
      await assert.rejects(runtime.invoke('invokeCapability', invokeArgs(opened.session)), /auth|configur|session/i)
      assert.equal(calls, 2)
    } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
  })
}

test('session cookies remain authenticated while already expired lifetime cookies are rejected', async t => {
  const now = Date.UTC(2026, 0, 1)
  t.mock.timers.enable({ apis: ['Date'], now })
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-cookie-lifetime-'))
  const packages = [fixture(producerId, { dataSources: [source(true)] }), fixture(consumerId, { requires: [requirement()] })]
  let attributes = ''
  let dataCalls = 0
  const runtime = await harness(directory, mockServer(() => packages, async (input, init) => {
    if (new URL(String(input)).pathname === '/api/auth/login') return new Response('{}', { headers: { 'set-cookie': `${cookie}; ${attributes}` } })
    dataCalls++
    assert.equal(new Headers(init!.headers).get('cookie'), cookie)
    return Response.json({ price: 42 })
  }))
  try {
    for (const item of packages) await runtime.invoke('install', { id: item.entry.id })
    for (attributes of ['Max-Age=0', 'Max-Age=-1', `Expires=${new Date(now).toUTCString()}`, `Max-Age=0; Expires=${new Date(now + 60_000).toUTCString()}`]) {
      await assert.rejects(runtime.invoke('configureSource', { id: producerId, sourceId: 'prices', password }), /auth/i)
      assert.deepEqual((await runtime.invoke('installed') as SourceInstallation[]).find(item => item.id === producerId)!.authenticatedSources, [])
      await assert.rejects(runtime.invoke('open', { id: consumerId }), /auth|configur/i)
    }
    assert.equal(dataCalls, 0)
    attributes = 'HttpOnly; Secure; Path=/'
    await runtime.invoke('configureSource', { id: producerId, sourceId: 'prices', password })
    const opened = await runtime.invoke('open', { id: consumerId }) as OpenPlugin
    t.mock.timers.setTime(now + 365 * 24 * 60 * 60 * 1_000)
    assert.deepEqual((await runtime.invoke('installed') as SourceInstallation[]).find(item => item.id === producerId)!.authenticatedSources, ['prices'])
    assert((await runtime.invoke('open', { id: consumerId }) as OpenPlugin).session)
    assert.deepEqual(await runtime.invoke('invokeCapability', invokeArgs(opened.session)), { price: 42 })
    assert.equal(dataCalls, 1)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('failed authentication never enables consumers and provider lifecycle clears authenticated state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-auth-failure-'))
  const packages = [fixture(producerId, { dataSources: [source(true)] }), fixture(consumerId, { requires: [requirement()] })]
  let login = () => new Response('{}', { status: 401, headers: { 'set-cookie': cookie } })
  const runtime = await harness(directory, mockServer(() => packages, async () => login()))
  try {
    for (const item of packages) await runtime.invoke('install', { id: item.entry.id })
    for (const response of [
      () => new Response('{}', { status: 401, headers: { 'set-cookie': cookie } }),
      () => new Response('{}'),
      () => new Response('{}', { headers: { 'set-cookie': 'other_session=not-authorized' } }),
      () => new Response('{}', { headers: { 'set-cookie': 'tf_session=; Path=/' } }),
      () => new Response(null, { status: 302, headers: { location: 'https://example.com/api/latest', 'set-cookie': cookie } }),
    ]) {
      login = response
      await assert.rejects(runtime.invoke('configureSource', { id: producerId, sourceId: 'prices', password }))
      await assert.rejects(runtime.invoke('open', { id: consumerId }), /auth|configur/i)
      assert.deepEqual((await runtime.invoke('installed') as SourceInstallation[]).find(item => item.id === producerId)!.authenticatedSources, [])
    }
    login = () => new Response('{}', { headers: { 'set-cookie': `${cookie}; HttpOnly; Secure` } })
    await runtime.invoke('configureSource', { id: producerId, sourceId: 'prices', password })
    const opened = await runtime.invoke('open', { id: consumerId }) as OpenPlugin
    await runtime.invoke('setEnabled', { id: producerId, enabled: false })
    await runtime.invoke('setEnabled', { id: producerId, enabled: true })
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /auth|configur/i)
    await assert.rejects(runtime.invoke('invokeCapability', invokeArgs(opened.session)), /session/i)
    await runtime.invoke('configureSource', { id: producerId, sourceId: 'prices', password })
    packages[0] = fixture(producerId, { dataSources: [source(true)] }, '2.0.0')
    await runtime.invoke('install', { id: producerId })
    await assert.rejects(runtime.invoke('open', { id: consumerId }), /auth|configur/i)
    assert.deepEqual((await runtime.invoke('installed') as SourceInstallation[]).find(item => item.id === producerId)!.authenticatedSources, [])
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('closing one consumer session leaves another authorized session usable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-session-isolation-'))
  const packages = [fixture(producerId, { dataSources: [source()] }), fixture(consumerId, { requires: [requirement()] })]
  const runtime = await harness(directory, mockServer(() => packages))
  try {
    for (const item of packages) await runtime.invoke('install', { id: item.entry.id })
    const first = await runtime.invoke('open', { id: consumerId }) as OpenPlugin
    const second = await runtime.invoke('open', { id: consumerId }) as OpenPlugin
    assert.notEqual(first.session, second.session)
    await runtime.invoke('close', { session: first.session })
    await assert.rejects(runtime.invoke('invokeCapability', invokeArgs(first.session)), /session/i)
    assert.deepEqual(await runtime.invoke('invokeCapability', invokeArgs(second.session)), { price: 42 })
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

for (const action of ['provider-disable', 'provider-uninstall', 'provider-upgrade', 'consumer-disable', 'consumer-uninstall', 'consumer-upgrade', 'close'] as const) {
  test(`${action} revokes existing sessions and aborts in-flight capability requests`, { timeout: 15_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-revoke-'))
    const packages = [fixture(producerId, { dataSources: [source()] }), fixture(consumerId, { requires: [requirement()] })]
    const blocked = blockedRequest()
    const runtime = await harness(directory, mockServer(() => packages, blocked.fetch))
    try {
      for (const item of packages) await runtime.invoke('install', { id: item.entry.id })
      const opened = await runtime.invoke('open', { id: consumerId }) as OpenPlugin
      const pending = runtime.invoke('invokeCapability', invokeArgs(opened.session))
      const rejected = assert.rejects(pending)
      await blocked.started
      if (action === 'close') await runtime.invoke('close', { session: opened.session })
      else {
        const id = action.startsWith('provider') ? producerId : consumerId
        if (action.endsWith('disable')) await runtime.invoke('setEnabled', { id, enabled: false })
        else if (action.endsWith('uninstall')) await runtime.invoke('uninstall', { id })
        else {
          const position = id === producerId ? 0 : 1
          packages[position] = fixture(id, id === producerId ? { dataSources: [source()] } : { requires: [requirement()] }, '2.0.0')
          await runtime.invoke('install', { id })
        }
      }
      await rejected
      assert.equal(blocked.signal()!.aborted, true)
      await assert.rejects(runtime.invoke('invokeCapability', invokeArgs(opened.session)), /session/i)
    } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
  })
}

test('transport encodes declared GET and POST arguments and rejects unknown or mistyped parameters before HTTP', async () => {
  const declaration = source()
  const requests: { url: string; init: RequestInit | undefined }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => { requests.push({ url: String(input), init }); return Response.json({ ok: true }) }
  const options = { fetch, signal: new AbortController().signal }
  assert.deepEqual(await executeSource(declaration, 'latest', { symbol: 'A&B', limit: 2, adjusted: false }, options), { ok: true })
  assert.equal(new URL(requests[0]!.url).searchParams.get('symbol'), 'A&B')
  assert.equal(requests[0]!.init!.method, 'GET')
  assert(['error', 'manual'].includes(requests[0]!.init!.redirect!))
  await executeSource(declaration, 'admin', { symbol: 'AB' }, options)
  assert.equal(requests[1]!.url, 'https://example.com/api/admin')
  assert.equal(requests[1]!.init!.method, 'POST')
  assert.deepEqual(JSON.parse(String(requests[1]!.init!.body)), { symbol: 'AB' })
  for (const args of [{ unexpected: 'secret' }, { symbol: 1 }, { limit: '2' }, { adjusted: 1 }, { symbol: {} }, { limit: Infinity }]) await assert.rejects(executeSource(declaration, 'latest', args, options))
  await assert.rejects(executeSource(declaration, 'missing', {}, options))
  assert.equal(requests.length, 2)
})

test('data transport refuses redirects, HTTP errors, oversized bodies, invalid JSON and credential-bearing payloads', async () => {
  const cases: (() => Response)[] = [
    () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }),
    () => new Response('unavailable', { status: 503 }),
    () => new Response('{not-json}', { headers: { 'content-type': 'application/json' } }),
    () => new Response('<html>not JSON</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024 + 1) } }),
    () => new Response(JSON.stringify({ large: 'x'.repeat(2 * 1024 * 1024) }), { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ password }),
    () => Response.json({ nested: { cookie } }),
    () => Response.json({ value: `prefix ${cookieSecret} suffix` }),
    () => new Response('{"__proto__":{"polluted":true}}', { headers: { 'content-type': 'application/json' } }),
  ]
  for (const response of cases) {
    let requests = 0
    await assert.rejects(executeSource(source(true), 'latest', {}, { cookie, signal: new AbortController().signal, fetch: async () => { requests++; return response() } }))
    assert.equal(requests, 1)
  }
})

for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]] as const) {
  test(`${encoding} streams decode through the capability JSON path and enforce the decoded size limit`, async () => {
    const result = { price: 42, symbol: '中文 & ABC', history: [1, 2, 3] }
    const compressed = compress(Buffer.from(JSON.stringify(result)))
    const chunks = Array.from({ length: Math.ceil(compressed.length / 13) }, (_value, index) => compressed.subarray(index * 13, (index + 1) * 13))
    assert.deepEqual(await executeSource(source(), 'latest', {}, {
      signal: new AbortController().signal,
      fetch: async () => decodedResponse(Readable.from(chunks), encoding),
    }), result)
    const oversized = compress(Buffer.from(JSON.stringify({ large: 'x'.repeat(2 * 1024 * 1024) })))
    assert(oversized.length < 2 * 1024 * 1024)
    await assert.rejects(executeSource(source(), 'latest', {}, {
      signal: new AbortController().signal,
      fetch: async () => decodedResponse(Readable.from([oversized]), encoding),
    }), /unsafe|failed|large/i)
  })
}

test('stacked content encodings decode in reverse order and unsupported encodings reject', async () => {
  const result = { price: 42 }
  const bytes = brotliCompressSync(gzipSync(Buffer.from(JSON.stringify(result))))
  assert.deepEqual(await executeSource(source(), 'latest', {}, {
    signal: new AbortController().signal,
    fetch: async () => decodedResponse(Readable.from([bytes]), 'gzip, br'),
  }), result)
  for (const encoding of ['zstd', 'gzip, zstd', '', 'gzip,']) {
    const raw = Readable.from([Buffer.from('{}')])
    try { assert.throws(() => decodeSourceBody(raw, encoding), /encoding/i) }
    finally { raw.destroy() }
    await assert.rejects(executeSource(source(), 'latest', {}, {
      signal: new AbortController().signal,
      fetch: async () => {
        const stream = Readable.from([Buffer.from('{}')])
        try { return decodedResponse(stream, encoding) }
        catch (error) { stream.destroy(); throw error }
      },
    }), /failed|unsafe/i)
  }
})

test('aborting a capability awaiting a compressed body destroys its upstream stream', { timeout: 15_000 }, async () => {
  const controller = new AbortController()
  const raw = new Readable({ read() {} })
  const rawClosed = new Promise<void>(resolve => { raw.once('close', resolve) })
  let markReading!: () => void
  const reading = new Promise<void>(resolve => { markReading = resolve })
  const rejected = assert.rejects(executeSource(source(), 'latest', {}, {
    signal: controller.signal,
    fetch: async () => {
      const reader = (Readable.toWeb(decodeSourceBody(raw, 'gzip')) as ReadableStream<Uint8Array>).getReader()
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          markReading()
          const chunk = await reader.read()
          if (cancelled) return
          if (chunk.done) output.close()
          else output.enqueue(chunk.value)
        },
        cancel(reason) { cancelled = true; return reader.cancel(reason) },
      }, { highWaterMark: 0 })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    },
  }), /cancel/i)
  try {
    await bounded(reading, 'Capability did not start reading the compressed body')
    controller.abort(new Error('caller cancelled'))
    await bounded(rejected, 'Capability ignored cancellation while reading the compressed body')
    await bounded(rawClosed, 'Cancellation did not destroy the compressed upstream stream')
    assert.equal(raw.destroyed, true)
  } finally {
    controller.abort()
    raw.destroy()
    await rejected.catch(() => {})
  }
})

for (const method of ['invokeCapability', 'configureSource'] as const) {
  test(`real runtime lets provider disable overtake a long ${method} request and cancel it`, { timeout: 15_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-runtime-'))
    const pluginDirectory = join(directory, 'plugins')
    const packages = [fixture(producerId, { dataSources: [source(method === 'configureSource')] }), fixture(consumerId, { requires: [requirement()] })]
    const blocked = blockedRequest()
    await mkdir(pluginDirectory, { recursive: true })
    const records = []
    for (const item of packages) {
      const file = `package-${randomUUID()}.nlplugin`
      await writeFile(join(pluginDirectory, file), item.bytes)
      records.push({ catalog: item.entry, enabled: true, file })
    }
    await writeFile(join(pluginDirectory, 'market-state.json'), JSON.stringify({ schemaVersion: 1, plugins: records }))
    const nativeFetch = globalThis.fetch
    let runtime: Runtime | undefined
    try {
      globalThis.fetch = mockServer(() => packages, blocked.fetch)
      const desktop: DesktopService = { emit() {}, applySettings: async () => {}, hide() {}, quit() {}, openDataDirectory: async () => {} }
      runtime = await createRuntime(join(directory, 'lmdb'), desktop, undefined, undefined, { version: '4.0.14' })
      const opened = method === 'invokeCapability' ? await runtime.invokePlugin('plugin-market', 'open', { id: consumerId }) as OpenPlugin : undefined
      const args = opened ? invokeArgs(opened.session) : { id: producerId, sourceId: 'prices', password }
      const pending = runtime.invokePlugin('plugin-market', method, args)
      const rejected = assert.rejects(pending)
      await blocked.started
      await runtime.invokePlugin('plugin-market', 'setEnabled', { id: producerId, enabled: false })
      await rejected
      assert.equal(blocked.signal()!.aborted, true)
      if (opened) await assert.rejects(runtime.invokePlugin('plugin-market', 'invokeCapability', invokeArgs(opened.session)), /session/i)
      assert.deepEqual((await runtime.invokePlugin('plugin-market', 'installed', null) as SourceInstallation[]).find(item => item.id === producerId)!.authenticatedSources, [])
    } finally {
      globalThis.fetch = nativeFetch
      await runtime?.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test('real runtime close aborts pending data without waiting for a blocked catalog mutation', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-capabilities-close-queue-'))
  const pluginDirectory = join(directory, 'plugins')
  const packages = [fixture(producerId, { dataSources: [source()] }), fixture(consumerId, { requires: [requirement()] })]
  const blocked = blockedRequest()
  await mkdir(pluginDirectory, { recursive: true })
  const records = []
  for (const item of packages) {
    const file = `package-${randomUUID()}.nlplugin`
    await writeFile(join(pluginDirectory, file), item.bytes)
    records.push({ catalog: item.entry, enabled: true, file })
  }
  await writeFile(join(pluginDirectory, 'market-state.json'), JSON.stringify({ schemaVersion: 1, plugins: records }))
  let releaseCatalog!: () => void
  let markCatalogStarted!: () => void
  const catalogRelease = new Promise<void>(resolve => { releaseCatalog = resolve })
  const catalogStarted = new Promise<void>(resolve => { markCatalogStarted = resolve })
  let catalogSettled = false
  const nativeFetch = globalThis.fetch
  let runtime: Runtime | undefined
  let catalogPending: Promise<unknown> | undefined
  let closePending: Promise<unknown> | undefined
  let rejected: Promise<void> | undefined
  try {
    const server = mockServer(() => packages, blocked.fetch)
    globalThis.fetch = async (input, init) => {
      if (String(input) === CATALOG_URL) {
        markCatalogStarted()
        await catalogRelease
      }
      return server(input, init)
    }
    const desktop: DesktopService = { emit() {}, applySettings: async () => {}, hide() {}, quit() {}, openDataDirectory: async () => {} }
    runtime = await createRuntime(join(directory, 'lmdb'), desktop, undefined, undefined, { version: '4.0.14' })
    const opened = await runtime.invokePlugin('plugin-market', 'open', { id: consumerId }) as OpenPlugin
    rejected = assert.rejects(runtime.invokePlugin('plugin-market', 'invokeCapability', invokeArgs(opened.session)), /cancel|abort|session/i)
    await bounded(blocked.started, 'Capability request did not start')
    catalogPending = runtime.invokePlugin('plugin-market', 'catalog', null).finally(() => { catalogSettled = true })
    await bounded(catalogStarted, 'Catalog request did not start')
    closePending = runtime.invokePlugin('plugin-market', 'close', { session: opened.session })
    await bounded(closePending, 'Close waited for the blocked catalog')
    await bounded(rejected, 'Close did not cancel the capability request')
    assert.equal(blocked.signal()!.aborted, true)
    assert.equal(catalogSettled, false)
    await assert.rejects(runtime.invokePlugin('plugin-market', 'invokeCapability', invokeArgs(opened.session)), /session/i)
  } finally {
    releaseCatalog()
    try {
      await catalogPending?.catch(() => {})
      await closePending?.catch(() => {})
      await runtime?.dispose()
      await rejected
    } finally {
      globalThis.fetch = nativeFetch
      await rm(directory, { recursive: true, force: true })
    }
  }
})
