import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { promisify } from 'node:util'
import { createServer } from 'node:net'

const executable = resolve(process.argv[2])
const expectUpdateSupported = process.argv.includes('--expect-update-supported')
const checkUpdates = process.argv.includes('--check-updates')
const appArgs = process.argv.slice(3).filter(arg => !['--expect-update-supported', '--check-updates'].includes(arg))
let debugPort
const profile = await mkdtemp(resolve(tmpdir(), 'nextleek-smoke-'))
const evidence = resolve('artifacts/smoke')
await mkdir(evidence, { recursive: true })
const logs = []
let child
let browser
const checks = []
let nativeWindow
let applicationFixture
const applicationName = `NextLeek Smoke App ${basename(profile)}`
const broadApplicationName = `NextLeek Height Fixture ${basename(profile)}`
const broadApplicationFixtures = []
const launchMarker = resolve(profile, 'application-launched')
function stage(message) {
  logs.push(`Stage: ${message}`)
  console.log(`[desktop-smoke] ${message}`)
}
async function bounded(description, operation) {
  let timer
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${description} timed out after 15s`)), 15000)
    })])
  } finally { clearTimeout(timer) }
}
const powershell = source => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { timeout: 15000 })
const psLiteral = value => `'${value.replaceAll("'", "''")}'`
async function createApplicationFixture() {
  if (process.platform === 'darwin') {
    const applications = resolve(homedir(), 'Applications')
    await mkdir(applications, { recursive: true })
    applicationFixture = resolve(applications, `${applicationName}.app`)
    await mkdir(resolve(applicationFixture, 'Contents', 'MacOS'), { recursive: true })
    await mkdir(resolve(applicationFixture, 'Contents', 'Resources'))
    const marker = `'${launchMarker.replaceAll("'", "'\\''")}'`
    await writeFile(resolve(applicationFixture, 'Contents', 'MacOS', 'launch'), `#!/bin/sh\nprintf launched > ${marker}\n`, { mode: 0o755 })
    await copyFile('/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns', resolve(applicationFixture, 'Contents', 'Resources', 'Smoke.icns'))
    await writeFile(resolve(applicationFixture, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.nextleek.smoke.${basename(profile)}</string><key>CFBundleName</key><string>${applicationName}</string><key>CFBundleDisplayName</key><string>${applicationName}</string><key>CFBundleExecutable</key><string>launch</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>Smoke.icns</string><key>LSBackgroundOnly</key><true/></dict></plist>`)
  } else if (process.platform === 'win32') {
    assert.ok(process.env.APPDATA, 'User Start Menu requires APPDATA')
    const programs = resolve(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    await mkdir(programs, { recursive: true })
    applicationFixture = resolve(programs, `${applicationName}.lnk`)
    const script = resolve(profile, 'launch-application.bat')
    await writeFile(script, `@echo off\r\n>"${launchMarker}" <nul set /p=launched\r\n`)
    const cmd = process.env.ComSpec ?? resolve(process.env.SystemRoot, 'System32', 'cmd.exe')
    const icon = `${resolve(process.env.SystemRoot, 'System32', 'shell32.dll')},2`
    await powershell(`$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut(${psLiteral(applicationFixture)}); $shortcut.TargetPath = ${psLiteral(cmd)}; $shortcut.Arguments = ${psLiteral(`/d /c ""${script}""`)}; $shortcut.IconLocation = ${psLiteral(icon)}; $shortcut.Save()`)
  }
}
async function createBroadApplicationFixtures() {
  if (!applicationFixture) return
  for (let index = 0; index < 100; index++) {
    const name = `${broadApplicationName} ${String(index).padStart(2, '0')}`
    const fixture = resolve(dirname(applicationFixture), `${name}${process.platform === 'darwin' ? '.app' : '.lnk'}`)
    broadApplicationFixtures.push(fixture)
    if (process.platform === 'darwin') {
      await cp(applicationFixture, fixture, { recursive: true })
      const plist = resolve(fixture, 'Contents', 'Info.plist')
      await writeFile(plist, (await readFile(plist, 'utf8')).replaceAll(applicationName, name).replace(`app.nextleek.smoke.${basename(profile)}`, `app.nextleek.smoke.${basename(profile)}.height${index}`))
    } else await copyFile(applicationFixture, fixture)
  }
}
async function launcherTracksContent(page) {
  return page.evaluate(() => {
    const header = document.querySelector('.search-header')
    const launcher = document.querySelector('.launcher')
    const content = document.querySelector('.launcher-content')
    const footer = document.querySelector('.launcher-footer')
    if (!header || !launcher || !content || !footer) return false
    const error = document.querySelector('.app-shell > .error-strip')
    const intrinsicHeight = header.getBoundingClientRect().height + content.getBoundingClientRect().height + footer.getBoundingClientRect().height + (error?.getBoundingClientRect().height ?? 0) + 1
    const cap = Math.min(690, Math.max(64, window.screen.availHeight - 48))
    const expected = Math.min(Math.ceil(intrinsicHeight), cap)
    const overflow = intrinsicHeight > cap + 1
    return Math.abs(window.innerHeight - expected) <= 1
      && (overflow ? launcher.scrollHeight > launcher.clientHeight && getComputedStyle(launcher).overflowY === 'auto' : launcher.scrollHeight <= launcher.clientHeight + 1)
  })
}
function releaseOwnedStreams(processChild) {
  if (!processChild || (processChild.exitCode === null && processChild.signalCode === null)) return
  // A grandchild can inherit these pipes after the root exits. Release only
  // this script's read ends; do not terminate an external resident engine.
  for (const stream of [processChild.stdout, processChild.stderr]) {
    stream?.removeAllListeners('data')
    stream?.destroy()
  }
  processChild.unref()
}
async function stopOwnedChild() {
  if (!child) return
  if (child.exitCode !== null || child.signalCode !== null) {
    releaseOwnedStreams(child)
    return
  }
  stage(`Stopping owned process ${child.pid}`)
  if (process.platform === 'win32') {
    await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15000 }).catch(error => {
      if (child.exitCode === null && child.signalCode === null) throw error
    })
  } else child.kill()
  await eventually('Owned desktop smoke process survived cleanup', () => child.exitCode !== null || child.signalCode !== null)
  releaseOwnedStreams(child)
}
async function eventually(description, operation) {
  const deadline = Date.now() + 45000
  let error
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value } catch (e) { error = e }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(description, { cause: error })
}
async function launch() {
  stage('Allocating debugging port and launching NextLeek')
  debugPort = await new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(error => error ? rejectPort(error) : resolvePort(port))
    })
  })
  child = spawn(executable, [...appArgs, `--remote-debugging-port=${debugPort}`, `--profile-dir=${profile}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => logs.push(String(chunk)))
  child.stderr.on('data', chunk => logs.push(String(chunk)))
  child.on('error', error => logs.push(error.stack))
  await eventually('Electron debugging endpoint unavailable', async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(2000) })).ok)
  stage(`Connecting CDP on ${debugPort}`)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 15000 })
  for (const context of browser.contexts()) context.setDefaultTimeout(15000)
  return eventually('Desktop preload unavailable', async () => {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      if (await bounded('Desktop preload readiness', () => page.evaluate(() => typeof window.desktop?.getSnapshot === 'function'))) return page
    }
  })
}
async function quit(page) {
  stage(`Quitting NextLeek ${child.pid}`)
  try {
    await bounded('Desktop quit IPC', () => page.evaluate(() => window.desktop.quit())).catch(error => logs.push(String(error)))
    await eventually('Resident app did not exit', () => child.exitCode !== null || child.signalCode !== null)
    releaseOwnedStreams(child)
    await eventually('Desktop debugging endpoint was not released after quit', async () => {
      try { return !(await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(2000) })).ok }
      catch { return true }
    })
  } finally {
    await bounded('Desktop CDP disconnect', () => browser?.close()).catch(error => logs.push(String(error)))
    browser = undefined
  }
}
try {
  await createApplicationFixture()
  await createBroadApplicationFixtures()
  let page = await launch()
  await page.locator('button.brand-button').waitFor()
  const initial = await page.evaluate(() => window.desktop.getSnapshot())
  assert.ok(initial.plugins.length >= 3)
  assert.ok(initial.plugins.every(p => p.status === 'active'))
  assert.equal(initial.settings.escHide, false)
  assert.equal(initial.plugins.filter(plugin => plugin.id === 'builtin-search').length, 1)
  assert.ok(!initial.plugins.some(plugin => ['everything-provider', 'everything', 'applications'].includes(plugin.id)))
  await page.evaluate(() => window.desktop.setPluginEnabled('builtin-search', false))
  assert.deepEqual(await page.evaluate(() => window.desktop.searchLauncher({ query: 'NextLeek', offset: 0, limit: 30 })), [])
  await page.evaluate(() => window.desktop.setPluginEnabled('builtin-search', true))
  assert.deepEqual((await page.evaluate(() => window.desktop.searchLauncher({ query: 'NextLeek', offset: 0, limit: 30 }))).map(group => group.providerId).sort(), ['applications', 'everything'])
  checks.push('One built-in search plugin jointly disables and restores application and Everything providers')
  checks.push('Actual Cordis plugins active through secured preload')
  const updateState = await page.evaluate(() => window.desktop.getUpdateState())
  assert.equal(updateState.supported, expectUpdateSupported)
  if (checkUpdates) {
    const checked = await page.evaluate(() => window.desktop.checkForUpdates())
    assert.equal(checked.status, 'not-available', checked.message)
    checks.push(`Installed updater checks real GitHub release feed for ${checked.currentVersion}`)
  }
  checks.push(expectUpdateSupported ? 'Installed Windows application enables updater' : 'Portable/development application reports unsupported updater honestly')
  await eventually('Empty launcher did not collapse', async () => (await page.evaluate(() => window.innerHeight)) < 120)
  assert.equal(await page.locator('.launcher').count(), 0)
  await page.locator('.app-shell > .search-header .search-input').fill('设置')
  await eventually('Search window did not follow content height', () => launcherTracksContent(page))
  await page.getByRole('heading', { name: '搜索结果' }).waitFor()
  await page.keyboard.press('Escape')
  await eventually('Cleared search did not collapse', async () => (await page.evaluate(() => window.innerHeight)) < 120)
  checks.push('Empty launcher collapses; search expands; clearing restores input-only window')
  await page.screenshot({ path: resolve(evidence, 'launcher.png') })
  if (applicationFixture) {
    stage('Searching and launching real installed application fixture')
    await page.locator('.app-shell > .search-header .search-input').fill(applicationName)
    const applications = page.locator('[data-command-section="results"]')
    const application = applications.getByTestId('search-result-row').filter({ has: page.locator('.command-title', { hasText: applicationName }) })
    await application.waitFor()
    assert.equal(await application.count(), 1)
    const icon = application.locator('img.application-icon')
    assert.equal(await applications.locator('.search-result-path, .search-result-metadata').count(), 0)
    const tileLayout = await applications.locator('.command-grid').evaluate(grid => {
      const tile = grid.querySelector('.command-tile')
      const image = tile.querySelector('.application-icon')
      const name = tile.querySelector('.command-title')
      return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, gap: getComputedStyle(grid).gap, height: tile.getBoundingClientRect().height, icon: image.getBoundingClientRect().width, nameHeight: name.getBoundingClientRect().height, nameSize: getComputedStyle(name).fontSize }
    })
    assert.deepEqual(tileLayout, { columns: 9, gap: '0px', height: 86, icon: 32, nameHeight: 32, nameSize: '12px' })
    assert.equal(await page.getByRole('heading', { name: '最佳搜索结果', exact: true }).count(), 1)
    assert.equal(await page.locator('.pin-action').count(), 0)
    await icon.waitFor()
    await eventually('Installed application icon did not decode as native PNG', () => icon.evaluate(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && image.src.startsWith('data:image/png;base64,')))
    await eventually('Application results did not resize launcher to content', () => launcherTracksContent(page))
    await page.screenshot({ path: resolve(evidence, 'application-search.png') })
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('Enter')
    await eventually('Native application launch did not execute fixture', async () => await readFile(launchMarker, 'utf8') === 'launched')
    assert.equal(await page.getByTestId('search-error').count(), 0)
    checks.push('Real installed application search displays decoded native PNG icon and native launch executes owned marker fixture')
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('Escape')
    await eventually('Application search clear did not collapse launcher', async () => (await page.evaluate(() => window.innerHeight)) < 120)
    const collapsedPosition = await page.evaluate(() => ({ y: window.screenY, height: window.innerHeight }))
    stage('Searching one hundred real application fixtures and verifying collapse, grid navigation, expansion and bounded scrolling')
    await page.locator('.app-shell > .search-header .search-input').fill(broadApplicationName)
    await eventually('Broad application search did not show two collapsed rows', async () => await applications.getByTestId('search-result-row').count() === 18)
    assert.equal(await applications.getByTestId('best-results-expand').textContent(), '展开 (100)')
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('ArrowDown')
    assert.equal(await applications.locator('.application-tile.selected').getAttribute('data-result-index'), '9')
    await applications.getByTestId('best-results-expand').click()
    await eventually('Expanded native application search did not fetch all one hundred fixtures', async () => await applications.getByTestId('search-result-row').count() === 100)
    await eventually('Broad search did not cap height and retain scroll overflow', () => launcherTracksContent(page))
    assert.equal(await page.getByRole('heading', { name: '搜索结果', exact: true }).count(), 0)
    const largeLayout = await page.evaluate(() => {
      const launcher = document.querySelector('.launcher')
      const content = document.querySelector('.launcher-content')
      return { height: window.innerHeight, cap: Math.min(690, Math.max(64, window.screen.availHeight - 48)), intrinsic: content.getBoundingClientRect().height, overflow: launcher.scrollHeight - launcher.clientHeight, screenHeight: window.screen.availHeight }
    })
    assert.ok(largeLayout.intrinsic > largeLayout.cap, 'Fixture must exercise genuinely overflowing content, not a few snug rows')
    assert.ok(Math.abs(largeLayout.height - largeLayout.cap) <= 1, JSON.stringify(largeLayout))
    assert.ok(largeLayout.height < largeLayout.screenHeight && largeLayout.overflow > 0, JSON.stringify(largeLayout))
    assert.equal(await page.locator('.launcher').evaluate(launcher => {
      launcher.scrollTop = launcher.scrollHeight
      return launcher.scrollTop > 0 && launcher.scrollTop + launcher.clientHeight >= launcher.scrollHeight - 1
    }), true, 'All overflowing results must remain reachable by scrolling')
    await page.screenshot({ path: resolve(evidence, 'application-search-capped.png') })
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('Escape')
    await eventually('Clearing broad search did not restore snug header and stable position', async () => page.evaluate(position => Math.abs(window.innerHeight - position.height) <= 1 && Math.abs(window.screenY - position.y) <= 1 && !document.querySelector('.launcher'), collapsedPosition))
    checks.push('One hundred real installed applications show18 collapsed9-column86px tiles, explicitly expand all paginated matches, cap search at690/workarea-minus48, retain scrolling, and clear to the same snug header position without drift')
  }
  assert.equal(await page.locator('.search-header .window-action').count(), 0)
  await page.locator('button.brand-button').click()
  assert.equal(await page.locator('.settings-sidebar .quit-button').count(), 0)
  assert.equal(await page.locator('.app-shell > .search-header button').count(), 2)
  assert.equal(await page.locator('.app-shell > .search-header .brand-button').count(), 1)
  await page.locator('.app-shell > .search-header .back-button').click()
  await eventually('Settings back did not collapse empty launcher without history', async () => (await page.evaluate(() => window.innerHeight)) < 120)
  assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '')
  await page.locator('.app-shell > .search-header .search-input').fill('设置')
  assert.equal(await page.locator('.app-shell > .search-header button').count(), 1)
  await page.screenshot({ path: resolve(evidence, 'search-results.png') })
  await page.locator('button.brand-button').click()
  await page.locator('.app-shell > .search-header .back-button').click()
  assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '')
  await page.locator('.app-shell.collapsed').waitFor()
  await page.locator('.app-shell > .search-header .search-input').fill('设置')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '')
  await page.locator('.app-shell.collapsed').waitFor()
  checks.push('Settings back clears launcher query and collapses without history; launcher has only brand settings action; real Escape clears search')
  await page.locator('button.brand-button').click()
  await page.locator('#hotkey').focus()
  await page.keyboard.press('Alt+c')
  stage('Recording native shortcut and exercising hide/show/WM_CLOSE')
  if (process.platform === 'win32') {
    await powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%z')")
    await eventually('Active global shortcut intercepted recording', async () => (await page.locator('#hotkey').inputValue()) === 'Alt+Z')
  } else await page.keyboard.press('Alt+z')
  assert.equal(await page.locator('#hotkey').inputValue(), 'Alt+Z')
  assert.equal((await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey, initial.settings.hotkey)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#hotkey').inputValue(), initial.settings.hotkey)
  await page.locator('#hotkey').blur()
  checks.push('Unsaved shortcut capture and cancellation preserve saved shortcut and settings page')
  if (process.platform === 'win32') {
    await page.locator('#hotkey').focus()
    await powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('% ')")
    await eventually('Physical Alt+Space did not reach shortcut recording', async () => (await page.locator('#hotkey').inputValue()) === 'Alt+Space')
    await page.locator('.hotkey-control button[type="submit"]').click()
    await eventually('Alt+Space not saved', async () => (await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey === 'Alt+Space')
    const sendAltSpace = () => powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('% ') ")
    const waitVisibility = visible => eventually(`Native host visibility did not become ${visible}`, async () => {
      const { stdout } = await powershell(`(Get-Process -Id ${child.pid}).MainWindowHandle`)
      return (stdout.trim() !== '0') === visible
    })
    const nativeClose = () => powershell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeSmoke { [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam); }'; $handle = (Get-Process -Id ${child.pid}).MainWindowHandle; if ($handle -eq 0) { throw 'Native window is hidden' }; if (-not [NativeSmoke]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed' }`)
    const show = async () => { await sendAltSpace(); await waitVisibility(true) }
    const emptyLauncher = async () => {
      await page.locator('.app-shell.collapsed').waitFor()
      assert.equal(await page.locator('.settings-layout').count(), 0)
      assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '')
    }
    nativeWindow = { sendAltSpace, waitVisibility, nativeClose, show }
    await page.locator('.app-shell > .search-header .search-input').fill('设置')
    await page.locator('button.brand-button').click()
    await sendAltSpace()
    await waitVisibility(false)
    await show()
    await page.locator('#hotkey').waitFor()
    assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '设置')
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('Escape')
    await emptyLauncher()
    await waitVisibility(true)
    checks.push('Native shortcut show preserves settings page and query; default settings Escape exits to empty visible launcher')
    await page.locator('.app-shell > .search-header .search-input').fill('设置')
    await sendAltSpace()
    await waitVisibility(false)
    await show()
    await emptyLauncher()
    await page.locator('.app-shell > .search-header .search-input').fill('设置')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '')
    await page.keyboard.press('Escape')
    await waitVisibility(false)
    await show()
    await emptyLauncher()
    await page.locator('.app-shell > .search-header .search-input').fill('设置')
    await nativeClose()
    await waitVisibility(false)
    await show()
    await emptyLauncher()
    checks.push('Native launcher shortcut hide/show and WM_CLOSE hide/show clear query and restore default collapse; Escape clears then hides')
    await page.locator('.app-shell > .search-header .search-input').fill('设置')
    await page.locator('button.brand-button').click()
    await nativeClose()
    await emptyLauncher()
    await waitVisibility(true)
    checks.push('Default native settings close exits to empty launcher without hiding')
    await page.locator('button.brand-button').click()
    await page.getByRole('switch', { name: 'ESC 隐藏', exact: true }).click()
    await eventually('ESC hide setting not enabled', async () => (await page.evaluate(() => window.desktop.getSnapshot())).settings.escHide)
    await page.locator('.app-shell > .search-header .search-input').fill('设置')
    await page.locator('button.brand-button').click()
    await nativeClose()
    await waitVisibility(false)
    await show()
    await page.locator('#hotkey').waitFor()
    assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '设置')
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('Escape')
    await waitVisibility(false)
    await show()
    await page.locator('#hotkey').waitFor()
    assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '设置')
    await page.getByRole('switch', { name: 'ESC 隐藏', exact: true }).click()
    await eventually('ESC hide setting not restored', async () => !(await page.evaluate(() => window.desktop.getSnapshot())).settings.escHide)
    checks.push('ESC hide enabled preserves native settings page and query across native close and Escape hide/show; native Windows Alt+Space restores without system menu')
  }
  stage('Exercising updater settings and persistent history')
  await page.getByRole('heading', { name: '在线更新', exact: true }).scrollIntoViewIfNeeded()
  assert.equal(await page.getByRole('button', { name: '检查更新', exact: true }).isEnabled(), expectUpdateSupported)
  await page.screenshot({ path: resolve(evidence, 'updates.png') })
  await page.getByRole('button', { name: '外观主题', exact: true }).click()
  await page.locator('#theme').selectOption('dark')
  await eventually('Theme setting not persisted', async () => (await page.evaluate(() => window.desktop.getSnapshot())).settings.theme === 'dark')
  await page.screenshot({ path: resolve(evidence, 'settings.png') })
  await assert.rejects(page.evaluate(() => window.desktop.updateSettings({ theme: 'invalid' })))
  assert.equal((await page.evaluate(() => window.desktop.getSnapshot())).settings.theme, 'dark')
  checks.push('Actual settings UI persists theme and rejects invalid update without state loss')
  const commands = await page.evaluate(() => window.desktop.listCommands())
  assert.ok(commands.length >= 2)
  await page.evaluate(id => window.desktop.runCommand(id), commands[0].id)
  await page.evaluate(id => window.desktop.runCommand(id), commands[1].id)
  await page.evaluate(id => window.desktop.setPinned(id, true), commands[0].id)
  await quit(page)
  stage('Relaunching NextLeek to verify persistent history and pins')
  page = await launch()
  const reopened = await page.evaluate(() => window.desktop.getSnapshot())
  assert.equal(reopened.settings.theme, 'dark')
  assert.ok(reopened.pinned.includes(commands[0].id))
  await eventually('History window did not follow content height', () => launcherTracksContent(page))
  await page.locator('.launcher').waitFor()
  assert.ok(reopened.recent.includes(commands[0].id))
  checks.push('Reopened empty-query launcher expands with persistent history and pinned commands')
  await page.locator('[data-command-section="pinned"] .command-launch').first().waitFor()
  await page.locator('[data-command-section="recent"] .command-launch').first().waitFor()
  assert.equal(await page.locator('[data-command-section="pinned"] .command-launch').count(), 1)
  assert.equal(await page.locator('[data-command-section="recent"] .command-launch').count(), 2)
  assert.deepEqual(await page.locator('[data-command-section]').evaluateAll(sections => sections.map(section => section.getAttribute('data-command-section'))), ['recent', 'pinned'])
  assert.equal((await page.locator('[data-command-section="recent"] .command-title').last().textContent()).trim(), commands[0].title)
  assert.equal((await page.locator('[data-command-section="pinned"] .command-title').first().textContent()).trim(), commands[0].title)
  assert.equal(await page.locator('[data-command-section="pinned"] .command-launch').first().getAttribute('data-command-index'), '2')
  await page.screenshot({ path: resolve(evidence, 'history-pins.png') })
  checks.push('LMDB theme and pinned commands survive process restart')
  const mainQuery = page.locator('.app-shell > .search-header .search-input')
  const everythingGroup = page.locator('[data-testid="search-provider"][data-provider-id="everything"]')
  const searchFiles = async () => {
    await mainQuery.fill('nextleek-smoke-no-matching-file')
    await everythingGroup.waitFor()
    await eventually('Main native search did not settle', async () => ['ready', 'unavailable', 'unsupported', 'error'].includes(await everythingGroup.getAttribute('data-status')))
  }
  const historyLauncher = async () => {
    await page.locator('.launcher').waitFor()
    await page.locator('[data-command-section="recent"]').waitFor()
    assert.equal(await mainQuery.inputValue(), '')
    assert.equal(await page.locator('.settings-layout').count(), 0)
    assert.equal(await page.getByTestId('search-provider').count(), 0)
  }
  if (nativeWindow) {
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.locator('[data-command-section="pinned"] .command-tile').first().evaluate(tile => tile.classList.contains('selected')), true)
    assert.equal(await page.locator('.command-tile').first().evaluate(tile => tile.classList.contains('selected')), false)
    await nativeWindow.sendAltSpace()
    await nativeWindow.waitVisibility(false)
    await nativeWindow.show()
    await historyLauncher()
    await eventually('Native launcher show did not reset selection', async () => page.locator('.command-tile').first().evaluate(tile => tile.classList.contains('selected')))
    checks.push('Native launcher show resets moved selection to first command and keeps history expanded')
  }
  stage('Exercising main file-search status and native window reset')
  assert.ok(commands.every(command => !command.title.includes('Everything')), 'File search must not register a standalone launcher command')
  await searchFiles()
  const fileStatus = await everythingGroup.getAttribute('data-status')
  if (process.platform !== 'win32') {
    assert.equal(fileStatus, 'unsupported')
    assert.equal(await everythingGroup.getByTestId('search-result-row').count(), 0)
    checks.push('Main launcher shows honest unsupported native-search group on non-Windows')
  } else {
    assert.ok(['ready', 'unavailable', 'error'].includes(fileStatus))
    if (fileStatus !== 'ready') assert.equal(await everythingGroup.getByTestId('search-result-row').count(), 0)
    checks.push(`Main launcher reports actual Windows native-search status: ${fileStatus}`)
  }
  assert.equal(await mainQuery.isEnabled(), true)
  await page.screenshot({ path: resolve(evidence, 'main-file-search.png') })
  await mainQuery.focus()
  await page.keyboard.press('Escape')
  await historyLauncher()
  checks.push('Main file search uses the existing launcher field; Escape clears search and restores history')
  if (nativeWindow) {
    await searchFiles()
    await nativeWindow.sendAltSpace()
    await nativeWindow.waitVisibility(false)
    await nativeWindow.show()
    await historyLauncher()
    await searchFiles()
    await nativeWindow.nativeClose()
    await nativeWindow.waitVisibility(false)
    await nativeWindow.show()
    await historyLauncher()
    await searchFiles()
    await mainQuery.focus()
    await page.keyboard.press('Escape')
    await historyLauncher()
    await nativeWindow.waitVisibility(true)
    await page.keyboard.press('Escape')
    await nativeWindow.waitVisibility(false)
    await nativeWindow.show()
    await historyLauncher()
    checks.push('Native main-search shortcut show and WM_CLOSE reset to history; Escape clears search before hiding')
    await page.evaluate(() => window.desktop.updateSettings({ escHide: true }))
    await searchFiles()
    await nativeWindow.nativeClose()
    await nativeWindow.waitVisibility(false)
    await nativeWindow.show()
    await historyLauncher()
    await searchFiles()
    await mainQuery.focus()
    await page.keyboard.press('Escape')
    await historyLauncher()
    await nativeWindow.waitVisibility(true)
    await page.keyboard.press('Escape')
    await nativeWindow.waitVisibility(false)
    await nativeWindow.show()
    await historyLauncher()
    await page.evaluate(hotkey => window.desktop.updateSettings({ escHide: false, hotkey }), initial.settings.hotkey)
    assert.equal((await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey, initial.settings.hotkey)
    assert.equal((await page.evaluate(() => window.desktop.getSnapshot())).settings.escHide, false)
    checks.push('ESC hide main-search behavior and saved native shortcut survive history restoration')
  }
  await quit(page)
  checks.push('Explicit quit terminates resident process')
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(checks.join('\n'))
} catch (error) {
  console.error(`::error title=Desktop smoke failed::${String(error.stack + '\n' + checks.join('\n') + '\n' + logs.join('').slice(-8000)).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2))
  throw error
} finally {
  try {
    if (browser) await bounded('Final desktop CDP disconnect', () => browser.close()).catch(error => logs.push(String(error)))
    await stopOwnedChild()
  } finally {
    if (applicationFixture) await rm(applicationFixture, { recursive: true, force: true })
    await Promise.all(broadApplicationFixtures.map(fixture => rm(fixture, { recursive: true, force: true })))
    stage(`Cleanup complete; active resources: ${process.getActiveResourcesInfo().join(', ')}`)
    await writeFile(resolve(evidence, 'host.log'), logs.join('\n'))
  }
}
