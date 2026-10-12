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
const profile = await mkdtemp(resolve(tmpdir(), 'nexttools-smoke-'))
const evidence = resolve('artifacts/smoke')
await mkdir(evidence, { recursive: true })
const logs = []
let child
let browser
const checks = []
let nativeWindow
let applicationFixture
const applicationName = `NextTools Smoke App ${basename(profile)}`
const broadApplicationName = `NextTools Height Fixture ${basename(profile)}`
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
    await writeFile(resolve(applicationFixture, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.nexttools.smoke.${basename(profile)}</string><key>CFBundleName</key><string>${applicationName}</string><key>CFBundleDisplayName</key><string>${applicationName}</string><key>CFBundleExecutable</key><string>launch</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>Smoke.icns</string><key>LSBackgroundOnly</key><true/></dict></plist>`)
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
      await writeFile(plist, (await readFile(plist, 'utf8')).replaceAll(applicationName, name).replace(`app.nexttools.smoke.${basename(profile)}`, `app.nexttools.smoke.${basename(profile)}.height${index}`))
    } else await copyFile(applicationFixture, fixture)
  }
}
async function verifyNativeInputDrag(page) {
  const input = page.locator('.app-shell > .search-header .search-input')
  const box = await input.boundingBox()
  assert.ok(box)
  const native = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CursorSmoke { [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }';`
  const { stdout } = await powershell(`${native} $p = New-Object CursorSmoke+POINT; [void][CursorSmoke]::GetCursorPos([ref]$p); Write-Output "$($p.X),$($p.Y)"`)
  const originalCursor = stdout.trim().split(',').map(Number)
  const start = await page.evaluate(() => ({ x: window.screenX, y: window.screenY, scale: window.devicePixelRatio }))
  const point = { x: box.x + 25, y: box.y + box.height / 2 }
  const cursor = { x: Math.round((start.x + point.x) * start.scale), y: Math.round((start.y + point.y) * start.scale) }
  try {
    await powershell(`${native} [void][CursorSmoke]::SetCursorPos(${cursor.x}, ${cursor.y})`)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 2, point.y + 1)
    assert.deepEqual(await page.evaluate(() => ({ x: window.screenX, y: window.screenY })), { x: start.x, y: start.y }, 'Sub-threshold movement must remain an input click')
    await page.mouse.move(point.x + 12, point.y + 4)
    await powershell(`${native} [void][CursorSmoke]::SetCursorPos(${cursor.x + 80}, ${cursor.y + 40})`)
    await eventually('Dragging search input did not move the native window', () => page.evaluate(origin => window.screenX > origin.x + 20 && window.screenY > origin.y + 10, start))
    await page.mouse.up()
    const released = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }))
    await powershell(`${native} [void][CursorSmoke]::SetCursorPos(${cursor.x + 100}, ${cursor.y + 60})`)
    assert.deepEqual(await page.evaluate(() => ({ x: window.screenX, y: window.screenY })), released, 'Pointer release must stop native cursor tracking')
    await input.fill('拖动后仍可输入')
    assert.equal(await input.inputValue(), '拖动后仍可输入')
    await input.focus()
    await page.keyboard.press('Escape')
    checks.push('Search input keeps sub-threshold click behavior, drags the actual native window with physical cursor movement, stops on release and remains editable')
  } finally {
    await page.mouse.up().catch(() => {})
    await powershell(`${native} [void][CursorSmoke]::SetCursorPos(${originalCursor[0]}, ${originalCursor[1]})`)
  }
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
  stage('Allocating debugging port and launching NextTools')
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
  stage(`Quitting NextTools ${child.pid}`)
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
  assert.equal(initial.plugins.find(plugin => plugin.id === 'builtin-search').protected, true)
  assert.equal(initial.plugins.find(plugin => plugin.id === 'builtin-search').enabled, true)
  await assert.rejects(page.evaluate(() => window.desktop.setPluginEnabled('builtin-search', false)), /Core plugins cannot be disabled/)
  const protectedSearch = (await page.evaluate(() => window.desktop.getSnapshot())).plugins.find(plugin => plugin.id === 'builtin-search')
  assert.equal(protectedSearch.enabled, true)
  assert.equal(protectedSearch.status, 'active')
  assert.deepEqual((await page.evaluate(() => window.desktop.searchLauncher({ query: 'NextTools', offset: 0, limit: 30 }))).map(group => group.providerId).sort(), ['applications', 'everything'])
  checks.push('Protected built-in search rejects disable and keeps both application and Everything providers active')
  checks.push('Actual Cordis plugins active through secured preload')
  const updateState = await page.evaluate(() => window.desktop.getUpdateState())
  assert.equal(updateState.supported, expectUpdateSupported)
  if (checkUpdates) {
    const checked = await page.evaluate(() => window.desktop.checkForUpdates())
    assert.equal(checked.status, 'not-available', checked.message)
    checks.push(`Installed updater checks real GitHub release feed for ${checked.currentVersion}`)
  }
  checks.push(expectUpdateSupported ? 'Installed Windows application enables updater' : 'Portable/development application reports unsupported updater honestly')
  await page.locator('.app-shell.collapsed').waitFor()
  await page.locator('.app-shell > .search-header .search-input').fill('设置')
  await page.locator('.launcher .aggregate-view .search-results').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.app-shell.collapsed').waitFor()
  checks.push('Empty launcher collapses; query opens aggregate search; Escape clears search')
  await page.screenshot({ path: resolve(evidence, 'launcher.png') })
  if (applicationFixture) {
    stage('Searching and launching real installed application fixture')
    await page.locator('.app-shell > .search-header .search-input').fill(applicationName)
    const applications = page.locator('[data-command-section="results"]')
    const application = applications.getByTestId('search-result-row').filter({ has: page.locator('.command-title', { hasText: applicationName }) })
    try { await application.waitFor() }
    catch (error) {
      await writeFile(resolve(evidence, 'application-search-dom.html'), await page.content())
      await writeFile(resolve(evidence, 'application-search-provider.json'), JSON.stringify(await page.evaluate(query => window.desktop.searchLauncher({ query, offset: 0, limit: 30 }), applicationName), null, 2))
      await page.screenshot({ path: resolve(evidence, 'application-search-failure.png'), timeout: 5000 }).catch(cause => logs.push(String(cause)))
      throw error
    }
    assert.equal(await application.count(), 1)
    const icon = application.locator('img.application-icon')
    await icon.waitFor()
    await eventually('Installed application icon did not decode as native PNG', () => icon.evaluate(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && image.src.startsWith('data:image/png;base64,')))
    await page.screenshot({ path: resolve(evidence, 'application-search.png') })
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('Enter')
    await eventually('Native application launch did not execute fixture', async () => await readFile(launchMarker, 'utf8') === 'launched')
    assert.equal(await page.getByTestId('search-error').count(), 0)
    checks.push('Real installed application search displays decoded native PNG icon and native launch executes owned marker fixture')
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('Escape')
    await page.locator('.app-shell.collapsed').waitFor()
    stage('Searching one hundred native application fixtures and verifying navigation, expansion and scrolling')
    await page.locator('.app-shell > .search-header .search-input').fill(broadApplicationName)
    await eventually('Broad application search did not show an initial subset', async () => {
      const count = await applications.getByTestId('search-result-row').count()
      return count > 0 && count < 100
    })
    assert.equal(await applications.getByTestId('best-results-expand').textContent(), '展开 (100)')
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('ArrowDown')
    assert.notEqual(await applications.locator('.application-tile.selected').getAttribute('data-result-index'), '0')
    await applications.getByTestId('best-results-expand').click()
    await eventually('Expanded native application search did not fetch all one hundred fixtures', async () => await applications.getByTestId('search-result-row').count() === 100)
    await eventually('Expanded application results are not scrollable', () => applications.evaluate(section => {
      const launcher = section.closest('.launcher')
      launcher.scrollTop = launcher.scrollHeight
      return launcher.scrollHeight > launcher.clientHeight && launcher.scrollTop > 0
    }))
    await page.screenshot({ path: resolve(evidence, 'application-search-capped.png') })
    await page.locator('.app-shell > .search-header .search-input').focus()
    await page.keyboard.press('Escape')
    await page.locator('.app-shell.collapsed').waitFor()
    assert.equal(await page.getByTestId('launcher-query').inputValue(), '')
    checks.push('Native application matches expand from the initial subset, retain keyboard navigation, scroll to the end and clear with Escape')
  }
  await page.locator('button.brand-button').click()
  await page.locator('.app-shell > .search-header .back-button').click()
  await page.locator('.app-shell.collapsed').waitFor()
  assert.equal(await page.getByTestId('launcher-query').inputValue(), '')
  await page.locator('.app-shell > .search-header .search-input').fill('设置')
  await page.screenshot({ path: resolve(evidence, 'search-results.png') })
  await page.locator('button.brand-button').click()
  await page.locator('.app-shell > .search-header .back-button').click()
  assert.equal(await page.getByTestId('launcher-query').inputValue(), '设置')
  await page.locator('.launcher .aggregate-view .search-results').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.app-shell > .search-header .search-input').inputValue(), '')
  await page.locator('.app-shell.collapsed').waitFor()
  checks.push('Settings back preserves query/results; Escape clears the launcher query')
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
    const launcherQuery = page.locator('.app-shell > .search-header .search-input')
    for (const escHide of [false, true]) {
      await page.evaluate(value => window.desktop.updateSettings({ escHide: value }), escHide)
      await launcherQuery.fill('设置')
      await page.locator('button.brand-button').click()
      await sendAltSpace()
      await waitVisibility(false)
      await show()
      await page.locator('#hotkey').waitFor()
      assert.equal(await launcherQuery.inputValue(), '设置')
      await nativeClose()
      await waitVisibility(false)
      await show()
      await page.locator('#hotkey').waitFor()
      assert.equal(await launcherQuery.inputValue(), '设置')
      await page.locator('.settings-sidebar').getByRole('button', { name: '已安装插件', exact: true }).click()
      await nativeClose()
      await waitVisibility(false)
      await show()
      assert.equal((await page.locator('.settings-sidebar .active').textContent()).trim(), '已安装插件')
      assert.equal(await launcherQuery.inputValue(), '设置')
      await page.locator('[data-plugin-detail="builtin-search"]').click()
      await page.locator('.installed-plugins .detail-panel').waitFor()
      const protectedToggle = page.locator('.plugin-detail-summary [role="switch"]')
      assert.equal(await protectedToggle.getAttribute('aria-checked'), 'true')
      assert.equal(await protectedToggle.isDisabled(), true)
      await nativeClose()
      await waitVisibility(false)
      await show()
      await page.locator('.installed-plugins .detail-panel').waitFor()
      assert.equal(await launcherQuery.inputValue(), '设置')
      await launcherQuery.focus()
      await page.keyboard.press('Escape')
      await page.locator('.installed-plugins .plugin-list').waitFor()
      assert.equal(await page.locator('.installed-plugins .detail-panel').count(), 0)
      await launcherQuery.focus()
      await page.keyboard.press('Escape')
      await page.locator('.launcher .aggregate-view .search-results').waitFor()
      assert.equal(await launcherQuery.inputValue(), '设置')
      await waitVisibility(true)
      await sendAltSpace()
      await waitVisibility(false)
      await show()
      assert.equal(await launcherQuery.inputValue(), '设置')
      await page.locator('.launcher .aggregate-view .search-results').waitFor()
      await nativeClose()
      await waitVisibility(false)
      await show()
      assert.equal(await launcherQuery.inputValue(), '设置')
      await page.locator('.launcher .aggregate-view .search-results').waitFor()
      await launcherQuery.focus()
      await page.keyboard.press('Escape')
      await emptyLauncher()
      await page.keyboard.press('Escape')
      await waitVisibility(true)
      await emptyLauncher()
    }
    await page.evaluate(() => window.desktop.updateSettings({ escHide: false }))
    checks.push('Native shortcut and WM_CLOSE preserve settings, installed-plugin details and launcher query/results; Escape returns detail → list → launcher → empty input and never hides at the top')
    if (applicationFixture) {
      await launcherQuery.fill(broadApplicationName)
      const results = page.locator('[data-command-section="results"]')
      await results.getByTestId('best-results-expand').click()
      await eventually('Expanded search did not load all matches', async () => await results.getByTestId('search-result-row').count() === 100)
      await launcherQuery.focus()
      await page.keyboard.press('ArrowDown')
      const selected = await results.locator('.application-tile.selected').getAttribute('data-result-index')
      await sendAltSpace()
      await waitVisibility(false)
      await show()
      assert.equal(await launcherQuery.inputValue(), broadApplicationName)
      assert.equal(await results.getByTestId('search-result-row').count(), 100)
      assert.equal(await results.locator('.application-tile.selected').getAttribute('data-result-index'), selected)
      await launcherQuery.focus()
      await page.keyboard.press('Escape')
      await emptyLauncher()
      checks.push('Native show preserves expanded application search, all loaded matches and selected result')
    }
    await verifyNativeInputDrag(page)
    await page.locator('button.brand-button').click()
  }
  stage('Exercising updater settings and persistent history')
  await page.getByRole('heading', { name: '在线更新', exact: true }).scrollIntoViewIfNeeded()
  assert.equal(await page.getByRole('button', { name: '检查更新', exact: true }).isEnabled(), expectUpdateSupported)
  await page.screenshot({ path: resolve(evidence, 'updates.png') })
  await page.getByRole('button', { name: '通用设置', exact: true }).click()
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
  stage('Relaunching NextTools to verify persistent history and pins')
  page = await launch()
  const reopened = await page.evaluate(() => window.desktop.getSnapshot())
  assert.equal(reopened.settings.theme, 'dark')
  assert.ok(reopened.pinned.includes(commands[0].id))
  await page.locator('.launcher').waitFor()
  assert.ok(reopened.recent.includes(commands[0].id))
  checks.push('Reopened empty-query launcher expands with persistent history and pinned commands')
  await page.locator('[data-command-section="pinned"] .command-launch').first().waitFor()
  await page.locator('[data-command-section="recent"] .command-launch').first().waitFor()
  assert.equal(await page.locator('[data-command-section="pinned"] .command-launch').count(), 1)
  assert.equal(await page.locator('[data-command-section="recent"] .command-launch').count(), 2)
  assert.equal((await page.locator('[data-command-section="pinned"] .command-title').first().textContent()).trim(), commands[0].title)
  await page.screenshot({ path: resolve(evidence, 'history-pins.png') })
  checks.push('LMDB theme and pinned commands survive process restart')
  const mainQuery = page.locator('.app-shell > .search-header .search-input')
  const everythingGroup = page.locator('[data-testid="search-provider"][data-provider-id="everything"]')
  const searchFiles = async () => {
    await mainQuery.fill('nexttools-smoke-no-matching-file')
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
    assert.equal(await page.locator('[data-command-section="pinned"] .command-tile').first().evaluate(tile => tile.classList.contains('selected')), true)
    assert.equal(await page.locator('.command-tile').first().evaluate(tile => tile.classList.contains('selected')), false)
    checks.push('Native launcher show preserves moved selection and keeps history expanded')
  }
  stage('Exercising main file-search status and native state preservation')
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
    for (const escHide of [false, true]) {
      await page.evaluate(value => window.desktop.updateSettings({ escHide: value }), escHide)
      await searchFiles()
      const priorStatus = await everythingGroup.getAttribute('data-status')
      await nativeWindow.sendAltSpace()
      await nativeWindow.waitVisibility(false)
      await nativeWindow.show()
      assert.equal(await mainQuery.inputValue(), 'nexttools-smoke-no-matching-file')
      assert.equal(await everythingGroup.getAttribute('data-status'), priorStatus)
      await nativeWindow.nativeClose()
      await nativeWindow.waitVisibility(false)
      await nativeWindow.show()
      assert.equal(await mainQuery.inputValue(), 'nexttools-smoke-no-matching-file')
      assert.equal(await everythingGroup.getAttribute('data-status'), priorStatus)
      await mainQuery.focus()
      await page.keyboard.press('Escape')
      await historyLauncher()
      await nativeWindow.waitVisibility(true)
      await page.keyboard.press('Escape')
      await nativeWindow.waitVisibility(true)
      await historyLauncher()
    }
    await page.evaluate(hotkey => window.desktop.updateSettings({ escHide: false, hotkey }), initial.settings.hotkey)
    assert.equal((await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey, initial.settings.hotkey)
    assert.equal((await page.evaluate(() => window.desktop.getSnapshot())).settings.escHide, false)
    checks.push('Native main-search shortcut show and WM_CLOSE preserve query/provider status; Escape clears then remains visible regardless of escHide')
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
