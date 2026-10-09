import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { extractFile, uncache } = appBuilderRequire('@electron/asar')

const execute = promisify(execFile)
const installer = resolve(process.argv[2])
const targetVersion = process.argv[3]
assert.ok(targetVersion, 'Expected target version')
assert.equal(process.platform, 'win32', 'Real NSIS update smoke runs on Windows')
const root = await mkdtemp(join(tmpdir(), 'nextleek-upgrade-'))
const installDirectory = join(root, 'app')
const profile = join(root, 'profile')
const executable = join(installDirectory, 'NextLeek.exe')
const evidence = resolve('artifacts/update-smoke')
await mkdir(evidence, { recursive: true })
let child
let browser
const logs = []
const checks = []
async function eventually(description, operation, timeout = 120000) {
  const deadline = Date.now() + timeout
  let cause
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value } catch (error) { cause = error }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(description, { cause })
}
async function launch() {
  child = spawn(executable, ['--remote-debugging-port=9334', `--profile-dir=${profile}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => logs.push(String(chunk)))
  child.stderr.on('data', chunk => logs.push(String(chunk)))
  child.on('error', error => logs.push(error.stack))
  await eventually('Updater app debugging endpoint unavailable', async () => (await fetch('http://127.0.0.1:9334/json/version')).ok)
  browser = await chromium.connectOverCDP('http://127.0.0.1:9334')
  return eventually('Updater preload unavailable', async () => {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      if (await page.evaluate(() => typeof window.desktop?.getUpdateState === 'function')) return page
    }
  })
}
try {
  await execute(installer, ['/S', `/D=${installDirectory}`], { timeout: 180000 })
  let page = await launch()
  const initial = await page.evaluate(() => window.desktop.getUpdateState())
  assert.equal(initial.supported, true, initial.message)
  assert.notEqual(initial.currentVersion, targetVersion)
  const snapshot = await page.evaluate(() => window.desktop.getSnapshot())
  await page.evaluate(() => window.desktop.updateSettings({ theme: 'dark' }))
  const available = await page.evaluate(() => window.desktop.checkForUpdates())
  assert.equal(available.status, 'available', available.message)
  assert.equal(available.version, targetVersion)
  checks.push(`Real GitHub feed offers ${initial.currentVersion} → ${targetVersion}`)
  const downloaded = await page.evaluate(() => window.desktop.downloadUpdate())
  assert.equal(downloaded.status, 'downloaded', downloaded.message)
  checks.push('Real published NSIS installer downloaded and hash-verified')
  await page.evaluate(() => window.desktop.installUpdate()).catch(() => {})
  await eventually('Old app did not exit for update installation', () => child.exitCode !== null || child.signalCode !== null)
  await browser.close().catch(() => {})
  browser = undefined
  await eventually('NSIS did not replace installed app with target version', () => {
    const archive = join(installDirectory, 'resources', 'app.asar')
    uncache(archive)
    return JSON.parse(extractFile(archive, 'package.json').toString()).version === targetVersion
  }, 180000)
  checks.push(`NSIS installed application version ${targetVersion}`)
  page = await launch()
  const updated = await page.evaluate(() => window.desktop.getUpdateState())
  assert.equal(updated.currentVersion, targetVersion)
  assert.equal(updated.supported, true)
  const restored = await page.evaluate(() => window.desktop.getSnapshot())
  assert.equal(restored.settings.theme, 'dark')
  assert.deepEqual(restored.pinned, snapshot.pinned)
  assert.equal((await page.evaluate(() => window.desktop.checkForUpdates())).status, 'not-available')
  checks.push('Updated app starts, preserves LMDB preferences, and reports latest version')
  await page.evaluate(() => window.desktop.quit()).catch(() => {})
  await eventually('Updated app did not quit', () => child.exitCode !== null || child.signalCode !== null)
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(checks.join('\n'))
} catch (error) {
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2))
  throw error
} finally {
  if (browser) await browser.close().catch(() => {})
  if (child?.exitCode === null) child.kill()
  // NSIS force-run starts a second app with the default profile. Only stop
  // processes whose executable is inside this unique smoke install directory.
  await execute('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:NEXTLEEK_EXE } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { env: { ...process.env, NEXTLEEK_EXE: executable } }).catch(() => {})
  await writeFile(join(evidence, 'host.log'), logs.join(''))
}
