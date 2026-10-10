import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
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
  await eventually('Electron debugging endpoint unavailable', async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  return eventually('Desktop preload unavailable', async () => {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      if (await page.evaluate(() => typeof window.desktop?.getSnapshot === 'function')) return page
    }
  })
}
async function quit(page) {
  try {
    await page.evaluate(() => window.desktop.quit()).catch(() => {})
    await eventually('Resident app did not exit', () => child.exitCode !== null || child.signalCode !== null)
    await eventually('Desktop debugging endpoint was not released after quit', async () => {
      try { return !(await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(2000) })).ok }
      catch { return true }
    })
  } finally {
    await browser?.close().catch(() => {})
    browser = undefined
  }
}
try {
  let page = await launch()
  await page.locator('button.brand-button').waitFor()
  const initial = await page.evaluate(() => window.desktop.getSnapshot())
  assert.ok(initial.plugins.length >= 3)
  assert.ok(initial.plugins.every(p => p.status === 'active'))
  assert.equal(initial.settings.escHide, false)
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
  await eventually('Search did not expand window', async () => (await page.evaluate(() => window.innerHeight)) > 400)
  await page.getByRole('heading', { name: '搜索结果' }).waitFor()
  await page.keyboard.press('Escape')
  await eventually('Cleared search did not collapse', async () => (await page.evaluate(() => window.innerHeight)) < 120)
  checks.push('Empty launcher collapses; search expands; clearing restores input-only window')
  await page.screenshot({ path: resolve(evidence, 'launcher.png') })
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
  if (process.platform === 'win32') {
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%z')"])
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
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('% ')"])
    await eventually('Physical Alt+Space did not reach shortcut recording', async () => (await page.locator('#hotkey').inputValue()) === 'Alt+Space')
    await page.locator('.hotkey-control button[type="submit"]').click()
    await eventually('Alt+Space not saved', async () => (await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey === 'Alt+Space')
    const sendAltSpace = () => promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('% ') "])
    const waitVisibility = visible => eventually(`Native host visibility did not become ${visible}`, async () => {
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).MainWindowHandle`])
      return (stdout.trim() !== '0') === visible
    })
    const nativeClose = () => promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeSmoke { [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam); }'; $handle = (Get-Process -Id ${child.pid}).MainWindowHandle; if ($handle -eq 0) { throw 'Native window is hidden' }; if (-not [NativeSmoke]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed' }`])
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
    await emptyLauncher()
    await page.locator('.app-shell > .search-header .search-input').fill('设置')
    await page.locator('button.brand-button').click()
    await page.keyboard.press('Escape')
    await waitVisibility(false)
    await show()
    await emptyLauncher()
    await page.locator('button.brand-button').click()
    await page.getByRole('switch', { name: 'ESC 隐藏', exact: true }).click()
    await eventually('ESC hide setting not restored', async () => !(await page.evaluate(() => window.desktop.getSnapshot())).settings.escHide)
    checks.push('ESC hide enabled makes native settings close and Escape hide and reset launcher; native Windows Alt+Space restores without system menu')
  }
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
  page = await launch()
  const reopened = await page.evaluate(() => window.desktop.getSnapshot())
  assert.equal(reopened.settings.theme, 'dark')
  assert.ok(reopened.pinned.includes(commands[0].id))
  await eventually('History and pins did not expand reopened launcher', async () => (await page.evaluate(() => window.innerHeight)) > 400)
  await page.locator('.launcher').waitFor()
  assert.ok(reopened.recent.includes(commands[0].id))
  checks.push('Reopened empty-query launcher expands with persistent history and pinned commands')
  await page.locator('[data-command-section="pinned"] .command-launch').first().waitFor()
  await page.locator('[data-command-section="recent"] .command-launch').first().waitFor()
  assert.equal(await page.locator('[data-command-section="pinned"] .command-launch').count(), 1)
  assert.equal(await page.locator('[data-command-section="recent"] .command-launch').count(), 1)
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
    assert.equal(await page.locator('.command-tile').first().evaluate(tile => tile.classList.contains('selected')), false)
    await nativeWindow.sendAltSpace()
    await nativeWindow.waitVisibility(false)
    await nativeWindow.show()
    await historyLauncher()
    await eventually('Native launcher show did not reset selection', async () => page.locator('.command-tile').first().evaluate(tile => tile.classList.contains('selected')))
    checks.push('Native launcher show resets moved selection to first command and keeps history expanded')
  }
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
  if (process.env.GITHUB_ACTIONS) console.error(`::error title=Desktop smoke failed::${String(error.stack + '\n' + logs.join('').slice(-5000)).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2))
  throw error
} finally {
  if (browser) await browser.close().catch(() => {})
  if (child?.exitCode === null) child.kill()
  await writeFile(resolve(evidence, 'host.log'), logs.join(''))
}
