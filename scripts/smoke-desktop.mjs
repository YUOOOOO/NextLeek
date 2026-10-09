import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const executable = resolve(process.argv[2])
const appArgs = process.argv.slice(3)
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
  await page.screenshot({ path: resolve(evidence, 'launcher.png') })
  await page.locator('button.brand-button').click()
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
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2))
  throw error
} finally {
  if (browser) await browser.close().catch(() => {})
  if (child?.exitCode === null) child.kill()
  await writeFile(resolve(evidence, 'host.log'), logs.join(''))
}
