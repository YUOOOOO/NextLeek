import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { downloadVerified, extractZip, sha256 } from './prepare-everything.mjs'

// This smoke deliberately owns the default IPC instance only on an ephemeral CI runner.
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Everything smoke requires an isolated GitHub Actions Windows runner')
if (!process.argv[2]) throw new Error('Pass the packaged NextLeek.exe')
const executable = resolve(process.argv[2])
const cli = join(dirname(executable), 'resources/everything/es.exe')
const engineAsset = {
  url: 'https://www.voidtools.com/Everything-1.4.1.1032.x64.zip',
  // https://www.voidtools.com/Everything-1.4.1.1032.sha256
  sha256: '698df475ec44e638f66f1b6a32d28fea613cec78d3b6310e6abe53431eeb940c',
}
const exec = promisify(execFile)
const temporary = realpathSync.native(await mkdtemp(join(tmpdir(), 'nextleek-everything-')))
const evidence = resolve('artifacts/everything-smoke')
await mkdir(evidence, { recursive: true })
const logs = []
const checks = []
const fixtures = []
let app
let engine
let browser
let page
const engineDirectory = join(temporary, 'engine')
const engineExecutable = join(engineDirectory, 'Everything.exe')
const fixtureDirectory = join(temporary, 'fixtures')
const configuration = join(engineDirectory, 'Everything.ini')
const filelist = join(temporary, 'fixtures.efu')
const query = `"${fixtureDirectory}\\"`
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds))
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
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  // The only PID killed is the exact child launched by this script, never another user's engine.
  await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15000 }).catch(error => logs.push(String(error)))
  await eventually('Owned subprocess did not terminate', () => child.exitCode !== null || child.signalCode !== null)
}
async function diagnoseStartupFailure() {
  const diagnosticFile = join(evidence, 'startup-failure-es.csv')
  let stdout = ''
  try {
    ({ stdout } = await exec(cli, ['-csv', '-no-header', '-full-path', '-count', '200'], { timeout: 15000 }))
  } catch (error) {
    stdout = error.stdout ?? ''
    logs.push(`ES startup diagnostic failed: ${error.stack ?? error}`)
  }
  await writeFile(diagnosticFile, stdout, 'utf8')
  const slice = stdout.split(/\r?\n/).filter(Boolean).slice(0, 20)
  for (const [index, line] of slice.entries()) {
    const annotation = line.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
    console.error(`::error file=${diagnosticFile},line=${index + 1}::Raw ES blank-query diagnostic: ${annotation}`)
  }
  logs.push(`Raw ES blank-query diagnostic (${diagnosticFile}):\n${slice.join('\n')}`)
}
async function startEngine() {
  engine = spawn(engineExecutable, ['-config', configuration, '-no-db', '-startup'], { stdio: ['ignore', 'pipe', 'pipe'] })
  recordChild(engine, 'Everything')
  try {
    await eventually('Real Everything index did not become ready', async () => {
      const result = await search({ limit: 100, query: '' })
      return result.items.length === 100 && result.hasMore
    })
  } catch (error) {
    await diagnoseStartupFailure()
    throw error
  }
}
async function stopEngine() {
  if (!engine || engine.exitCode !== null || engine.signalCode !== null) return
  await exec(engineExecutable, ['-config', configuration, '-exit', '-wait'], { timeout: 15000 }).catch(error => logs.push(String(error)))
  await stopChild(engine)
}
async function search(overrides = {}) {
  const request = { query, filter: 'all', sort: 'name', descending: false, offset: 0, limit: 17, ...overrides }
  const result = await page.evaluate(request => window.desktop.searchEverything(request), request)
  assert.equal(result.offset, request.offset)
  assert.ok(Array.isArray(result.items))
  return result
}
async function collect(overrides) {
  const items = []
  for (let offset = 0; offset <= fixtures.length; offset += 17) {
    const result = await search({ ...overrides, offset })
    assert.ok(result.items.length <= 17)
    items.push(...result.items)
    if (!result.hasMore) return items
    assert.equal(result.items.length, 17, 'A non-final page must contain the requested limit')
  }
  throw new Error('Pagination failed to terminate')
}
const normalized = path => path.toLowerCase().replace(/[\\/]+$/, '')
const samePaths = (actual, expected) => assert.deepEqual(actual.map(item => normalized(item.path)).sort(), expected.map(item => normalized(item.path)).sort())
async function powershell(source) {
  return (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { timeout: 15000 })).stdout.trim()
}
async function explorerShows(path, selectedPath) {
  const encoded = Buffer.from(path, 'utf16le').toString('base64')
  const selected = Buffer.from(selectedPath ?? '', 'utf16le').toString('base64')
  return powershell(`$target=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); $selected=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${selected}')); $shell=New-Object -ComObject Shell.Application; $found=@($shell.Windows() | Where-Object { try { ($_.Document.Folder.Self.Path -eq $target) -and (($selected -eq '') -or (@($_.Document.SelectedItems() | Where-Object { $_.Path -eq $selected }).Count -gt 0)) } catch { $false } }); if ($found.Count -gt 0) { 'yes' }`)
}
try {
  // Refuse to commandeer a default instance. The caller must provide an isolated CI runner.
  let existingEngine = false
  try { await exec(cli, ['-get-everything-version'], { timeout: 5000 }); existingEngine = true } catch {}
  assert.equal(existingEngine, false, 'Default Everything IPC instance already exists; refusing to replace it')
  await downloadVerified(engineAsset, join(temporary, 'everything.zip'))
  await extractZip(join(temporary, 'everything.zip'), engineDirectory)
  assert.equal(sha256(await readFile(engineExecutable)), 'f191f756996a14a11e5445fa7103d302efd510cf2fbf920e6c0c8ed51d512e36')
  await mkdir(fixtureDirectory, { recursive: true })
  const folders = ['A 子目录', 'Z,目录', '打开安全目录']
  for (const name of folders) {
    const path = join(fixtureDirectory, name)
    await mkdir(path)
    fixtures.push({ path, isDirectory: true, size: null, modifiedAt: new Date('2024-01-01T00:00:00Z') })
  }
  for (let index = 0; index < 138; index++) {
    const name = index === 137 ? 'Unicode 中文,逗号.txt' : `fixture-${String(index).padStart(3, '0')}.txt`
    const path = join(fixtureDirectory, folders[index % 2], name)
    const size = index + 11
    const modifiedAt = new Date(Date.UTC(2024, 0, 2) + index * 60000)
    await writeFile(path, Buffer.alloc(size, 65))
    await utimes(path, modifiedAt, modifiedAt)
    fixtures.push({ path, isDirectory: false, size, modifiedAt })
  }
  const csv = value => `"${String(value).replaceAll('"', '""')}"`
  const filetime = date => (BigInt(date.getTime()) * 10000n + 116444736000000000n).toString()
  await writeFile(filelist, ['Filename,Size,Date Modified,Date Created,Attributes', ...fixtures.map(item =>
    [csv(item.path), item.size ?? '', filetime(item.modifiedAt), filetime(item.modifiedAt), item.isDirectory ? 16 : 32].join(','))].join('\r\n'), 'utf8')
  // Official 1.4 defaults to every fixed NTFS volume; auto_include_* only affects newly seen volumes.
  // https://www.voidtools.com/support/everything/indexes/
  // https://www.voidtools.com/support/everything/ini/
  const iniList = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  const fixedVolumePaths = (await powershell("(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3').DeviceID | ForEach-Object { $_ + '\\' }")).split(/\r?\n/).filter(Boolean)
  assert.ok(fixedVolumePaths.length > 0, 'Windows runner has no fixed volume to exclude')
  const excludedVolumePaths = fixedVolumePaths.map(iniList).join(',')
  const excludedVolumeFlags = fixedVolumePaths.map(() => '0').join(',')
  await writeFile(configuration, `[Everything]\r\napp_data=0\r\nrun_as_admin=0\r\nrun_in_background=1\r\nshow_tray_icon=0\r\ncheck_for_updates_on_startup=0\r\nauto_include_fixed_volumes=0\r\nauto_include_removable_volumes=0\r\nauto_include_fixed_refs_volumes=0\r\nauto_include_removable_refs_volumes=0\r\nntfs_volume_guids=\r\nntfs_volume_paths=${excludedVolumePaths}\r\nntfs_volume_includes=${excludedVolumeFlags}\r\nrefs_volume_guids=\r\nrefs_volume_paths=${excludedVolumePaths}\r\nrefs_volume_includes=${excludedVolumeFlags}\r\nfolders=\r\nfilelists=${iniList(filelist)}\r\nindex_size=1\r\nindex_date_modified=1\r\nindex_attributes=1\r\n`, 'utf8')
  await writeFile(join(evidence, 'fixture-manifest.json'), JSON.stringify({ engineAsset, fixtures, configuration: await readFile(configuration, 'utf8') }, null, 2))
  app = spawn(executable, ['--remote-debugging-port=9335', `--profile-dir=${join(temporary, 'profile')}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  recordChild(app, 'NextLeek')
  await eventually('Packaged Electron CDP unavailable', async () => (await fetch('http://127.0.0.1:9335/json/version')).ok)
  browser = await chromium.connectOverCDP('http://127.0.0.1:9335')
  page = await eventually('Everything preload unavailable', async () => {
    for (const context of browser.contexts()) for (const candidate of context.pages()) {
      if (await candidate.evaluate(() => typeof window.desktop?.searchEverything === 'function')) return candidate
    }
  })
  assert.equal((await page.evaluate(() => window.desktop.getEverythingStatus())).status, 'unavailable')
  await page.locator('.search-input:visible').fill('Everything')
  await page.getByRole('button', { name: 'Everything 文件搜索', exact: true }).click()
  const panel = page.getByTestId('everything-page')
  await panel.waitFor({ state: 'visible' })
  await eventually('UI did not show missing engine status', async () => (await page.getByTestId('everything-status').getAttribute('data-status')) === 'unavailable')
  await page.screenshot({ path: join(evidence, 'engine-unavailable.png') })
  checks.push('Missing real Everything returns unavailable without fabricated results')
  await startEngine()
  assert.equal((await page.evaluate(() => window.desktop.getEverythingStatus())).status, 'ready')
  const all = await collect({ query })
  samePaths(all, fixtures)
  assert.equal(new Set(all.map(item => item.id)).size, all.length)
  assert.equal(new Set(all.map(item => normalized(item.path))).size, all.length)
  const files = await collect({ filter: 'files' })
  const directories = await collect({ filter: 'folders' })
  samePaths(files, fixtures.filter(item => !item.isDirectory))
  samePaths(directories, fixtures.filter(item => item.isDirectory))
  assert.ok(files.every(item => !item.isDirectory && item.size !== null && item.modifiedAt !== null))
  assert.ok(directories.every(item => item.isDirectory))
  for (const sort of ['name', 'path', 'size', 'modified']) {
    const ascending = await collect({ filter: 'files', sort })
    const descending = await collect({ filter: 'files', sort, descending: true })
    samePaths(ascending, fixtures.filter(item => !item.isDirectory))
    assert.deepEqual(descending.map(item => item.path), ascending.map(item => item.path).reverse(), `${sort} descending must reverse the real sorted fixture`)
    if (sort === 'size') assert.deepEqual(ascending.map(item => item.size), fixtures.filter(item => !item.isDirectory).map(item => item.size))
    if (sort === 'modified') assert.deepEqual(ascending.map(item => new Date(item.modifiedAt).getTime()), fixtures.filter(item => !item.isDirectory).map(item => item.modifiedAt.getTime()))
  }
  const unicode = await search({ query: 'Unicode 中文,逗号' })
  assert.equal(unicode.items.length, 1)
  assert.equal(unicode.items[0].path, fixtures.at(-1).path)
  assert.equal(unicode.items[0].name, basename(fixtures.at(-1).path))
  await writeFile(join(evidence, 'real-results.json'), JSON.stringify({ all, files, directories, unicode }, null, 2))
  assert.equal((await search({ query: 'this-file-does-not-exist-nextleek' })).items.length, 0)
  await assert.rejects(page.evaluate(() => window.desktop.performEverythingAction('not-a-host-issued-result', 'open')))
  checks.push('Real IPC index exactly matches finite Unicode/comma fixture, files/folders, all sort directions, pagination, empty results, and authorization')
  await page.getByTestId('everything-retry').click()
  await eventually('UI did not recover from unavailable', async () => (await page.getByTestId('everything-status').getAttribute('data-status')) === 'ready')
  await page.getByTestId('everything-query').fill(query)
  await eventually('UI did not show first real result page', async () => (await page.getByTestId('everything-row').count()) === 100)
  await page.getByTestId('everything-load-more').click()
  await eventually('UI pagination did not append remaining results', async () => (await page.getByTestId('everything-row').count()) === fixtures.length)
  await page.getByTestId('everything-filter').selectOption('folders')
  await eventually('UI folder filter failed', async () => (await page.getByTestId('everything-row').count()) === 3)
  await page.getByTestId('everything-sort').selectOption('path')
  await page.getByTestId('everything-direction').click()
  await eventually('UI descending control failed', async () => (await page.getByTestId('everything-direction').getAttribute('aria-pressed')) === 'true')
  const expectedFolderOrder = (await search({ filter: 'folders', sort: 'path', descending: true })).items
  await eventually('UI path sorting did not reorder real folders', async () => {
    const rendered = await page.getByTestId('everything-row').allTextContents()
    return rendered.length === expectedFolderOrder.length && rendered.every((text, index) => text.includes(expectedFolderOrder[index].name))
  })
  await page.screenshot({ path: join(evidence, 'real-folders.png') })
  const safeFolder = page.getByTestId('everything-row').filter({ hasText: '打开安全目录' })
  await safeFolder.locator('.everything-open').click()
  await eventually('shell.openPath did not open safe fixture folder in Explorer', async () => (await explorerShows(join(fixtureDirectory, folders[2]))) === 'yes')
  await page.getByTestId('everything-filter').selectOption('files')
  await page.getByTestId('everything-query').fill('Unicode 中文,逗号')
  await eventually('UI did not show Unicode file', async () => (await page.getByTestId('everything-row').count()) === 1 && (await page.getByTestId('everything-row').textContent()).includes('Unicode 中文,逗号.txt'))
  await page.getByTestId('everything-row').locator('.everything-copy-path').click()
  const clipboard = await powershell('[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-Clipboard -Raw).TrimEnd([char]13,[char]10)))')
  assert.equal(Buffer.from(clipboard, 'base64').toString('utf16le'), fixtures.at(-1).path)
  await page.getByTestId('everything-row').locator('.everything-reveal').click()
  await eventually('shell.showItemInFolder did not select the safe fixture in Explorer', async () => (await explorerShows(dirname(fixtures.at(-1).path), fixtures.at(-1).path)) === 'yes')
  await page.screenshot({ path: join(evidence, 'unicode-actions.png') })
  checks.push('Packaged UI load-more/filter/sort and real Electron system clipboard/open/reveal use actual host-authorized fixture results')
  await stopEngine()
  await eventually('Engine stop did not become unavailable', async () => (await page.evaluate(() => window.desktop.getEverythingStatus())).status === 'unavailable')
  await page.getByTestId('everything-retry').click()
  await eventually('UI did not report stopped engine', async () => (await page.getByTestId('everything-status').getAttribute('data-status')) === 'unavailable')
  await startEngine()
  await page.getByTestId('everything-retry').click()
  await eventually('UI did not recover after real engine restart', async () => (await page.getByTestId('everything-status').getAttribute('data-status')) === 'ready')
  checks.push('Real engine stop/restart transitions unavailable → ready without restarting NextLeek')
  await page.screenshot({ path: join(evidence, 'recovered.png') })
  await writeFile(join(evidence, 'checks.json'), JSON.stringify(checks, null, 2))
  console.log(checks.join('\n'))
} catch (error) {
  console.error(`::error title=Real Everything packaged smoke failed::${String(error.stack ?? error).concat('\n', checks.join('\n'), '\n', logs.join('').slice(-5000)).replaceAll('%', '%25').replaceAll('\n', '%0A').replaceAll('\r', '%0D')}`)
  logs.push(error.stack ?? String(error))
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await page?.evaluate(() => window.desktop.quit()).catch(() => {})
  await browser?.close().catch(() => {})
  await stopChild(app).catch(error => logs.push(String(error)))
  await stopEngine().catch(error => { logs.push(String(error)); process.exitCode = 1 })
  const encodedFixture = Buffer.from(fixtureDirectory, 'utf16le').toString('base64')
  await powershell(`$root=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedFixture}')); $shell=New-Object -ComObject Shell.Application; @($shell.Windows()) | ForEach-Object { try { if ($_.Document.Folder.Self.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $_.Quit() } } catch {} }`).catch(error => logs.push(String(error)))
  await writeFile(join(evidence, 'process.log'), logs.join('\n'))
  await rm(temporary, { recursive: true, force: true }).catch(error => console.error(error))
}
