import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { applicationsPlugin, createApplicationsProvider, type ApplicationsEnvironment, type ApplicationsPorts, type ApplicationDirectoryEntry } from '../src/host/services/applications'
import { searchPlugin } from '../src/host/services/search'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBaoAAAAASUVORK5CYII='
const request = (query: string, offset = 0, limit = 100) => ({ query, offset, limit })
function entry(name: string, kind: 'directory' | 'file' | 'symlink'): ApplicationDirectoryEntry {
  return { name, isDirectory: () => kind === 'directory', isFile: () => kind === 'file', isSymbolicLink: () => kind === 'symlink' }
}
function harness(platform: 'win32' | 'darwin' | 'linux' = 'win32', directories = ['C:\\Programs', 'C:\\Desktop']) {
  const ctx = new Context()
  const children = new Map<string, ApplicationDirectoryEntry[]>()
  const files = new Map<string, { directory: boolean; revision: number }>()
  const canonical = new Map<string, string>()
  const names = new Map<string, string[]>()
  const reads: string[] = [], iconCalls: string[] = [], launches: string[] = []
  let now = 0, iconError = false, openError = ''
  const ports: ApplicationsPorts = {
    async readdir(path) { reads.push(path); if (!children.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return children.get(path)! },
    async realpath(path) { if (!children.has(path) && !files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return canonical.get(path) ?? path },
    async stat(path) {
      const file = files.get(path)
      if (!file) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return { isDirectory: () => file.directory, isFile: () => !file.directory, mtimeMs: file.revision }
    },
    async readBundleNames(path) { return names.get(path) ?? [] },
    now: () => now,
  }
  const environment: ApplicationsEnvironment = {
    platform, directories,
    async getFileIcon(path) { iconCalls.push(path); if (iconError) throw new Error('native extraction failed'); return png },
    async openPath(path) { launches.push(path); return openError },
  }
  return {
    ctx, ports, environment, children, files, canonical, names, reads, iconCalls, launches,
    provider: createApplicationsProvider(ctx, environment, ports),
    elapsed(value: number) { now += value }, iconError(value: boolean) { iconError = value }, openError(value: string) { openError = value },
    folder(path: string, entries: ApplicationDirectoryEntry[]) { children.set(path, entries) },
    file(path: string, directory = false, revision = 1) { files.set(path, { directory, revision }) },
  }
}
function windowsFixture() {
  const h = harness()
  h.folder('C:\\Programs', [entry('Visual Studio Code.lnk', 'file'), entry('微信.lnk', 'file'), entry('Utilities', 'directory'), entry('Uninstall App.lnk', 'file'), entry('report.exe', 'file'), entry('Website.url', 'file')])
  h.folder('C:\\Programs\\Utilities', [entry('Calculator.lnk', 'file')])
  h.folder('C:\\Desktop', [entry('Paint.lnk', 'file'), entry('Project', 'directory')])
  h.folder('C:\\Desktop\\Project', [entry('Not An Installed App.lnk', 'file')])
  for (const path of ['C:\\Programs\\Visual Studio Code.lnk', 'C:\\Programs\\微信.lnk', 'C:\\Programs\\Utilities\\Calculator.lnk', 'C:\\Desktop\\Paint.lnk']) h.file(path)
  return h
}

test('Windows searches genuine shortcut display names, collapsed phrases and generic acronyms with real icons', async () => {
  const h = windowsFixture()
  try {
    for (const query of ['Visual Studio Code', 'VISUAL STUDIO CODE', 'visualstudiocode', 'vsc']) {
      const result = await h.provider.search(request(query))
      assert.equal(result.total, 1); assert.equal(result.items[0].name, 'Visual Studio Code')
      assert.equal(result.items[0].path, 'C:\\Programs\\Visual Studio Code.lnk')
      assert.equal(result.items[0].iconUrl, png); assert.deepEqual(result.items[0].actions, [{ id: 'open', label: '打开' }])
    }
    assert.equal((await h.provider.search(request('微信'))).items[0].name, '微信')
    assert.equal((await h.provider.search(request('vscode'))).total, 0, 'no vendor-specific alias is fabricated')
    assert.equal((await h.provider.search(request('report'))).total, 0, 'application discovery does not search arbitrary executables')
    assert.equal((await h.provider.search(request('uninstall'))).total, 0)
    assert.equal((await h.provider.search(request('Calculator'))).total, 1)
    assert.equal((await h.provider.search(request('Paint'))).total, 1)
    assert.equal((await h.provider.search(request('Not An Installed App'))).total, 0)
    assert.equal(h.reads.includes('C:\\Desktop\\Project'), false, 'Desktop remains flat')
    assert.equal(h.iconCalls.filter(path => path.includes('Visual Studio Code')).length, 1)
  } finally { await h.ctx.fiber.dispose() }
})

test('macOS bundle metadata supplies localized names and aliases; scan stops at bundles and avoids symlink loops', async () => {
  const h = harness('darwin', ['/Applications', '/System/Applications', '/missing'])
  h.folder('/Applications', [entry('WeChat.app', 'directory'), entry('Visual Studio Code.app', 'directory'), entry('Browser Apps', 'directory'), entry('Loop', 'symlink'), entry('Safari.app', 'symlink')])
  h.folder('/Applications/Browser Apps', [entry('Work App.app', 'directory'), entry('Deep', 'directory')])
  h.folder('/System/Applications', [entry('Safari.app', 'directory')])
  h.folder('/Applications/WeChat.app', [entry('Helper.app', 'directory')])
  for (const path of ['/Applications/WeChat.app', '/Applications/Visual Studio Code.app', '/Applications/Browser Apps/Work App.app', '/Applications/Safari.app', '/System/Applications/Safari.app']) h.file(path, true)
  h.names.set('/Applications/WeChat.app', ['微信', 'WeChat'])
  h.names.set('/Applications/Browser Apps/Work App.app', ['WorkApp'])
  h.canonical.set('/Applications/Safari.app', '/System/Applications/Safari.app')
  try {
    const wechat = (await h.provider.search(request('微信'))).items[0]
    assert.equal(wechat.name, '微信'); assert.equal(wechat.path, '/Applications/WeChat.app'); assert.equal(wechat.iconUrl, png)
    assert.equal((await h.provider.search(request('WeChat'))).items[0].name, '微信')
    assert.equal((await h.provider.search(request('Visual Studio Code'))).items[0].name, 'Visual Studio Code')
    assert.equal((await h.provider.search(request('wa'))).items[0].name, 'WorkApp')
    assert.equal((await h.provider.search(request('Safari'))).total, 1, 'symlinked bundles deduplicate by canonical path')
    assert.equal((await h.provider.search(request('Helper'))).total, 0)
    assert.equal(h.reads.includes('/Applications/Loop'), false)
    assert.equal(h.reads.includes('/Applications/WeChat.app'), false)
    assert.equal(h.reads.includes('/Applications/Browser Apps/Deep'), false)
    await h.provider.performAction(wechat.id, 'open'); assert.deepEqual(h.launches, ['/Applications/WeChat.app'])
  } finally { await h.ctx.fiber.dispose() }
})

test('pagination reports total matches and icon extraction is restricted to returned items', async () => {
  const h = harness()
  h.folder('C:\\Programs', ['Alpha App', 'Beta App', 'Gamma App'].map(name => entry(`${name}.lnk`, 'file')))
  h.folder('C:\\Desktop', [])
  for (const name of ['Alpha App', 'Beta App', 'Gamma App']) h.file(`C:\\Programs\\${name}.lnk`)
  try {
    const result = await h.provider.search(request('App', 1, 1))
    assert.equal(result.total, 3); assert.deepEqual(result.items.map(item => item.name), ['Beta App'])
    assert.deepEqual(h.iconCalls, ['C:\\Programs\\Beta App.lnk'])
    assert.equal((await h.provider.search(request('App', 3, 1))).items.length, 0)
    assert.equal((await h.provider.search(request('   '))).total, 0)
  } finally { await h.ctx.fiber.dispose() }
})

test('launches use only host-issued opaque IDs and preserve shortcut paths; shell errors remain visible', async () => {
  const h = windowsFixture()
  try {
    const item = (await h.provider.search(request('Visual Studio Code'))).items[0]
    await assert.rejects(h.provider.performAction(item.path, 'open'), /result ID/)
    await assert.rejects(h.provider.performAction('unknown', 'open'), /失效/)
    await assert.rejects(h.provider.performAction(item.id, 'delete'), /action/)
    assert.deepEqual(h.launches, [])
    await h.provider.performAction(item.id, 'open')
    assert.deepEqual(h.launches, ['C:\\Programs\\Visual Studio Code.lnk'])
    h.openError('ShellExecute failed')
    await assert.rejects(h.provider.performAction(item.id, 'open'), /ShellExecute failed/)
    h.files.delete(item.path)
    await assert.rejects(h.provider.performAction(item.id, 'open'), /已不存在/)
    h.file(item.path)
    await assert.rejects(h.provider.performAction(item.id, 'open'), /失效/)
  } finally { await h.ctx.fiber.dispose() }
})

test('query-time refresh discovers installs and removes stale entries, icons and launch IDs', async () => {
  const h = windowsFixture()
  try {
    const old = (await h.provider.search(request('微信'))).items[0]
    h.folder('C:\\Programs', [entry('New App.lnk', 'file')]); h.files.delete(old.path); h.file('C:\\Programs\\New App.lnk')
    h.elapsed(59_999)
    assert.equal((await h.provider.search(request('New App'))).total, 0)
    h.elapsed(1)
    assert.equal((await h.provider.search(request('微信'))).total, 0)
    assert.equal((await h.provider.search(request('New App'))).items[0].name, 'New App')
    await assert.rejects(h.provider.performAction(old.id, 'open'), /失效/)
    h.folder('C:\\Programs', [entry('微信.lnk', 'file')]); h.file(old.path, false, 2); h.elapsed(60_000)
    const replaced = (await h.provider.search(request('微信'))).items[0]
    assert.equal(replaced.iconUrl, png)
    assert.equal(h.iconCalls.filter(path => path === old.path).length, 2)
    h.file(old.path, false, 3)
    await assert.rejects(h.provider.performAction(replaced.id, 'open'), /已更改/)
  } finally { await h.ctx.fiber.dispose() }
})

test('failed icons do not fabricate an image or block application search and retry on the next query', async () => {
  const h = windowsFixture()
  try {
    h.iconError(true)
    const item = (await h.provider.search(request('微信'))).items[0]
    assert.equal(item.iconUrl, undefined); assert.equal(item.name, '微信')
    h.iconError(false)
    assert.equal((await h.provider.search(request('微信'))).items[0].iconUrl, png)
    assert.equal(h.iconCalls.length, 2)
  } finally { await h.ctx.fiber.dispose() }
})

test('icon and authorization ledgers are bounded and cleaned up by their Cordis owner', async () => {
  const h = harness()
  const names = Array.from({ length: 140 }, (_, index) => `App ${String(index).padStart(3, '0')}`)
  h.folder('C:\\Programs', names.map(name => entry(`${name}.lnk`, 'file'))); h.folder('C:\\Desktop', [])
  for (const name of names) h.file(`C:\\Programs\\${name}.lnk`)
  const oldest = (await h.provider.search(request('App', 0, 100))).items[0]
  await h.provider.search(request('App', 100, 100))
  await h.provider.search(request('App 000'))
  assert.equal(h.iconCalls.filter(path => path.endsWith('App 000.lnk')).length, 2, 'least-recently-used icons are evicted')
  for (let index = 0; index < 10; index++) await h.provider.search(request('App', 0, 100))
  await assert.rejects(h.provider.performAction(oldest.id, 'open'), /失效/)
  const current = (await h.provider.search(request('App 000'))).items[0]
  await h.ctx.fiber.dispose()
  await assert.rejects(h.provider.search(request('App')), /已关闭/)
  await assert.rejects(h.provider.performAction(current.id, 'open'), /已关闭/)
})

test('unsupported systems are explicit and applications plugin uses the generic registry lifecycle', async () => {
  const h = harness('linux')
  try {
    const result = await h.provider.search(request('App'))
    assert.equal(result.status, 'unsupported'); assert.deepEqual(result.items, []); assert.deepEqual(h.reads, [])
    await h.ctx.plugin(searchPlugin).await()
    const plugin = h.ctx.plugin(applicationsPlugin(h.environment))
    await plugin.await()
    const groups = await h.ctx.search.search(request('App'))
    assert.equal(groups.length, 1); assert.equal(groups[0].providerId, 'applications'); assert.equal(groups[0].title, '应用')
    assert.equal(groups[0].status, 'unsupported')
    await plugin.dispose()
    assert.deepEqual(await h.ctx.search.search(request('App')), [])
  } finally { await h.ctx.fiber.dispose() }
})

test('concurrent queries share one asynchronous scan and one icon extraction', async () => {
  const h = windowsFixture()
  try {
    const results = await Promise.all([h.provider.search(request('微信')), h.provider.search(request('微信'))])
    assert.equal(results[0].items[0].name, '微信'); assert.equal(results[1].items[0].name, '微信')
    assert.notEqual(results[0].items[0].id, results[1].items[0].id)
    assert.equal(h.reads.filter(path => path === 'C:\\Programs').length, 1)
    assert.equal(h.iconCalls.length, 1)
  } finally { await h.ctx.fiber.dispose() }
})

test('directory access failures and invalid inputs are reported instead of fabricated applications', async () => {
  const h = windowsFixture()
  try {
    h.ports.readdir = async () => { throw Object.assign(new Error('access denied'), { code: 'EACCES' }) }
    await assert.rejects(h.provider.search(request('微信')), /无法读取应用目录.*access denied/)
    await assert.rejects(h.provider.search(request('微信', 0, 101)), /limit/)
    const relative = createApplicationsProvider(h.ctx, { ...h.environment, directories: ['./applications'] }, h.ports)
    await assert.rejects(relative.search(request('微信')), /绝对路径/)
    assert.deepEqual(h.iconCalls, []); assert.deepEqual(h.launches, [])
  } finally { await h.ctx.fiber.dispose() }
})

test('disposing the owner during discovery rejects the pending query and cannot issue launch IDs', async () => {
  const h = windowsFixture()
  let resume!: () => void, entered!: () => void
  const blocked = new Promise<void>(resolve => { resume = resolve })
  const scanning = new Promise<void>(resolve => { entered = resolve })
  const readdir = h.ports.readdir
  h.ports.readdir = async path => { entered(); await blocked; return readdir(path) }
  const rejected = assert.rejects(h.provider.search(request('微信')), /已关闭/)
  await scanning
  await h.ctx.fiber.dispose()
  resume()
  await rejected
  assert.deepEqual(h.iconCalls, []); assert.deepEqual(h.launches, [])
})
