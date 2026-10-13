import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { open } from 'lmdb'
const powershell = source => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { timeout: 15000 })

const executable = resolve(process.argv[2] ?? '')
const appRoot = resolve(process.argv[3] ?? process.cwd())
const evidence = resolve(appRoot, 'artifacts', 'marketplace-smoke')
const profile = await mkdtemp(join(tmpdir(), 'nexttools-marketplace-'))
const pluginId = 'com.nextleek.dashboard'
let pluginName = '仪表盘'
const logs = []
const checks = []
const unresolved = []
let child
let browser
let page
let debugPort

await mkdir(evidence, { recursive: true })
// 临时配置在原生进程启动前设置独占快捷键，避免抢占其他真实桌面验证。
if (process.platform === 'win32') {
  const storage = open({ path: join(profile, 'lmdb'), compression: true })
  storage.putSync('state:v1', { settings: { hotkey: 'Ctrl+Alt+Shift+F11' }, recent: [], pinned: [], enabled: {} })
  await storage.close()
}
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
  // Keep CDP-driven desktop layouts active when macOS runs without a foreground GUI session.
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.locator('.search-input').waitFor({ state: 'visible', timeout: 30000 })
  page.on('console', message => logs.push(`Renderer ${message.type()}: ${message.text()}`))
  page.on('pageerror', error => logs.push(`Renderer error: ${error.stack ?? error}`))
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
// 通过原版头像与菜单进入设置，不依赖重建页面的 testid。
async function openSettings() {
  if (!await page.locator('.settings-sidebar').isVisible()) {
    await page.locator('.avatar-wrapper').click()
    await page.locator('.settings-sidebar').waitFor({ state: 'visible' })
  }
}
async function selectSettings(label) {
  await openSettings()
  const menu = page.locator('.settings-sidebar .menu-item').filter({ hasText: label })
  if (!await menu.evaluate(element => element.classList.contains('active'))) await menu.click()
}
async function openMarketplace() {
  await selectSettings('插件市场')
  await page.locator('.plugin-market').waitFor({ state: 'visible' })
  await marketRow().waitFor({ state: 'visible', timeout: 60000 })
}
function marketRow() {
  return page.locator('.plugin-market .plugin-card').filter({ has: page.locator('.plugin-name', { hasText: pluginName }) })
}
async function assertSourceNavigation() {
  await marketRow().click()
  await page.locator('.detail-panel').waitFor({ state: 'visible' })
  await page.locator('.search-input').focus()
  await page.keyboard.press('Escape')
  await page.locator('.detail-panel').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.plugin-market').isVisible(), true)
  await page.locator('.search-input').focus()
  await page.keyboard.press('Escape')
  await page.locator('.settings-sidebar').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.search-input').isVisible(), true)
  await openMarketplace()
  checks.push('Original market detail Escape returns to the list; top-level settings Escape returns to the original launcher')
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
  await selectSettings('已安装插件')
  const row = page.locator('.plugin-list .plugin-item').filter({ has: page.locator('.plugin-name', { hasText: pluginName }) })
  await row.waitFor({ state: 'visible', timeout: 60000 })
  return row
}
// 管理控件位于详情页；列表卡片只提供打开入口。
async function openInstalledDetail() {
  const row = await waitInstalledRow()
  await row.click()
  const detail = page.locator('.detail-panel')
  await detail.waitFor({ state: 'visible' })
  await detail.getByTitle('插件设置', { exact: true }).click()
  await detail.locator('.settings-dropdown-item').filter({ hasText: '启用插件' }).locator('input').waitFor({ state: 'attached' })
  return detail
}
// 通过真实 CDP target 识别插件视图，不再进入宿主 iframe。
async function nativePluginPage(previous = new Set()) {
  return await eventually('Independent plugin WebContentsView page unavailable', async () => {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        if (previous.has(candidate) || candidate === page || candidate.isClosed()) continue
        if (await candidate.evaluate(() => window.top === window && typeof window.nextleek?.runtimeSummary === 'function' && typeof window.desktop === 'undefined').catch(() => false)) return candidate
      }
    }
    return false
  }, 30000)
}
async function openInstalledPlugin() {
  const previous = new Set(browser.contexts().flatMap(context => context.pages()))
  await writeFile(join(evidence, 'settings-return-layout.json'), JSON.stringify(await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, title: document.querySelector('.plugin-tag-title')?.textContent, elements: [...document.querySelectorAll('.app-container, .plugin-placeholder, .settings-sidebar, .plugin-list, .embedded-settings')].map(element => ({ className: element.className, rect: element.getBoundingClientRect().toJSON(), display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility, height: getComputedStyle(element).height })) })), null, 2))
  const row = await waitInstalledRow()
  try {
    await row.getByTitle('打开插件', { exact: true }).click()
  } catch (error) {
    await writeFile(join(evidence, 'settings-return-failure.json'), JSON.stringify(await page.evaluate(() => ({ run: Date.now(), url: location.href, viewport: { width: innerWidth, height: innerHeight }, title: document.querySelector('.plugin-tag-title')?.textContent, rectangles: [...document.querySelectorAll('.app-container, .plugin-placeholder, .settings-sidebar, .plugin-list')].map(element => ({ className: element.className, rect: element.getBoundingClientRect().toJSON() })) })), null, 2))
    throw error
  }
  await page.locator('.plugin-tag-title').filter({ hasText: pluginName }).waitFor({ state: 'visible', timeout: 30000 })
  const frame = await nativePluginPage(previous)
  await frame.locator('#date').waitFor({ state: 'visible', timeout: 30000 })
  await frame.locator('#version').waitFor({ state: 'visible', timeout: 30000 })
  await frame.locator('#status').waitFor({ state: 'visible', timeout: 30000 })
  return { frame }
}
async function assertDashboard(summary) {
  const { frame } = await openInstalledPlugin()
  assert.equal(await page.locator('iframe').count(), 0)
  const bridged = await bounded('Sandbox runtime summary', () => frame.evaluate(async () => await window.nextleek.runtimeSummary()))
  assert.deepEqual(bridged, summary)
  await eventually('Dashboard did not render the actual runtime summary', async () => await frame.locator('#version').textContent() === `v${summary.version}` && await frame.locator('#status').textContent() === `运行正常 · ${summary.mode}`, 15000)
  assert.equal(await frame.locator('#platform').textContent(), summary.platform)
  assert.equal(await frame.locator('#mode').textContent(), summary.mode)
  assert.equal(await frame.locator('#runtime-status').textContent(), summary.status)
  assert.equal(await frame.locator('#installed').textContent(), String(summary.installed))
  assert.equal(await frame.locator('#enabled').textContent(), String(summary.enabled))
  await writeFile(join(evidence, 'native-layout.json'), JSON.stringify({
    host: await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, placeholder: document.querySelector('.plugin-placeholder')?.getBoundingClientRect().toJSON(), containers: [...document.querySelectorAll('.app-container, .search-window, .plugin-placeholder')].map(element => ({ className: element.className, rect: element.getBoundingClientRect().toJSON(), height: getComputedStyle(element).height, flex: getComputedStyle(element).flex })) })),
    plugin: await frame.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, refresh: document.querySelector('#refresh')?.getBoundingClientRect().toJSON(), scrollHeight: document.documentElement.scrollHeight })),
  }, null, 2))
  await frame.getByRole('button', { name: '刷新概览', exact: true }).click()
  await eventually('Dashboard refresh did not complete', async () => await frame.locator('#feedback').textContent() === '已获取最新宿主运行信息。')
  assert.equal(await frame.locator('#version').textContent(), `v${summary.version}`)
  checks.push('Dashboard refresh renders the real platform, mode, status and installed/enabled counts')
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
  assert.equal(values.parentDom, 'allowed')
  assert.equal(values.parentIsSelf, true)
  assert.equal(values.topIsSelf, true)
  assert.equal(values.runtimeType, 'function')
  checks.push(`Independent sandbox WebContentsView rendered date ${values.date}, runtime version ${values.version}, and ${values.status}`)
  await page.screenshot({ path: join(evidence, 'dashboard.png'), timeout: 15000 })
  await writeFile(join(evidence, 'dashboard-runtime.json'), JSON.stringify({ summary, bridged, values }, null, 2))
  return frame
}
try {
  assert.ok(executable && executable !== resolve('.'), 'Usage: node scripts/smoke-marketplace.mjs <executable> [app-root]')
  await launch()
  const initialSnapshot = await bounded('Initial desktop snapshot', () => page.evaluate(() => window.desktop.getSnapshot()))
  await openMarketplace()
  const catalog = await bounded('Real host catalog', () => page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'catalog', null)), 45000)
  assert.ok(Array.isArray(catalog) && catalog.some(entry => entry.id === 'com.nextleek.dashboard'))
  pluginName = catalog.find(entry => entry.id === pluginId).name
  await assertSourceNavigation()
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

  const sourceCatalog = await page.evaluate(() => window.ztools.internal.fetchPluginMarket())
  const sourceEntry = sourceCatalog.data.find(entry => entry.name === pluginId)
  assert.equal(sourceEntry.sourceLabel, '受信任静态插件（.nlplugin）')
  assert.deepEqual(publicEntry.permissions, [])
  await marketRow().getByTitle('下载', { exact: true }).click()
  await eventually('Marketplace install did not finish', async () => (await page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'installed', null))).some(entry => entry.id === pluginId), 90000)
  checks.push('Original download action installs the permission-free trusted static catalog package; original UI has no reconstructed install-confirmation modal')
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

  const row = await waitInstalledRow()
  assert.equal(await row.getByTitle('打开插件', { exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: /^更新\s*0$/ }).click()
  await page.getByText('全部插件均为最新版本', { exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /^全部\s*\d+$/ }).click()
  await row.waitFor({ state: 'visible' })
  checks.push('Original installed-plugin update tab reports the freshly installed approved package as latest; no older approved catalog fixture is available for an upgrade action')
  const initialSummary = await bounded('Initial runtime summary', () => page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'runtimeSummary', null)))
  assert.equal(initialSummary.version, initialSnapshot.plugins.find(plugin => plugin.id === 'plugin-market').version)
  const firstPluginPage = await assertDashboard(initialSummary)
  const identitySession = await firstPluginPage.context().newCDPSession(firstPluginPage)
  const beforeIdentity = (await identitySession.send('Target.getTargetInfo')).targetInfo.targetId
  await firstPluginPage.evaluate(() => { document.body.dataset.preserved = 'native-view-kept' })
  if (process.platform === 'win32' && !process.argv.includes('--skip-physical-wake')) {
    await page.evaluate(() => { window.marketSmokeShown = 0; window.desktop.subscribe(event => { if (event.type === 'shown') window.marketSmokeShown++ }) })
    await page.evaluate(() => window.desktop.hide())
    await eventually('Native launcher did not hide', async () => (await powershell(`(Get-Process -Id ${child.pid}).MainWindowHandle`)).stdout.trim() === '0')
    assert.equal(firstPluginPage.isClosed(), false)
    await powershell('Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class WakeKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }\'; foreach ($key in @(17,18,16,122)) { [WakeKeys]::keybd_event($key,0,0,[UIntPtr]::Zero) }; Start-Sleep -Milliseconds 100; foreach ($key in @(122,16,18,17)) { [WakeKeys]::keybd_event($key,0,2,[UIntPtr]::Zero) }')
    try {
      await eventually('Native shortcut did not emit launcher shown', () => page.evaluate(() => window.marketSmokeShown > 0), 10000)
    } catch (error) {
      unresolved.push(error.message)
      logs.push(`Physical wake unresolved: ${error.message}; independent management can be exercised with --skip-physical-wake`)
      throw error
    }
    await page.locator('.plugin-tag-title').filter({ hasText: pluginName }).waitFor({ state: 'visible' })
    assert.equal((await identitySession.send('Target.getTargetInfo')).targetInfo.targetId, beforeIdentity)
    assert.equal(await firstPluginPage.evaluate(() => document.body.dataset.preserved), 'native-view-kept')
    checks.push('Native hide/show preserved plugin CDP target id and modified document state')
  } else unresolved.push('Physical native hide/wake identity was not exercised: Windows input desktop unavailable; independent lifecycle keeps the original OS-visible window')
  for (const escHide of [false, true]) {
    await page.evaluate(value => window.desktop.updateSettings({ escHide: value }), escHide)
    const headerPage = escHide ? (await openInstalledPlugin()).frame : firstPluginPage
    await page.getByTitle('返回搜索', { exact: true }).focus()
    await page.keyboard.press('Escape')
    await eventually('Header Escape did not destroy native plugin page', () => headerPage.isClosed())
    await page.locator('.settings-sidebar').waitFor({ state: 'visible' })
    assert.ok(await page.evaluate(() => innerHeight >= 690), 'Restored settings height must remain at least 690')
    if (process.platform === 'win32') logs.push(`Header Escape native handle: ${(await powershell(`(Get-Process -Id ${child.pid}).MainWindowHandle`)).stdout.trim()}`)
    assert.equal(await page.locator('.settings-sidebar .menu-item.active .menu-label').textContent(), '已安装插件')
    await page.locator('.plugin-list .plugin-item').filter({ has: page.locator('.plugin-name', { hasText: pluginName }) }).waitFor({ state: 'visible' })
    const { frame } = await openInstalledPlugin()
    await frame.getByRole('button', { name: '刷新概览', exact: true }).focus()
    // DOM 聚焦不等于 Electron WebContents 聚焦；先走现有授权原生焦点接口。
    await page.evaluate(() => window.ztools.focusPlugin())
    // CDP keyboard.press 不触发 Electron before-input-event；用已授权的原生输入验证关闭链路。
    await page.evaluate(() => window.ztools.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }))
    try {
      await eventually('Plugin Escape did not destroy native plugin page', () => frame.isClosed())
    } catch (error) {
      unresolved.push(`Native Electron Escape unresolved: ${error.message}`)
      await page.getByTitle('返回搜索', { exact: true }).click()
      await eventually('Header close did not destroy native plugin page', () => frame.isClosed())
    }
    await page.locator('.settings-sidebar').waitFor({ state: 'visible' })
    assert.equal(await page.locator('.settings-sidebar .menu-item.active .menu-label').textContent(), '已安装插件')
    await page.locator('.plugin-list .plugin-item').filter({ has: page.locator('.plugin-name', { hasText: pluginName }) }).waitFor({ state: 'visible' })
    await page.locator('.search-input').focus()
    await page.keyboard.press('Escape')
    await page.locator('.settings-sidebar').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.search-input').isVisible(), true)
  }
  await page.evaluate(() => window.desktop.updateSettings({ escHide: false }))
  checks.push('Header and native Electron Escape destroy the native viewer and restore the originating installed-plugin list for either legacy escHide value; next Escape returns to the visible launcher. Physical keyboard input is not covered')
  const detailRow = await openInstalledDetail()
  const switchButton = detailRow.locator('.settings-dropdown-item').filter({ hasText: '启用插件' }).locator('input[type="checkbox"]')
  assert.equal(await switchButton.isChecked(), true)
  const beforeDisable = new Set(browser.contexts().flatMap(context => context.pages()))
  const disabledSession = await page.evaluate(id => window.desktop.invokePlugin('plugin-market', 'open', { id }), pluginId)
  const disabledPage = await nativePluginPage(beforeDisable)
  await detailRow.locator('.settings-dropdown-item').filter({ hasText: '启用插件' }).locator('label.toggle').click()
  await eventually('Disabling plugin did not destroy its native page', () => disabledPage.isClosed())
  assert.match(await invokeRejected('plugin-market', 'invokeCapability', { session: disabledSession.session, sourcePluginId: pluginId, sourceId: 'none', method: 'none', args: {} }), /closed|revoked/i)
  await eventually('Dashboard did not become disabled', async () => !await switchButton.isChecked())
  await eventually('Disabled dashboard original open control remained enabled', () => detailRow.getByTitle('打开', { exact: true }).isDisabled())
  const disabledError = await invokeRejected('plugin-market', 'open', { id: pluginId })
  assert.match(disabledError, /disabled/i)
  checks.push('Disabling dashboard destroys its native page, revokes the session and blocks both UI and secured host reopen')
  await page.screenshot({ path: join(evidence, 'disabled.png'), timeout: 15000 })

  await quitProcess()
  await launch()
  await openMarketplace()
  const restartedRow = await openInstalledDetail()
  assert.equal(await restartedRow.locator('.settings-dropdown-item').filter({ hasText: '启用插件' }).locator('input').isChecked(), false)
  assert.equal(createHash('sha256').update(await readFile(packagePath)).digest('hex'), packageHash)
  const restartedDisabledError = await invokeRejected('plugin-market', 'open', { id: pluginId })
  assert.match(restartedDisabledError, /disabled/i)
  checks.push('Restart preserved the installed package and disabled state')

  const restoredSwitch = restartedRow.locator('.settings-dropdown-item').filter({ hasText: '启用插件' }).locator('input')
  await restartedRow.locator('.settings-dropdown-item').filter({ hasText: '启用插件' }).locator('label.toggle').click()
  await eventually('Dashboard did not become enabled', () => restoredSwitch.isChecked())
  await restartedRow.getByRole('button', { name: '返回', exact: true }).click()
  await waitInstalledRow()
  const summary = await bounded('Restored runtime summary', () => page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'runtimeSummary', null)))
  assert.equal(summary.mode, 'desktop')
  assert.equal(summary.status, 'ready')
  assert.equal(typeof summary.version, 'string')
  assert.deepEqual(summary, initialSummary)
  const restoredPluginPage = await assertDashboard(summary)
  await page.getByTitle('返回搜索', { exact: true }).click()
  await eventually('Closing restored plugin did not destroy native page', () => restoredPluginPage.isClosed())

  const finalRow = await openInstalledDetail()
  const beforeUninstall = new Set(browser.contexts().flatMap(context => context.pages()))
  const uninstalledSession = await page.evaluate(id => window.desktop.invokePlugin('plugin-market', 'open', { id }), pluginId)
  const uninstalledPage = await nativePluginPage(beforeUninstall)
  const confirmation = page.locator('.dialog-overlay')
  await finalRow.getByTitle('卸载', { exact: true }).click()
  await confirmation.waitFor({ state: 'visible' })
  assert.match(await confirmation.textContent(), /删除插件/)
  await confirmation.getByRole('button', { name: '删除', exact: true }).click()
  await eventually('Marketplace uninstall did not remove dashboard row', async () => await page.locator('.plugin-list .plugin-item').filter({ has: page.locator('.plugin-name', { hasText: pluginName }) }).count() === 0)
  await eventually('Uninstall did not destroy its native plugin page', () => uninstalledPage.isClosed())
  assert.match(await invokeRejected('plugin-market', 'invokeCapability', { session: uninstalledSession.session, sourcePluginId: pluginId, sourceId: 'none', method: 'none', args: {} }), /closed|revoked/i)
  const finalState = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(finalState.plugins.length, 0)
  await assert.rejects(stat(packagePath), error => error.code === 'ENOENT')
  assert.deepEqual(await bounded('Installed list after uninstall', () => page.evaluate(() => window.desktop.invokePlugin('plugin-market', 'installed', null))), [])
  assert.match(await invokeRejected('plugin-market', 'open', { id: pluginId }), /not installed/i)
  await writeFile(join(evidence, 'uninstalled-state.json'), JSON.stringify(finalState, null, 2))
  await page.screenshot({ path: join(evidence, 'uninstalled.png'), timeout: 15000 })
  checks.push('Confirmed uninstall destroys the native page, revokes its session and removes the persisted package')
  assert.deepEqual(unresolved, [], 'Physical native wake remains unresolved; other lifecycle evidence is retained')

  await quitProcess()
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(checks.join('\n'))
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  // 截图失败也保留磁盘安装状态与包校验结果，不再丢失宿主侧证据。
  try {
    const state = JSON.parse(await readFile(join(profile, 'plugins', 'market-state.json'), 'utf8'))
    const packages = await Promise.all(state.plugins.map(async record => {
      const bytes = await readFile(join(profile, 'plugins', record.file))
      return { id: record.catalog.id, file: record.file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    }))
    await writeFile(join(evidence, 'failure-state.json'), JSON.stringify({ state, packages }, null, 2))
  } catch (stateError) { logs.push(`Failure state capture: ${stateError.stack ?? stateError}`) }
  try { if (process.platform === 'win32' && child) logs.push(`Native failure window handle: ${(await powershell(`(Get-Process -Id ${child.pid}).MainWindowHandle`)).stdout.trim()}`) } catch (visibilityError) { logs.push(`Native visibility: ${visibilityError.stack ?? visibilityError}`) }
  try { if (page) await writeFile(join(evidence, 'source-failure-trace.json'), JSON.stringify(await page.evaluate(() => ({ run: Date.now(), url: location.href, scripts: [...document.scripts].map(script => script.src), visibility: document.visibilityState, focused: document.hasFocus(), viewport: { width: innerWidth, height: innerHeight }, title: document.querySelector('.plugin-tag-title')?.textContent })), null, 2)) } catch (traceError) { logs.push(`Source trace: ${traceError.stack ?? traceError}`) }
  try { if (page) await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true, timeout: 15000 }) } catch (screenshotError) { logs.push(`Failure screenshot: ${screenshotError.stack ?? screenshotError}`) }
  console.error(`::error title=Marketplace smoke failed::${String(`${message}\n${checks.join('\n')}\n${logs.join('')}`.slice(-16000)).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: false, checks, blocked: unresolved, error: message, screenshot: join(evidence, 'failure.png') }, null, 2))
  throw error
} finally {
  try {
    if (page) await bounded('Final desktop quit', () => page.evaluate(() => window.desktop.quit()), 5000).catch(error => logs.push(error.stack ?? String(error)))
    if (browser) await bounded('Final desktop CDP disconnect', () => browser.close(), 15000).catch(error => logs.push(error.stack ?? String(error)))
    await stopProcess()
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    await writeFile(join(evidence, 'host.log'), logs.join('\n'))
  }
}
