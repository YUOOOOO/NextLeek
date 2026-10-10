import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createEverythingService, type EverythingEnvironment, type EverythingPorts } from '../src/host/services/everything'
import type { EverythingSearchRequest } from '../src/shared/contracts'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRuntime } from '../src/host/runtime'

const request: EverythingSearchRequest = { query: 'ext:txt', filter: 'all', sort: 'name', descending: false, offset: 0, limit: 2 }
function row(name = '报告.txt', attributes: number | null = 0) {
  return { name, path: 'C:\\资料', filename: `C:\\资料\\${name}`, size: 123, date_modified: '2026-10-10T12:34:56Z', attributes }
}
function harness() {
  const ctx = new Context()
  const calls: Array<{ executable: string; args: string[]; options: Parameters<EverythingPorts['execute']>[2] }> = []
  const actions: Array<[string, string]> = []
  let output = ''
  let error: Error | null = null
  let missing = false
  let directory = false
  let openError = ''
  let hold = false
  let killed = 0
  const completions: Array<(error: Error | null, stdout: string) => void> = []
  const environment: EverythingEnvironment = {
    executable: 'C:\\NextLeek\\everything\\es.exe', platform: 'win32',
    async openPath(path) { actions.push(['open', path]); return openError },
    revealPath(path) { actions.push(['reveal', path]) },
    copyPath(path) { actions.push(['copy-path', path]) },
  }
  const ports: EverythingPorts = {
    execute(executable, args, options, done) {
      calls.push({ executable, args, options })
      if (hold) completions.push(done)
      else queueMicrotask(() => done(error, output))
      return { kill() { killed++; return true } }
    },
    async stat() {
      if (missing) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return { isDirectory: () => directory }
    },
  }
  const service = createEverythingService(ctx, environment, ports)
  return { ctx, calls, actions, environment, ports, service, completions, output(value: unknown) { output = typeof value === 'string' ? value : JSON.stringify(value) }, error(value: Error | null) { error = value }, missing(value: boolean) { missing = value }, directory(value: boolean) { directory = value }, openError(value: string) { openError = value }, hold(value: boolean) { hold = value }, killed: () => killed }
}

// ES-1.1.0.38.src.zip, src/es.c:10955-11043: _es_get_command_argv.
// -search calls this decoder regardless of -argv; it does NOT use CRT escapes.
function decodeEsSearchParameter(commandLine: string) {
  let query = ''
  let inQuote = false
  let index = 0
  for (; index < commandLine.length; index++) {
    const character = commandLine[index]
    if (!inQuote && /[ \t\r\n]/.test(character)) break
    if (character === '"') {
      if (commandLine.slice(index, index + 3) === '"""') { query += '"'; index += 2 }
      else inQuote = !inQuote
    } else query += character
  }
  return { query, remaining: commandLine.slice(index) }
}

test('ES protocol preserves a whole Everything query without exposing command options', async () => {
  const h = harness()
  try {
    const query = '-export-txt "C:\\报告 2026.txt" | <ext:txt !file:> & regex:"测试.*"'
    const result = await h.service.search({ ...request, query, filter: 'files', sort: 'modified', descending: true, offset: 25 })
    assert.deepEqual(result, { items: [], hasMore: false, offset: 25 })
    assert.deepEqual(h.calls[0].args, ['-no-argv', '-json', '-code-page', '65001', '-date-format', '3', '-columns', 'name;path;filename;size;date-modified;attributes', '-timeout', '5000', '-max-results', '3', '-offset', '25', '/a-d', '-sort', 'date-modified', '-sort-descending', '-search', '"-export-txt """C:\\报告 2026.txt""" | <ext:txt !file:> & regex:"""测试.*""""'])
    await h.service.search({ ...request, filter: 'folders', sort: 'path' })
    assert(h.calls[1].args.includes('/ad') && h.calls[1].args.includes('-sort-ascending'))
    await h.service.search({ ...request, sort: 'size' })
    assert(!h.calls[2].args.includes('/ad') && !h.calls[2].args.includes('/a-d'))
    await assert.rejects(h.service.search({ ...request, query: '\u0000' }), /query/)
    assert.equal(h.calls.length, 3)
  } finally { await h.ctx.fiber.dispose() }
})

test('native ES parameter transport preserves quoted paths, backslashes, Unicode and switch-like queries', async () => {
  const h = harness()
  h.environment.executable = 'C:\\Program Files\\NextLeek\\everything\\es.exe'
  const queries = [
    '', 'ext:txt', '  leading and trailing spaces  ',
    '"C:\\Users\\测试 用户\\NextLeek\\fixtures\\"',
    '"\\\\server\\共享 空间\\fixtures\\"',
    'regex:"C:\\\\资料\\\\[^\\\\]+\\.txt$"',
    '-export-txt "C:\\报告 2026.txt" | <ext:txt !file:> & regex:"测试.*"',
    '" -exit -export-txt C:\\results.txt "', '"', '""', '"""', '""""',
    '  ""quoted"" """ Unicode 文档😀 & | <>  ', 'C:\\trailing\\',
  ]
  try {
    for (const query of queries) {
      await h.service.search({ ...request, query })
      const call = h.calls.at(-1)!
      assert.equal(call.options.shell, false)
      assert.equal(call.options.windowsVerbatimArguments, true)
      assert.equal(call.executable, h.environment.executable)
      assert.equal(call.options.argv0, '"C:\\Program Files\\NextLeek\\everything\\es.exe"')
      assert.equal(call.args.at(-2), '-search')
      // A following switch must remain outside the consumed query argument.
      assert.deepEqual(decodeEsSearchParameter(`${call.args.at(-1)} -sentinel`), { query, remaining: ' -sentinel' })
      assert.equal(call.args.includes('-max-results'), true)
      assert.equal(call.args.includes('-n'), false)
    }
  } finally { await h.ctx.fiber.dispose() }
})

test('Unicode JSON results preserve metadata, normalize folders, and keep lookahead pagination', async () => {
  const h = harness()
  try {
    h.output([
      row(),
      { ...row('子目录', 16), filename: 'C:\\资料\\子目录\\' },
      row('lookahead.txt'),
    ])
    const result = await h.service.search(request)
    assert.equal(result.hasMore, true); assert.equal(result.items.length, 2)
    assert.equal(result.items[0].path, 'C:\\资料\\报告.txt'); assert.equal(result.items[0].name, '报告.txt')
    assert.equal(result.items[1].path, 'C:\\资料\\子目录'); assert.equal(result.items[1].name, '子目录')
    assert.equal(result.items[1].isDirectory, true); assert.equal(result.items[1].size, null)
    assert.match(result.items[0].id, /^[a-f0-9-]{36}$/); assert.notEqual(result.items[0].id, result.items[1].id)
    h.output([{ ...row('未知大小.txt'), size: null, date_modified: null }])
    const nullable = await h.service.search(request)
    assert.equal(nullable.items[0].size, null); assert.equal(nullable.items[0].modifiedAt, null)
    h.output([{ ...row('C:', 16), path: '', filename: 'C:\\' }])
    const root = await h.service.search(request)
    assert.equal(root.items[0].name, 'C:'); assert.equal(root.items[0].path, 'C:\\')
    await assert.rejects(h.service.performAction('unknown', 'open'), /失效/)
  } finally { await h.ctx.fiber.dispose() }
})

test('missing engine, missing bundled ES and unsupported hosts report genuine states', async () => {
  const h = harness()
  try {
    h.output('1.4.1.1026\r\n'); assert.equal((await h.service.getStatus()).status, 'ready'); assert.deepEqual(h.calls[0].args, ['-no-argv', '-get-everything-version'])
    h.error(Object.assign(new Error('IPC not found'), { code: 8 })); assert.match((await h.service.getStatus()).message, /安装并启动 Everything/)
    await assert.rejects(h.service.search(request), /安装并启动 Everything/)
    h.error(Object.assign(new Error('missing'), { code: 'ENOENT' })); assert.match((await h.service.getStatus()).message, /ES.exe.*重新安装/)
    h.error(Object.assign(new Error('timeout'), { killed: true })); await assert.rejects(h.service.search(request), /超时/)
    for (const environment of [undefined, { ...h.environment, platform: 'darwin' as const }]) {
      const unsupported = createEverythingService(h.ctx, environment, h.ports)
      assert.equal((await unsupported.getStatus()).status, 'unsupported'); await assert.rejects(unsupported.search(request), /仅支持 Windows/)
    }
  } finally { await h.ctx.fiber.dispose() }
})

test('malformed output and stale filesystem entries never become fabricated results', async () => {
  const h = harness()
  try {
    for (const output of ['not-json', '{}', JSON.stringify([{ ...row(), filename: 'relative.txt' }]), JSON.stringify([{ ...row(), filename: '' }]), JSON.stringify([{ ...row(), date_modified: 123 }])]) { h.output(output); await assert.rejects(h.service.search(request)) }
    h.output([row(), row(), row(), row()]); await assert.rejects(h.service.search(request), /超出请求范围/)
    h.output([row('类型未知', null)]); h.directory(true); assert.equal((await h.service.search(request)).items[0].isDirectory, true)
    h.missing(true); assert.deepEqual((await h.service.search(request)).items, [])
  } finally { await h.ctx.fiber.dispose() }
})

test('actions use only host-owned IDs and recheck existence', async () => {
  const h = harness()
  try {
    h.output([row()]); const item = (await h.service.search(request)).items[0]
    await assert.rejects(h.service.performAction(item.path, 'open'), /result ID/); await assert.rejects(h.service.performAction('unknown', 'copy-path'), /失效/)
    await assert.rejects(h.service.performAction(item.id, 'delete' as never), /action/); assert.deepEqual(h.actions, [])
    for (const action of ['open', 'reveal', 'copy-path'] as const) await h.service.performAction(item.id, action)
    assert.deepEqual(h.actions, [['open', item.path], ['reveal', item.path], ['copy-path', item.path]])
    h.openError('No associated application'); await assert.rejects(h.service.performAction(item.id, 'open'), /No associated application/)
    h.missing(true); await assert.rejects(h.service.performAction(item.id, 'copy-path'), /已不存在/)
    h.missing(false); await assert.rejects(h.service.performAction(item.id, 'open'), /失效/)
  } finally { await h.ctx.fiber.dispose() }
})

test('reveal actions await native selection and propagate asynchronous HRESULT errors', async () => {
  const h = harness()
  try {
    h.output([row('Unicode 中文,逗号.txt')]); const item = (await h.service.search(request)).items[0]
    let rejectLaunch!: (error: Error) => void
    let started!: () => void
    const launched = new Promise<void>(resolve => { started = resolve })
    h.environment.revealPath = path => {
      assert.equal(path, item.path)
      started()
      return new Promise<void>((_resolve, reject) => { rejectLaunch = reject })
    }
    let completed = false
    const action = h.service.performAction(item.id, 'reveal').then(() => { completed = true })
    await launched
    assert.equal(completed, false)
    const rejected = assert.rejects(action, /SHOpenFolderAndSelectItems failed \(0x80004005\)/)
    rejectLaunch(new Error('SHOpenFolderAndSelectItems failed (0x80004005)'))
    await rejected
    assert.equal(completed, false)
  } finally { await h.ctx.fiber.dispose() }
})

test('reveal actions do not complete before native selection succeeds', async () => {
  const h = harness()
  try {
    h.output([row()]); const item = (await h.service.search(request)).items[0]
    let finish!: () => void
    let started!: () => void
    const selecting = new Promise<void>(resolve => { started = resolve })
    h.environment.revealPath = () => {
      started()
      return new Promise<void>(resolve => { finish = resolve })
    }
    let completed = false
    const action = h.service.performAction(item.id, 'reveal').then(() => { completed = true })
    await selecting
    assert.equal(completed, false)
    finish()
    await action
    assert.equal(completed, true)
  } finally { await h.ctx.fiber.dispose() }
})

test('Cordis disposal kills active ES children and cancels queries', async () => {
  const h = harness(); h.output([row()]); const item = (await h.service.search(request)).items[0]; h.hold(true)
  const searches = Array.from({ length: 4 }, () => h.service.search(request)); const rejected = searches.map(search => assert.rejects(search, /查询已取消/))
  await assert.rejects(h.service.search(request), /繁忙/); await h.ctx.fiber.dispose(); await Promise.all(rejected); assert.equal(h.killed(), 4)
  for (const done of h.completions) done(null, JSON.stringify([row()]))
  await assert.rejects(h.service.performAction(item.id, 'open'), /已关闭/)
})

test('old result IDs expire when the bounded authorization cache is full', async () => {
  const h = harness()
  try {
    h.output([row()]); const oldest = (await h.service.search(request)).items[0].id
    h.output(Array.from({ length: 100 }, (_, index) => row(`${index}.txt`)))
    for (let page = 0; page < 10; page++) await h.service.search({ ...request, limit: 100 })
    await assert.rejects(h.service.performAction(oldest, 'open'), /失效/)
  } finally { await h.ctx.fiber.dispose() }
})

test('runtime keeps the protected provider active when Everything navigation is disabled', async () => {
  const path = await mkdtemp(join(tmpdir(), 'nextleek-everything-'))
  const runtime = await createRuntime(join(path, 'lmdb'), { emit() {}, async applySettings() {}, hide() {}, quit() {}, async openDataDirectory() {} })
  try {
    assert.equal((await runtime.getEverythingStatus()).status, 'unsupported')
    assert.deepEqual(await runtime.runCommand('everything.open'), { navigate: 'everything' })
    const command = runtime.listCommands().find(command => command.id === 'everything.open')!
    assert.equal(command.title, 'Everything 文件搜索')
    assert.deepEqual(command.keywords, ['Everything', 'find', '本地搜索', '文件搜索'])
    await runtime.setPluginEnabled('everything', false)
    assert(!runtime.listCommands().some(command => command.id === 'everything.open'))
    assert.equal((await runtime.getEverythingStatus()).status, 'unsupported')
    await assert.rejects(runtime.setPluginEnabled('everything-provider', false), /Core plugins/)
    await runtime.setPluginEnabled('everything', true)
    assert.deepEqual(await runtime.runCommand('everything.open'), { navigate: 'everything' })
  } finally { await runtime.dispose(); await rm(path, { recursive: true, force: true }) }
})
