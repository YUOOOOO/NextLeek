import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { boolean, identifier, settingsPatch } from '../src/shared/validation'

test('settings boundary accepts supported values and rejects unsafe/unknown patches', () => {
  assert.deepEqual(settingsPatch({ hotkey: 'CommandOrControl+Shift+K', theme: 'dark', accent: 'teal', compact: true }), { hotkey: 'CommandOrControl+Shift+K', theme: 'dark', accent: 'teal', compact: true })
  for (const patch of [null, [], { theme: 'neon' }, { accent: '#fff' }, { autostart: 1 }, { compact: 'true' }, { hotkey: 'Z' }, { hotkey: 'Alt+NotAKey' }, { nodeIntegration: true }, JSON.parse('{"__proto__":{}}')]) assert.throws(() => settingsPatch(patch))
  assert.throws(() => identifier('../index.js'))
  assert.throws(() => identifier(''))
  assert.throws(() => boolean('false'))
})
