import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

const executable = resolve(process.argv[2] ?? '')
const appRoot = resolve(process.argv[3] ?? process.cwd())
const evidence = resolve(appRoot, 'artifacts', 'marketplace-smoke')
const profile = await mkdtemp(join(tmpdir(), 'nexttools-marketplace-'))
const pluginId = 'com.nextleek.dashboard'
const logs = []
const checks = []
let child
let browser
let page
let debugPort

await mkdir(evidence, { recursive: true })
function stage(message) {
  logs.push(`Stage: ${message}`)
  console.log(`[marketplace-smoke] ${message}`)
}
async function bounded(description, operation, timeout = 15000) {
  let timer
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${description} timed out after ${timeout}ms`)), timeout) }),
    ])
  } finally { clearTimeout(timer) }
}
async function eventually(description, operation, timeout = 45000) {
  const deadline = Date.now() + timeout
  let cause
  while (Date.now() < deadline) {
    try {
      const value = await bounded(description, operation, Math.min(15000, Math.max(1, deadline - Date.now())))
      if (value) return value
    } catch (error) { cause = error }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  throw new Error(description, { cause })
}
function releaseOwnedStreams(processChild) {
  if (!processChild || (processChild.exitCode === null && processChild.signalCode === null)) return
  for (const stream of [processChild.stdout, processChild.stderr]) {
    stream?.removeAllListeners('data')
    stream?.destroy()
  }
  processChild.unref()
}
async function allocatePort() {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? rejectPort(error) : resolvePort(port))
    })
  })
}
async function debugReady() {
  try {
    return (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(2000) })).ok
  } catch { return false }
}
async function launch() {
  debugPort = await allocatePort()
  stage(`Launching isolated desktop process on CDP port ${debugPort}`)
  child = spawn(executable, [
    ...process.argv.slice(3),
    `--remote-debugging-port=${debugPort}`,
    `--profile-dir=${profile}`,
  ], { cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', chunk => logs.push(String(chunk)))
  child.stderr?.on('data', chunk => logs.push(String(chunk)))
  child.on('error', error => logs.push(error.stack ?? String(error)))
  await eventually('Electron debugging endpoint unavailable', debugReady, 45000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 15000 })
  for (const context of browser.contexts()) context.setDefaultTimeout(15000)
  page = await eventually('Desktop renderer page unavailable', async () => {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        if (await bounded('Renderer preload readiness', () => candidate.evaluate(() => typeof window.desktop?.getSnapshot === 'function')).catch(() => false)) return candidate
      }
    }
    return false
  }, 45000)
  await page.locator('[data-testid="launcher-query"]').waitFor({ state: 'visible', timeout: 30000 })
  return page
}
async function stopProcess() {
  if (!child) return
  if (child.exitCode === null && child.signalCode === null) {
    stage(`Stopping owned desktop process ${child.pid}`)
    if (process.platform === 'win32') {
      await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15000 }).catch(error => {
        if (child.exitCode === null && child.signalCode === null) throw error
      })
    } else child.kill()
    await eventually('Owned desktop process survived cleanup', () => child.exitCode !== null || child.signalCode !== null, 30000)
  }
  releaseOwnedStreams(child)
  child = undefined
}
async function quitProcess() {
  if (!child) return
  await bounded('Desktop quit IPC', () => page?.evaluate(() => window.desktop.quit()), 15000).catch(error => logs.push(error.stack ?? String(error)))
  await eventually('Desktop process did not exit', () => child.exitCode !== null || child.signalCode !== null, 30000)
  await eventually('Desktop debugging endpoint survived quit', async () => !await debugReady(), 15000)
  await bounded('Desktop CDP disconnect', () => browser?.close(), 15000).catch(error => logs.push(error.stack ?? String(error)))
  browser = undefined
  page = undefined
  releaseOwnedStreams(child)
  child = undefined
}
async function openMarketplace() {
  await page.getByTestId('launcher-query').fill('插件市场')
  const command = page.getByRole('button', { name: '插件市场', exact: true })
  await command.waitFor({ state: 'visible', timeout: 30000 })
  await command.click()
  await page.locator('[data-testid="plugin-market"]').waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('[data-testid="plugin-market-entry"][data-plugin-id="com.nextleek.dashboard"]').waitFor({ state: 'visible', timeout: 60000 })
}
async function invokeRejected(plugin, method, args) {
  return await bounded('Secure endpoint rejection', () => page.evaluate(async ({ plugin, method, args }) => {
    try {
      await window.desktop.invokePlugin(plugin, method, args)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, { plugin, method, args }))
}
async function waitInstalledRow() {
  const row = page.locator(`[data-testid="plugin-market-installed-entry"][data-plugin-id="${pluginId}"]`)
  await row.waitFor({ state: 'visible', timeout: 60000 })
  return row
}
async function openInstalledPlugin() {
  const row = await waitInstalledRow()
  await row.getByTestId('plugin-market-open').click()
  await page.locator('[data-testid="plugin-market-frame"]').waitFor({ state: 'visible', timeout: 30000 })
  const frameElement = page.locator('[data-testid="plugin-market-frame"]')
  const frame = await eventually('Dashboard iframe content unavailable', async () => {
    const handle = await frameElement.elementHandle()
    return handle ? await handle.contentFrame() : false
  }, 30000)
  await frame.locator('#date').waitFor({ state: 'visible', timeout: 30000 })
  await frame.locator('#version').waitFor({ state: 'visible', timeout: 30000 })
  await frame.locator('#status').waitFor({ state: 'visible', timeout: 30000 })
  return { frame, frameElement }
}
async function assertDashboard(summary) {
  const { frame, frameElement } = await openInstalledPlugin()
  assert.equal(await frameElement.getAttribute('sandbox'), 'allow-scripts')
  assert.equal(await frameElement.getAttribute('src'), null)
  const bridged = await bounded('Sandbox runtime summary', () => frame.evaluate(async () => await window.nextleek.runtimeSummary()))
  assert.deepEqual(bridged, summary)
  await eventually('Dashboard did not render the actual runtime summary', async () => await frame.locator('#version').textContent() === `v${summary.version}` && await frame.locator('#status').textContent() === `运行正常 · ${summary.mode}`, 15000)
  const values = await bounded('Dashboard sandbox inspection', () => frame.evaluate(() => {
    let parentDom = 'denied'
    try { void window.parent.document; parentDom = 'allowed' } catch { /* sandbox isolation is expected */ }
    return {
      date: document.querySelector('#date')?.textContent ?? '',
      expectedDate: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
      desktopType: typeof window.desktop,
      version: document.querySelector('#version')?.textContent ?? '',
      status: document.querySelector('#status')?.textContent ?? '',
      requireType: typeof window.require,
      processType: typeof window.process,
      parentDom,
      parentIsSelf: window.parent === window,
      topIsSelf: window.top === window,
      runtimeType: typeof window.nextleek?.runtimeSummary,
    }
  }))
  assert.match(values.date, /^\d{4}\/\d{2}\/\d{2}$/)
  assert.equal(values.date, values.expectedDate)
  assert.equal(values.desktopType, 'undefined')
  assert.equal(values.version, `v${summary.version}`)
  assert.equal(values.status, `运行正常 · ${summary.mode}`)
  assert.equal(values.requireType, 'undefined')
  assert.equal(values.processType, 'undefined')
  assert.equal(values.parentDom, 'denied')
  assert.equal(values.parentIsSelf, false)
  assert.equal(values.topIsSelf, false)
  assert.equal(values.runtimeType, 'function')
  checks.push(`Real dashboard iframe rendered date ${values.date}, runtime version ${values.version}, and ${values.status}`)
  await page.screenshot({ path: join(evidence, 'dashboard.png'), timeout: 15000 })
  await writeFile(join(evidence, 'dashboard-runtime.json'), JSON.stringify({ summary, bridged, values }, null, 2))
  return values
}
try {
  assert.ok(executable && executable !== resolve('.'), 'Usage: node scripts/smoke-marketplace.mjs <executable> [app-root]')
  await launch()
  const initialSnapshot = await bounded('Initial desktop snapshot', () => page.evaluate(() => window.desktop.getSnapshot()))
  await openMarketplace()
  const catalog = await bounded('Real host catalog', () => page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'catalog', null)), 45000)
  assert.ok(Array.isArray(catalog) && catalog.some(entry => entry.id === 'com.nextleek.dashboard'))
  const publicResponse = await fetch('https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/index.json', { signal: AbortSignal.timeout(20000), redirect: 'error' })
  assert.equal(publicResponse.status, 200)
  const publicCatalog = await publicResponse.json()
  const publicEntry = publicCatalog.plugins.find(entry => entry.id === pluginId)
  assert.deepEqual(catalog.find(entry => entry.id === pluginId), publicEntry)
  await writeFile(join(evidence, 'catalog.json'), JSON.stringify(publicCatalog, null, 2))
  await page.screenshot({ path: join(evidence, 'catalog.png'), timeout: 15000 })
  checks.push('Loaded the real public marketplace catalog and found com.nextleek.dashboard')

  const wrongEndpoint = await invokeRejected('com.nextleek.unknown', 'catalog', null)
  assert.match(wrongEndpoint, /Unknown plugin endpoint|Invalid plugin id/i)
  const wrongMethod = await invokeRejected('plugin-market', 'notARealMethod', null)
  assert.match(wrongMethod, /Unknown plugin market method|Invalid plugin method/i)
  assert.match(await invokeRejected('../plugin-market', 'installed', null), /Invalid identifier/i)
  assert.match(await invokeRejected('plugin-market', '../open', null), /Invalid identifier/i)
  checks.push('Secured bridge rejects an unknown endpoint and an unknown marketplace method')

  const installButton = page.locator('[data-testid="plugin-market-entry"][data-plugin-id="com.nextleek.dashboard"] [data-testid="plugin-market-install"]')
  await installButton.click()
  await eventually('Marketplace install did not finish', async () => {
    const row = page.locator('[data-testid="plugin-market-entry"][data-plugin-id="com.nextleek.dashboard"]')
    const label = await row.locator('[data-testid="plugin-market-install"]').textContent().catch(() => '')
    return label?.trim() === '已安装' && await installButton.isDisabled()
  }, 90000)
  const statePath = join(profile, 'plugins', 'market-state.json')
  const saved = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(saved.plugins.length, 1)
  assert.equal(saved.plugins[0].catalog.id, pluginId)
  const packagePath = join(profile, 'plugins', saved.plugins[0].file)
  assert.ok((await stat(packagePath)).size > 0)
  const packageBytes = await readFile(packagePath)
  const packageHash = createHash('sha256').update(packageBytes).digest('hex')
  assert.equal(packageHash, publicEntry.sha256)
  assert.equal(saved.plugins[0].catalog.sha256, packageHash)
  await writeFile(join(evidence, 'installed-state.json'), JSON.stringify(saved, null, 2))
  await writeFile(join(evidence, 'package-integrity.json'), JSON.stringify({ id: pluginId, packageUrl: publicEntry.packageUrl, bytes: packageBytes.length, sha256: packageHash }, null, 2))
  checks.push('Installed the verified public .nlplugin and persisted its package/state files in the isolated profile')

  await page.getByTestId('plugin-market-tab-installed').click()
  const row = await waitInstalledRow()
  const switchButton = row.getByTestId('plugin-market-enabled')
  assert.equal(await switchButton.getAttribute('aria-checked'), 'true')
  const initialSummary = await bounded('Initial runtime summary', () => page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'runtimeSummary', null)))
  assert.equal(initialSummary.version, initialSnapshot.plugins.find(plugin => plugin.id === 'plugin-market').version)
  await assertDashboard(initialSummary)
  await page.getByTestId('plugin-market-close').click()
  await switchButton.click()
  await eventually('Dashboard did not become disabled', () => switchButton.getAttribute('aria-checked').then(value => value === 'false'))
  assert.equal(await row.getByTestId('plugin-market-open').isDisabled(), true)
  const disabledError = await invokeRejected('plugin-market', 'open', { id: pluginId })
  assert.match(disabledError, /disabled/i)
  checks.push('Disabled dashboard cannot open through either UI or the secured host bridge')
  await page.screenshot({ path: join(evidence, 'disabled.png'), timeout: 15000 })

  await quitProcess()
  await launch()
  await openMarketplace()
  await page.getByTestId('plugin-market-tab-installed').click()
  const restartedRow = await waitInstalledRow()
  assert.equal(await restartedRow.getByTestId('plugin-market-enabled').getAttribute('aria-checked'), 'false')
  assert.equal(createHash('sha256').update(await readFile(packagePath)).digest('hex'), packageHash)
  const restartedDisabledError = await invokeRejected('plugin-market', 'open', { id: pluginId })
  assert.match(restartedDisabledError, /disabled/i)
  checks.push('Restart preserved the installed package and disabled state')

  await restartedRow.getByTestId('plugin-market-enabled').click()
  await eventually('Dashboard did not become enabled', () => restartedRow.getByTestId('plugin-market-enabled').getAttribute('aria-checked').then(value => value === 'true'))
  const summary = await bounded('Restored runtime summary', () => page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'runtimeSummary', null)))
  assert.equal(summary.mode, 'desktop')
  assert.equal(summary.status, 'ready')
  assert.equal(typeof summary.version, 'string')
  assert.deepEqual(summary, initialSummary)
  await assertDashboard(summary)
  await page.getByTestId('plugin-market-close').click()
  await page.getByTestId('plugin-market-tab-installed').click()

  const finalRow = await waitInstalledRow()
  let dialogSeen = false
  const confirmation = bounded('Uninstall confirmation', async () => {
    const dialog = await page.waitForEvent('dialog', { timeout: 15000 })
    assert.equal(dialog.type(), 'confirm')
    assert.match(dialog.message(), /卸载/)
    dialogSeen = true
    await dialog.accept()
  })
  await finalRow.getByTestId('plugin-market-uninstall').click()
  await confirmation
  await eventually('Marketplace uninstall did not remove dashboard row', async () => await page.locator(`[data-testid="plugin-market-installed-entry"][data-plugin-id="${pluginId}"]`).count() === 0)
  assert.equal(dialogSeen, true)
  const finalState = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(finalState.plugins.length, 0)
  await assert.rejects(stat(packagePath), error => error.code === 'ENOENT')
  assert.deepEqual(await bounded('Installed list after uninstall', () => page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'installed', null))), [])
  assert.match(await invokeRejected('plugin-market', 'open', { id: pluginId }), /not installed/i)
  await writeFile(join(evidence, 'uninstalled-state.json'), JSON.stringify(finalState, null, 2))
  await page.screenshot({ path: join(evidence, 'uninstalled.png'), timeout: 15000 })
  checks.push('Uninstalled through the real confirm UI and removed the persisted package')

  await quitProcess()
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(checks.join('\n'))
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  try { if (page) await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true, timeout: 15000 }) } catch (screenshotError) { logs.push(`Failure screenshot: ${screenshotError.stack ?? screenshotError}`) }
  console.error(`::error title=Marketplace smoke failed::${String(`${message}\n${checks.join('\n')}\n${logs.join('')}`.slice(-16000)).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: false, checks, error: message, screenshot: join(evidence, 'failure.png') }, null, 2))
  throw error
} finally {
  try {
    if (page) await bounded('Final desktop quit', () => page.evaluate(() => window.desktop.quit()), 5000).catch(error => logs.push(error.stack ?? String(error)))
    if (browser) await bounded('Final desktop CDP disconnect', () => browser.close(), 15000).catch(error => logs.push(error.stack ?? String(error)))
    await stopProcess()
  } finally {
    await rm(profile, { recursive: true, force: true })
    await writeFile(join(evidence, 'host.log'), logs.join('\n'))
  }
}
