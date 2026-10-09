import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { promisify } from 'node:util'

const executable = resolve(process.argv[2])
const expectUpdateSupported = process.argv.includes('--expect-update-supported')
const checkUpdates = process.argv.includes('--check-updates')
const appArgs = process.argv.slice(3).filter(arg => !['--expect-update-supported', '--check-updates'].includes(arg))
const profile = await mkdtemp(resolve(tmpdir(), 'nextleek-smoke-'))
const evidence = resolve('artifacts/smoke')
await mkdir(evidence, { recursive: true })
const logs = []
let child
let browser
const checks = []
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
  child = spawn(executable, [...appArgs, '--remote-debugging-port=9333', `--profile-dir=${profile}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => logs.push(String(chunk)))
  child.stderr.on('data', chunk => logs.push(String(chunk)))
  child.on('error', error => logs.push(error.stack))
  await eventually('Electron debugging endpoint unavailable', async () => (await fetch('http://127.0.0.1:9333/json/version')).ok)
  browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
  return eventually('Desktop preload unavailable', async () => {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      if (await page.evaluate(() => typeof window.desktop?.getSnapshot === 'function')) return page
    }
  })
}
async function quit(page) {
  await page.evaluate(() => window.desktop.quit()).catch(() => {})
  await eventually('Resident app did not exit', () => child.exitCode !== null || child.signalCode !== null)
  await browser.close().catch(() => {})
  browser = undefined
}
try {
  let page = await launch()
  await page.locator('button.brand-button').waitFor()
  const initial = await page.evaluate(() => window.desktop.getSnapshot())
  assert.ok(initial.plugins.length >= 3)
  assert.ok(initial.plugins.every(p => p.status === 'active'))
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
  await page.locator('.search-input').fill('设置')
  await eventually('Search did not expand window', async () => (await page.evaluate(() => window.innerHeight)) > 400)
  await page.getByRole('heading', { name: '搜索结果' }).waitFor()
  await page.locator('.search-input').fill('')
  await eventually('Cleared search did not collapse', async () => (await page.evaluate(() => window.innerHeight)) < 120)
  checks.push('Empty launcher collapses; search expands; clearing restores input-only window')
  await page.screenshot({ path: resolve(evidence, 'launcher.png') })
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
    await page.keyboard.press('Alt+Space')
    await page.locator('.hotkey-control button[type="submit"]').click()
    await eventually('Alt+Space not saved', async () => (await page.evaluate(() => window.desktop.getSnapshot())).settings.hotkey === 'Alt+Space')
    const sendAltSpace = () => promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('% ') "])
    await sendAltSpace()
    await eventually('Alt+Space did not hide native host window', async () => {
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).MainWindowHandle`])
      return stdout.trim() === '0'
    })
    await sendAltSpace()
    await eventually('Alt+Space did not restore native host window', async () => {
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).MainWindowHandle`])
      return stdout.trim() !== '0'
    })
    await page.locator('button.brand-button').click()
    await page.evaluate(hotkey => window.desktop.updateSettings({ hotkey }), initial.settings.hotkey)
    checks.push('Native Windows Alt+Space hides and restores app without system menu')
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
  assert.ok(commands.length)
  await page.evaluate(id => window.desktop.setPinned(id, true), commands[0].id)
  await quit(page)
  page = await launch()
  const reopened = await page.evaluate(() => window.desktop.getSnapshot())
  assert.equal(reopened.settings.theme, 'dark')
  assert.ok(reopened.pinned.includes(commands[0].id))
  checks.push('LMDB theme and pinned commands survive process restart')
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
