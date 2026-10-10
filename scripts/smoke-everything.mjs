import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { nativeAssets, sha256 } from './prepare-everything.mjs'

// Own the default IPC instance only on an isolated, ephemeral Windows runner.
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Native search smoke requires an isolated GitHub Actions Windows runner')
if (!process.argv[2]) throw new Error('Pass the packaged NextTools.exe')
const executable = resolve(process.argv[2])
const resources = join(dirname(executable), 'resources/everything')
const engineExecutable = join(resources, nativeAssets.engine.file)
const addon = join(resources, nativeAssets.addon.file)
const exec = promisify(execFile)
const temporary = realpathSync.native(await mkdtemp(join(tmpdir(), 'nexttools-everything-')))
const evidence = resolve('artifacts/everything-smoke')
await mkdir(evidence, { recursive: true })
const logs = []
const checks = []
const fixtures = []
let fileEditors = []
let app
let engine
let browser
let page
const fixtureDirectory = join(temporary, 'fixtures', 'vscode')
const configuration = join(temporary, 'Everything.ini')
const profile = join(temporary, 'profile')
const query = `"${fixtureDirectory}\\"`
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds))
function stage(message) {
  logs.push(`Stage: ${message}`)
  console.log(`[native-smoke] ${message}`)
}
async function bounded(description, operation) {
  let timer
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${description} timed out after 15s`)), 15000)
    })])
  } finally { clearTimeout(timer) }
}
async function eventually(description, operation) {
  const deadline = Date.now() + 45000
  let error
  while (Date.now() < deadline) {
    try { const result = await operation(); if (result) return result } catch (caught) { error = caught }
    await pause(250)
  }
  throw new Error(description, { cause: error })
}
function recordChild(child, label) {
  child.stdout.on('data', chunk => logs.push(`${label}: ${chunk}`))
  child.stderr.on('data', chunk => logs.push(`${label}: ${chunk}`))
  child.on('error', error => logs.push(`${label}: ${error.stack}`))
}
function releaseOwnedStreams(child) {
  if (!child || (child.exitCode === null && child.signalCode === null)) return
  // Closing our pipe read ends does not kill an engine or any grandchild.
  for (const stream of [child.stdout, child.stderr]) {
    stream?.removeAllListeners('data')
    stream?.destroy()
  }
  child.unref()
}
async function stopChild(child) {
  if (!child) return
  if (child.exitCode !== null || child.signalCode !== null) {
    releaseOwnedStreams(child)
    return
  }
  // Kill only the subprocess owned by this script, never an unrelated engine.
  await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15000 }).catch(error => logs.push(String(error)))
  await eventually('Owned subprocess did not terminate', () => child.exitCode !== null || child.signalCode !== null)
  releaseOwnedStreams(child)
}
async function powershell(source) {
  return (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { timeout: 15000 })).stdout.trim()
}
async function enginePresent() {
  return (await powershell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeSearchSmoke { [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string className, string windowName); }'; [NativeSearchSmoke]::FindWindowW('EVERYTHING_TASKBAR_NOTIFICATION', $null).ToInt64()`)) !== '0'
}
async function startEngine() {
  stage('Starting owned real-folder Everything index')
  assert.equal(await enginePresent(), false, 'Default Everything IPC instance exists; refusing to replace it')
  engine = spawn(engineExecutable, ['-config', configuration, '-no-db', '-startup'], { cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'] })
  recordChild(engine, 'Everything')
  await eventually('Bundled Everything default IPC window did not start', async () => {
    assert.equal(engine.exitCode, null, 'Owned engine exited during startup')
    return enginePresent()
  })
}
async function stopEngine() {
  stage('Stopping owned Everything index')
  if (!engine) return
  if (engine.exitCode !== null || engine.signalCode !== null) {
    releaseOwnedStreams(engine)
    return
  }
  await exec(engineExecutable, ['-config', configuration, '-exit', '-wait'], { timeout: 15000 }).catch(error => logs.push(String(error)))
  await stopChild(engine)
  await eventually('Owned default IPC window did not disappear', async () => !(await enginePresent()))
}
async function rawNativeSearch(request = { query, offset: 0, limit: fixtures.length + 1 }) {
  const source = `const native = require(${JSON.stringify(addon)}); const request = ${JSON.stringify(request)}; const nativeQuery = 'path:<' + request.query + '>'; const running = native.everythingIsRuning(); const loaded = running && native.everythingIsDBLoaded(); console.log(JSON.stringify({ electron: process.versions.electron, version: native.getEverythingVersion(), nativeQuery, running, loaded, result: loaded ? native.everythingSearch(nativeQuery, 1, request.limit, request.offset) : null }));`
  const { stdout } = await exec(executable, ['-e', source], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true })
  const result = JSON.parse(stdout.trim())
  assert.match(result.electron, /^41\./)
  if (result.running) assert.equal(result.version, '1.4.1', 'Native SDK reports major.minor.revision, not the PE build number')
  return result
}
async function launchApp() {
  stage('Launching NextTools against owned index')
  // Start the controlled index first: production auto-start must not launch a
  // different engine or scan the runner's disks before the fixture is ready.
  assert.equal(await enginePresent(), true)
  app = spawn(executable, ['--remote-debugging-port=9335', `--profile-dir=${profile}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  recordChild(app, 'NextTools')
  await eventually('Packaged Electron CDP unavailable', async () => (await fetch('http://127.0.0.1:9335/json/version', { signal: AbortSignal.timeout(2000) })).ok)
  stage('Connecting native-smoke CDP')
  browser = await chromium.connectOverCDP('http://127.0.0.1:9335', { timeout: 15000 })
  for (const context of browser.contexts()) context.setDefaultTimeout(15000)
  page = await eventually('Main search preload unavailable', async () => {
    for (const context of browser.contexts()) for (const candidate of context.pages()) {
      if (await bounded('Native search preload readiness', () => candidate.evaluate(() => typeof window.desktop?.searchLauncher === 'function'))) return candidate
    }
  })
  assert.match(await page.evaluate(() => navigator.userAgent), /Electron\/41\./, 'Smoke must exercise the addon inside shipped Electron 41')
}
async function quitApp() {
  stage('Quitting native-smoke NextTools')
  try {
    await bounded('Native smoke quit IPC', () => page?.evaluate(() => window.desktop.quit())).catch(error => logs.push(String(error)))
    if (app) await eventually('Resident NextTools did not quit', () => app.exitCode !== null || app.signalCode !== null)
    releaseOwnedStreams(app)
  } finally {
    await bounded('Native smoke CDP disconnect', () => browser?.close()).catch(error => logs.push(String(error)))
    browser = undefined
    page = undefined
  }
}
async function search(overrides = {}) {
  const request = { query, offset: 0, limit: 17, ...overrides }
  const groups = await page.evaluate(request => window.desktop.searchLauncher(request), request)
  const result = groups.find(group => group.providerId === 'everything')
  assert.ok(result, 'Builtin native search provider is missing from main launcher')
  assert.equal(result.status, 'ready', result.message)
  assert.equal(result.offset, request.offset)
  assert.ok(Array.isArray(result.items))
  assert.ok(Number.isSafeInteger(result.total) && result.total >= 0)
  assert.equal(result.hasMore, request.offset + result.items.length < result.total)
  return result
}
async function collect(overrides = {}) {
  const items = []
  let total
  for (let offset = 0; offset <= fixtures.length + 1; offset += 17) {
    const result = await search({ ...overrides, offset })
    total ??= result.total
    assert.equal(result.total, total, 'Total must stay stable across an unchanged native index')
    assert.ok(result.items.length <= 17)
    logs.push(`Page ${offset}: total=${total} count=${result.items.length} hasMore=${result.hasMore}`)
    items.push(...result.items)
    if (!result.hasMore) {
      assert.equal(items.length, total)
      assert.equal(new Set(items.map(item => normalized(item.path))).size, items.length)
      return items
    }
    assert.equal(result.items.length, 17, 'Non-final page must contain the requested limit')
  }
  throw new Error('Pagination failed to terminate')
}
const normalized = path => path.toLowerCase().replace(/[\\/]+$/, '')
const samePaths = (actual, expected) => {
  assert.deepEqual(actual.map(item => normalized(item.path)).sort(), expected.map(item => normalized(item.path)).sort(), 'Native index path set must exactly match the real fixture')
}
async function explorerShows(path, selectedPath) {
  const encoded = Buffer.from(path, 'utf16le').toString('base64')
  const selected = Buffer.from(selectedPath ?? '', 'utf16le').toString('base64')
  return powershell(`$target=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); $selected=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${selected}')); $shell=New-Object -ComObject Shell.Application; $windows=$shell.Windows(); for ($i=0; $i -lt $windows.Count; $i++) { try { $window=$windows.Item($i); if ($window.Document.Folder.Self.Path -ne $target) { continue }; if ($selected -eq '') { 'yes'; break }; $items=$window.Document.SelectedItems(); for ($j=0; $j -lt $items.Count; $j++) { if ($items.Item($j).Path -eq $selected) { 'yes'; return } } } catch {} }`)
}
async function editorsOpening(path) {
  const encoded = Buffer.from(path, 'utf16le').toString('base64')
  const result = await powershell(`$target=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); $matches=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [pscustomobject]@{ id=$_.ProcessId; name=$_.Name; creationDate=$_.CreationDate.ToString('o') } }); ConvertTo-Json -InputObject $matches -Compress`)
  return JSON.parse(result)
}
try {
  stage('Verifying packaged binaries and creating actual file fixtures')
  assert.equal(await enginePresent(), false, 'Default Everything IPC instance exists; refusing to commandeer it')
  assert.equal(sha256(await readFile(addon)), nativeAssets.addon.sha256)
  assert.equal(sha256(await readFile(engineExecutable)), nativeAssets.engine.sha256)
  const encodedEngine = Buffer.from(engineExecutable, 'utf16le').toString('base64')
  const engineVersion = await powershell(`$engine=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedEngine}')); (Get-Item -LiteralPath $engine).VersionInfo.FileVersion`)
  assert.equal(engineVersion, '1.4.1.1009')
  checks.push('Packaged addon and supplied Everything engine bytes match pinned upstream SHA256; no ES CLI or separate engine download')
  await mkdir(fixtureDirectory, { recursive: true })
  const folders = ['A 子目录', 'Z,目录', '打开安全目录']
  for (const name of folders) {
    const path = join(fixtureDirectory, name)
    await mkdir(path)
    fixtures.push({ path, isDirectory: true })
  }
  const textFixture = { path: join(fixtureDirectory, '1.txt'), isDirectory: false, size: 3, modifiedAt: new Date('2024-01-01T01:00:00Z') }
  await writeFile(textFixture.path, 'one', 'utf8')
  await utimes(textFixture.path, textFixture.modifiedAt, textFixture.modifiedAt)
  fixtures.push(textFixture)
  const applicationPath = join(fixtureDirectory, 'Code.exe')
  await copyFile(engineExecutable, applicationPath)
  const applicationFixture = { path: applicationPath, isDirectory: false, size: (await stat(applicationPath)).size, modifiedAt: new Date('2024-01-01T02:00:00Z') }
  await utimes(applicationPath, applicationFixture.modifiedAt, applicationFixture.modifiedAt)
  fixtures.push(applicationFixture)
  for (let index = 0; index < 138; index++) {
    const name = index === 137 ? 'Unicode 中文,逗号.txt' : `fixture-${String(index).padStart(3, '0')}.txt`
    const path = join(fixtureDirectory, folders[index % 2], name)
    const size = index + 11
    const modifiedAt = new Date(Date.UTC(2024, 0, 2) + index * 60000)
    await writeFile(path, Buffer.alloc(size, 65))
    await utimes(path, modifiedAt, modifiedAt)
    fixtures.push({ path, isDirectory: false, size, modifiedAt })
  }
  // Exclude every fixed volume. Scan only real folders; never fabricate EFU
  // metadata or contaminate the user's shared Everything/ES preferences.
  const iniList = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  const fixedVolumePaths = (await powershell("(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3').DeviceID | ForEach-Object { $_ + '\\' }")).split(/\r?\n/).filter(Boolean)
  assert.ok(fixedVolumePaths.length > 0, 'Windows runner has no fixed volume to exclude')
  const excludedVolumePaths = fixedVolumePaths.map(iniList).join(',')
  const excludedVolumeFlags = fixedVolumePaths.map(() => '0').join(',')
  const indexedConfiguration = `[Everything]\r\napp_data=0\r\nrun_as_admin=0\r\nrun_in_background=1\r\nshow_tray_icon=0\r\ncheck_for_updates_on_startup=0\r\nauto_include_fixed_volumes=0\r\nauto_include_removable_volumes=0\r\nauto_include_fixed_refs_volumes=0\r\nauto_include_removable_refs_volumes=0\r\nntfs_volume_guids=\r\nntfs_volume_paths=${excludedVolumePaths}\r\nntfs_volume_includes=${excludedVolumeFlags}\r\nrefs_volume_guids=\r\nrefs_volume_paths=${excludedVolumePaths}\r\nrefs_volume_includes=${excludedVolumeFlags}\r\nfolders=${iniList(fixtureDirectory)}\r\nfilelists=\r\nindex_size=1\r\nindex_date_modified=1\r\nindex_attributes=1\r\n`
  await writeFile(configuration, indexedConfiguration, 'utf8')
  await writeFile(join(evidence, 'fixture-manifest.json'), JSON.stringify({ assets: nativeAssets, fixtures, configuration: indexedConfiguration }, null, 2))
  await startEngine()
  const raw = await eventually('Bundled native addon did not report a loaded real folder index', async () => {
    const result = await rawNativeSearch()
    return result.loaded && result.result?.total === fixtures.length ? result : false
  })
  assert.ok(!raw.result.error, JSON.stringify(raw.result.error))
  samePaths(raw.result.list.map(item => ({ path: join(item.path, item.filename) })), fixtures)
  await writeFile(join(evidence, 'raw-native-results.json'), JSON.stringify(raw, null, 2))
  await launchApp()
  await eventually('Real folder index did not become ready', async () => (await search({ limit: 100 })).total === fixtures.length)
  const all = await collect()
  samePaths(all, fixtures)
  assert.equal(new Set(all.map(item => item.id)).size, all.length)
  const exhausted = await search({ offset: fixtures.length })
  assert.equal(exhausted.total, fixtures.length)
  assert.equal(exhausted.items.length, 0)
  assert.equal(exhausted.hasMore, false)
  for (const item of all) {
    const fixture = fixtures.find(candidate => normalized(candidate.path) === normalized(item.path))
    const native = raw.result.list.find(candidate => normalized(join(candidate.path, candidate.filename)) === normalized(item.path))
    assert.ok(native)
    assert.equal(item.name, basename(fixture.path))
    assert.equal(item.isDirectory, fixture.isDirectory)
    assert.deepEqual(item.actions.map(action => action.id), ['open', 'reveal', 'copy-path'])
    assert.equal(item.modifiedAt, native.dateModified || null, 'Native formatted date is display text, not a parsed ISO date')
    if (fixture.isDirectory) assert.equal(item.size, null)
    else {
      assert.equal(item.size, fixture.size)
      assert.equal(item.size, native.size)
      assert.ok(typeof item.modifiedAt === 'string' && item.modifiedAt.length > 0)
    }
  }
  const sorted = await collect({ query: 'fixture-' })
  samePaths(sorted, fixtures.filter(item => basename(item.path).startsWith('fixture-')))
  assert.deepEqual(sorted.map(item => item.name), Array.from({ length: 137 }, (_, index) => `fixture-${String(index).padStart(3, '0')}.txt`), 'Default native name sort must be globally stable across offset pages')
  const ordinary = await search({ query: 'uNiCo' })
  samePaths(ordinary.items, [fixtures.at(-1)])
  const unicode = await search({ query: 'Unicode 中文,逗号' })
  samePaths(unicode.items, [fixtures.at(-1)])
  stage('Capturing raw broad-path native records and verifying API pagination')
  const broadNativePages = []
  for (let offset = 0; ; offset += 100) {
    const snapshot = await rawNativeSearch({ query: 'vscode', offset, limit: 100 })
    broadNativePages.push({ offset, ...snapshot })
    await writeFile(join(evidence, 'raw-native-vscode-results.json'), JSON.stringify(broadNativePages, null, 2))
    const rootRecords = snapshot.result?.list?.filter(item =>
      !item.path || /^[A-Za-z]:[\\/]/.test(item.filename ?? '') ||
      normalized(item.filename ?? '') === 'vscode' ||
      normalized(join(item.path || '', item.filename || '')) === normalized(fixtureDirectory)) ?? []
    for (const item of rootRecords) {
      const diagnostic = JSON.stringify({ offset, ...item })
      logs.push(`Raw native vscode root record: ${diagnostic}`)
      console.log(`::notice title=Raw native vscode root record::${diagnostic.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
    }
    if (!snapshot.result || offset + snapshot.result.list.length >= snapshot.result.total) break
    assert.equal(snapshot.result.list.length, 100, 'Raw native diagnostics must advance by a full page')
  }
  const indexedPath = await collect({ query: 'vscode' })
  samePaths(indexedPath.filter(item => normalized(item.path) !== normalized(fixtureDirectory)), fixtures)
  assert.ok(indexedPath.some(item => normalized(item.path) === normalized(applicationFixture.path)))
  samePaths(await collect({ query: 'VsCoDe' }), indexedPath)
  const indexedFilename = await search({ query: '1.txt' })
  samePaths(indexedFilename.items, fixtures.filter(item => !item.isDirectory && basename(item.path).toLowerCase().includes('1.txt')))
  assert.ok(indexedFilename.items.some(item => normalized(item.path) === normalized(textFixture.path)))
  const empty = await search({ query: 'this-file-does-not-exist-nexttools' })
  assert.equal(empty.total, 0)
  assert.equal(empty.items.length, 0)
  const id = all[0].id
  const tamperedId = `${id[0] === 'a' ? 'b' : 'a'}${id.slice(1)}`
  await assert.rejects(page.evaluate(() => window.desktop.performSearchAction('everything', 'not-a-host-issued-result', 'open')))
  await assert.rejects(page.evaluate(id => window.desktop.performSearchAction('everything', id, 'open'), tamperedId))
  await assert.rejects(page.evaluate(id => window.desktop.performSearchAction('unknown-provider', id, 'open'), id))
  await assert.rejects(page.evaluate(id => window.desktop.performSearchAction('everything', id, 'delete'), id))
  await writeFile(join(evidence, 'indexed-folder-results.json'), JSON.stringify({ all, sorted, ordinary, unicode, path: indexedPath, filename: indexedFilename, empty, raw }, null, 2))
  stage('Exercising main top-field filename/path searches and real row actions')
  checks.push('Electron 41 loads the shipped native addon: real folder index preserves exact paths, types, sizes/display dates, Unicode, case-insensitive basename/path queries, name sort, offset pagination, empty results, and host-issued result authorization')
  const mainQuery = page.locator('.app-shell > .search-header .search-input')
  const group = page.locator('[data-testid="search-provider"][data-provider-id="everything"]')
  const rows = group.getByTestId('search-result-row')
  const showQuery = async (value, expected) => {
    await mainQuery.fill(value)
    await eventually(`Main launcher did not show ${value} results`, async () => (await group.getAttribute('data-status')) === 'ready' && (await rows.count()) === expected)
  }
  await showQuery('1.txt', indexedFilename.items.length)
  assert.ok((await rows.allTextContents()).some(text => text.includes('1.txt')))
  await page.screenshot({ path: join(evidence, 'main-1-txt.png') })
  const uiPageSize = 30
  await showQuery('vscode', uiPageSize)
  for (let expected = Math.min(uiPageSize * 2, indexedPath.length); ; expected = Math.min(expected + uiPageSize, indexedPath.length)) {
    await group.getByTestId('search-provider-load-more').click()
    await eventually('Main native pagination did not append the next exact page', async () => (await rows.count()) === expected)
    if (expected === indexedPath.length) break
  }
  assert.equal(await group.getByTestId('search-provider-load-more').count(), 0)
  const renderedPaths = await rows.locator('.search-result-path').allTextContents()
  samePaths(renderedPaths.map(path => ({ path })), indexedPath)
  assert.equal(new Set(await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-result-id')))).size, indexedPath.length)
  assert.ok((await rows.allTextContents()).some(text => text.includes('Code.exe')))
  await page.screenshot({ path: join(evidence, 'main-vscode.png') })
  await showQuery('1.txt', indexedFilename.items.length)
  assert.deepEqual(await editorsOpening(textFixture.path), [])
  await rows.filter({ hasText: textFixture.path }).getByTestId('search-result-open').click()
  fileEditors = await eventually('shell.openPath did not launch the associated editor for actual 1.txt', async () => {
    const editors = await editorsOpening(textFixture.path)
    return editors.length ? editors : false
  })
  await writeFile(join(evidence, 'file-open-processes.json'), JSON.stringify(fileEditors, null, 2))
  await page.screenshot({ path: join(evidence, 'main-file-open.png') })
  await showQuery('打开安全目录', 1)
  await rows.getByTestId('search-result-open').click()
  await eventually('shell.openPath did not open the safe real folder in Explorer', async () => (await explorerShows(join(fixtureDirectory, folders[2]))) === 'yes')
  await showQuery('Unicode 中文,逗号', 1)
  await rows.click({ button: 'right' })
  await page.getByTestId('search-result-copy-path').click()
  await eventually('Copy action did not complete in main renderer', async () => (await page.getByTestId('search-feedback').textContent()).includes('已复制'))
  const clipboard = await powershell('[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-Clipboard -Raw).TrimEnd([char]13,[char]10)))')
  assert.equal(Buffer.from(clipboard, 'base64').toString('utf16le'), fixtures.at(-1).path)
  await rows.click({ button: 'right' })
  await page.getByTestId('search-result-reveal').click()
  await eventually('shell.showItemInFolder did not select the real Unicode file in Explorer', async () => (await explorerShows(dirname(fixtures.at(-1).path), fixtures.at(-1).path)) === 'yes')
  await page.screenshot({ path: join(evidence, 'main-file-actions.png') })
  checks.push('Actual main top field searches 1.txt and directory-only vscode/Code.exe; main rows paginate and perform real text-file open, folder open, Explorer file reveal, and system clipboard copy')
  // Auto-start is the production recovery contract. Do not query while our
  // fixture is stopped: that would deliberately start an uncontrolled index.
  stage('Verifying owned engine stop/restart recovery')
  await quitApp()
  await stopEngine()
  const stopped = await rawNativeSearch()
  assert.equal(stopped.running, false)
  assert.equal(stopped.loaded, false)
  await writeFile(join(evidence, 'stopped-native-state.json'), JSON.stringify(stopped, null, 2))
  await startEngine()
  await launchApp()
  await eventually('Restarted real folder index did not recover', async () => (await search({ limit: 100 })).total === fixtures.length)
  samePaths(await collect(), fixtures)
  await page.locator('.app-shell > .search-header .search-input').fill('1.txt')
  await eventually('Relaunched main field did not recover real native results', async () => (await page.locator('[data-testid="search-provider"][data-provider-id="everything"] [data-testid="search-result-row"]').count()) === indexedFilename.items.length)
  checks.push('Native addon honestly reports stopped engine; owned engine restart and NextTools relaunch recover the same real index without production fixture flags or uncontrolled auto-start')
  await writeFile(join(evidence, 'checks.json'), JSON.stringify(checks, null, 2))
  console.log(checks.join('\n'))
} catch (error) {
  console.error(`::error title=Packaged native main-search smoke failed::${String(error.stack ?? error).concat('\n', checks.join('\n'), '\n', logs.join('').slice(-5000)).replaceAll('%', '%25').replaceAll('\n', '%0A').replaceAll('\r', '%0D')}`)
  logs.push(error.stack ?? String(error))
  await bounded('Native failure screenshot', () => page?.screenshot({ path: join(evidence, 'failure.png') })).catch(() => {})
  process.exitCode = 1
} finally {
  await quitApp().catch(error => { logs.push(String(error)); process.exitCode = 1 })
  await stopChild(app).catch(error => { logs.push(String(error)); process.exitCode = 1 })
  await stopEngine().catch(error => { logs.push(String(error)); process.exitCode = 1 })
  const encodedFixture = Buffer.from(fixtureDirectory, 'utf16le').toString('base64')
  await powershell(`$root=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedFixture}')); $shell=New-Object -ComObject Shell.Application; @($shell.Windows()) | ForEach-Object { try { if ($_.Document.Folder.Self.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $_.Quit() } } catch {} }`).catch(error => logs.push(String(error)))
  const liveEditors = await editorsOpening(join(fixtureDirectory, '1.txt')).catch(error => { logs.push(String(error)); return [] })
  for (const editor of fileEditors) {
    if (liveEditors.some(live => live.id === editor.id && live.creationDate === editor.creationDate)) {
      await exec('taskkill.exe', ['/PID', String(editor.id), '/T', '/F'], { timeout: 15000 }).catch(error => logs.push(String(error)))
    }
  }
  stage(`Cleanup complete; active resources: ${process.getActiveResourcesInfo().join(', ')}`)
  await writeFile(join(evidence, 'process.log'), logs.join('\n'))
  await rm(temporary, { recursive: true, force: true }).catch(error => console.error(error))
}
