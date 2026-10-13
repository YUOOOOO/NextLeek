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
const fixtureSuffix = basename(profile).slice(-6)
const applicationName = `NT Smoke ${fixtureSuffix}`
const broadApplicationName = `NT Height ${fixtureSuffix}`
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
async function waitNativeVisibility(visible) {
  await eventually(`Native host visibility did not become ${visible}`, async () => {
    const { stdout } = await powershell(`(Get-Process -Id ${child.pid}).MainWindowHandle`)
    return (stdout.trim() !== '0') === visible
  })
}
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
  const input = page.locator('.search-box .search-input')
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
  const query = () => page.locator('.search-box .search-input')
  const section = title => page.locator('.collapsible-section').filter({ has: page.locator('.section-title', { hasText: title }) })
  const openSettings = async () => {
    await page.locator('.avatar-wrapper').click()
    await page.locator('.hotkey-input').waitFor({ timeout: 45000 })
  }
  const menu = name => page.locator('.settings-sidebar .menu-item').filter({ has: page.locator('.menu-label', { hasText: name }) })
  await query().waitFor()
  const initial = await page.evaluate(() => window.desktop.getSnapshot())
  assert.ok(initial.plugins.every(plugin => plugin.status === 'active'))
  const searchPlugin = initial.plugins.find(plugin => plugin.id === 'builtin-search')
  assert.equal(searchPlugin.protected, true)
  await assert.rejects(page.evaluate(() => window.desktop.setPluginEnabled('builtin-search', false)), /Core plugins cannot be disabled/)
  const update = await page.evaluate(() => window.desktop.getUpdateState())
  assert.equal(update.supported, expectUpdateSupported)
  if (checkUpdates) assert.equal((await page.evaluate(() => window.desktop.checkForUpdates())).status, 'not-available')
  checks.push('Cordis core search protection and actual updater availability')
  await query().fill('设置')
  await page.locator('.aggregate-view .search-results').waitFor()
  await query().press('Escape')
  assert.equal(await query().inputValue(), '')
  await page.screenshot({ path: resolve(evidence, 'launcher.png') })
  if (applicationFixture) {
    await query().fill(applicationName)
    const application = page.locator('.search-results .app-item').filter({ hasText: applicationName })
    await application.waitFor({ timeout: 45000 })
    const icon = application.locator('img.app-icon')
    await eventually('Native icon did not decode', () => icon.evaluate(image => image.complete && image.naturalWidth > 0 && image.src.startsWith('data:image/png;base64,')))
    const sourceApp = await page.evaluate(async name => (await window.ztools.getApps()).find(app => app.name === name), applicationName)
    assert.ok(sourceApp)
    await page.evaluate(app => window.ztools.pinApp(app), sourceApp)
    await application.click()
    await eventually('Native application fixture did not execute', async () => await readFile(launchMarker, 'utf8') === 'launched')
    checks.push('Original application result renders native icon, pins source object and launches real .lnk/.app marker')
    if (process.platform === 'win32') {
      await waitNativeVisibility(false)
      await powershell('Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class WakeKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }\'; [WakeKeys]::keybd_event(18,0,0,[UIntPtr]::Zero); [WakeKeys]::keybd_event(90,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 100; [WakeKeys]::keybd_event(90,0,2,[UIntPtr]::Zero); [WakeKeys]::keybd_event(18,0,2,[UIntPtr]::Zero)')
      await waitNativeVisibility(true)
      assert.equal(await query().inputValue(), applicationName)
    }
    await query().press('Escape')
    await query().fill(broadApplicationName)
    const best = section('最佳搜索结果')
    await eventually('Initial application subset missing', async () => { const count = await best.locator('.app-item').count(); return count > 0 && count < 100 })
    await best.locator('.expand-btn-text').click()
    await eventually('Expanded source list missing fixtures', async () => await best.locator('.app-item').count() === 100)
    await query().focus()
    await page.keyboard.press('ArrowDown')
    const selection = await best.locator('.app-item.selected').getAttribute('title')
    assert.ok(selection)
    await eventually('Original result area does not scroll', () => page.locator('.scrollable-content').first().evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollHeight > element.clientHeight && element.scrollTop > 0 }))
    await page.screenshot({ path: resolve(evidence, 'application-search-capped.png') })
    await page.evaluate(() => window.desktop.hide())
    if (process.platform === 'win32') {
      await waitNativeVisibility(false)
      await powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%z')")
      await waitNativeVisibility(true)
      assert.equal(await query().inputValue(), broadApplicationName)
      assert.equal(await best.locator('.app-item').count(), 100)
      assert.equal(await best.locator('.app-item.selected').getAttribute('title'), selection)
    }
    await query().press('Escape')
    checks.push('Original expand/navigation/scroll and native hide/show preserve query, full results and selection')
  }
  await query().fill('设置')
  await openSettings()
  assert.ok(await page.locator('.plugin-tag-icon').count())
  assert.ok(!(await page.locator('.content-panel').innerText()).includes('插件内 ESC 直接隐藏'))
  await page.locator('.hotkey-input').click()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.hotkey-input.recording').count(), 0)
  assert.equal((await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey, initial.settings.hotkey)
  await page.locator('.hotkey-input').click()
  await page.keyboard.press('Alt+z')
  await eventually('Original recorder did not save Alt+Z', async () => (await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey === 'Alt+Z' && await page.locator('.hotkey-input.recording').count() === 0)
  checks.push('Original recording cancels with Esc, emits change and persists shortcut')
  if (process.platform === 'win32') {
    await page.locator('.hotkey-input').click()
    await powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('% ')")
    await eventually('Native Alt+Space capture did not save', async () => (await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey === 'Alt+Space')
    const send = () => powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('% ')")
    await send(); await waitNativeVisibility(false)
    await send(); await waitNativeVisibility(true)
    await page.locator('.hotkey-input').waitFor()
    const nativeClose = () => powershell(      "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CloseSmoke { [DllImport(\"user32.dll\")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; $h = (Get-Process -Id " + child.pid + ").MainWindowHandle; [void][CloseSmoke]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)")
    await nativeClose(); await waitNativeVisibility(false)
    await send(); await waitNativeVisibility(true)
    await page.locator('.hotkey-input').waitFor()
    await menu('已安装插件').click()
    await page.keyboard.press('Control+f')
    await eventually('Ctrl+F did not focus source subinput', () => query().evaluate(element => document.activeElement === element))
    await page.locator('.plugin-list .plugin-item').first().click()
    await page.locator('.detail-panel').waitFor()
    await nativeClose(); await waitNativeVisibility(false)
    await send(); await waitNativeVisibility(true)
    await page.locator('.detail-panel').waitFor()
    await query().focus(); await page.keyboard.press('Escape')
    await page.locator('.plugin-list').waitFor()
    await query().focus(); await page.keyboard.press('Escape')
    await page.locator('.plugin-tag').waitFor({ state: 'hidden' })
    await query().press('Escape')
    assert.equal(await query().inputValue(), '')
    await query().press('Escape'); await waitNativeVisibility(true)
    checks.push('Physical Alt+Space capture/save and WM_CLOSE preserve original settings/detail; Esc returns layers and never hides')
    await verifyNativeInputDrag(page)
    await openSettings()
  }
  await menu('通用设置').click()
  const theme = page.locator('.setting-item').filter({ has: page.locator('.setting-label > span', { hasText: /^主题设置$/ }) })
  await theme.locator('.dropdown-trigger').click()
  await theme.locator('.dropdown-item').filter({ hasText: '暗黑' }).click()
  await eventually('Original theme setting did not persist', async () => (await page.evaluate(() => window.desktop.getSnapshot())).settings.theme === 'dark')
  await assert.rejects(page.evaluate(() => window.desktop.updateSettings({ theme: 'invalid' })))
  await page.screenshot({ path: resolve(evidence, 'settings.png') })
  await page.locator('.plugin-tag-close').click()
  await query().press('Escape')
  await quit(page)
  page = await launch()
  await query().waitFor()
  assert.equal((await page.evaluate(() => window.desktop.getSnapshot())).settings.theme, 'dark')
  if (applicationFixture) {
    await section('最近使用').locator('.app-item').filter({ hasText: applicationName }).waitFor({ timeout: 45000 })
    await section('已固定').locator('.app-item').filter({ hasText: applicationName }).waitFor()
  }
  checks.push('Original theme, application history and pinned source objects survive process restart')
  const providers = await page.evaluate(() => window.desktop.searchLauncher({ query: 'nexttools-smoke-no-matching-file', offset: 0, limit: 30 }))
  const files = providers.find(provider => provider.providerId === 'everything')
  assert.ok(files)
  assert.ok((process.platform === 'win32' ? ['ready', 'unavailable', 'error'] : ['unsupported']).includes(files.status))
  await query().fill('nexttools-smoke-no-matching-file')
  await query().press('Escape')
  assert.equal(await query().inputValue(), '')
  await page.evaluate(hotkey => window.desktop.updateSettings({ hotkey }), initial.settings.hotkey)
  checks.push('Real native file-search reports its actual status; original main input clears with Escape')
  await quit(page)
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
