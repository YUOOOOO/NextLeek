import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { boolean, identifier, settingsPatch, launcherSearchRequest, searchItemId, everythingAction, everythingResultId } from '../src/shared/validation'

test('settings boundary accepts supported values and rejects unsafe/unknown patches', () => {
  assert.deepEqual(settingsPatch({ hotkey: 'CommandOrControl+Shift+K', theme: 'dark', accent: 'teal', compact: true }), { hotkey: 'CommandOrControl+Shift+K', theme: 'dark', accent: 'teal', compact: true })
  for (const patch of [null, [], { theme: 'neon' }, { accent: '#fff' }, { autostart: 1 }, { compact: 'true' }, { hotkey: 'Z' }, { hotkey: 'Alt+NotAKey' }, { nodeIntegration: true }, JSON.parse('{"__proto__":{}}')]) assert.throws(() => settingsPatch(patch))
  assert.throws(() => identifier('../index.js'))
  assert.throws(() => identifier(''))
  assert.throws(() => boolean('false'))
})

test('launcher boundary preserves query syntax while rejecting unsafe options and result paths', () => {
  const request = { query: 'ext:txt "中文, 文件" | folder:', offset: 0, limit: 30 }
  assert.deepEqual(launcherSearchRequest(request), request)
  assert.equal(launcherSearchRequest({ ...request, query: '-exit' }).query, '-exit')
  for (const bad of [null, [], {}, { ...request, query: '\u0000' }, { ...request, query: 'x'.repeat(2049) }, { ...request, offset: -1 }, { ...request, offset: 0.5 }, { ...request, limit: 0 }, { ...request, limit: 101 }, { ...request, executable: 'cmd.exe' }]) assert.throws(() => launcherSearchRequest(bad))
  assert.equal(searchItemId('capability-result_123'), 'capability-result_123')
  assert.throws(() => searchItemId('C:\\Windows\\cmd.exe'))
  assert.equal(everythingAction('copy-path'), 'copy-path')
  assert.throws(() => everythingAction('delete'))
  assert.equal(everythingResultId('12345678-1234-1234-1234-123456789abc'), '12345678-1234-1234-1234-123456789abc')
  assert.throws(() => everythingResultId('C:\\Windows\\cmd.exe'))
})
