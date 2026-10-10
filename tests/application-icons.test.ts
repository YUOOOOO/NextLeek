import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { getApplicationIcon, type ApplicationIconEnvironment, type ApplicationIconImage } from '../src/host/services/application-icons'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBaoAAAAASUVORK5CYII='
const shortcutPath = 'C:\\Start Menu\\Programs\\Editor.lnk'
const target = 'C:\\Apps\\Editor\\Editor.exe'
function image(empty = false, url = png): ApplicationIconImage {
  return { isEmpty: () => empty, toDataURL: () => url }
}
function harness(shortcut: ReturnType<ApplicationIconEnvironment['readShortcutLink']> = { target }) {
  const reads: string[] = [], files: string[] = [], images: string[] = []
  const environment: ApplicationIconEnvironment = {
    platform: 'win32', variables: {},
    readShortcutLink(path) { reads.push(path); return shortcut },
    async getFileIcon(path) { files.push(path); return image() },
    nativeImage: { createFromPath(path) { images.push(path); return image() } },
  }
  return { environment, reads, files, images, shortcut }
}

test('Windows shortcuts request the real executable icon without requesting a generic shortcut icon', async () => {
  const h = harness()
  assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
  assert.deepEqual(h.reads, [shortcutPath])
  assert.deepEqual(h.files, [target])
  assert.deepEqual(h.images, [])
  assert.deepEqual(h.shortcut, { target }, 'icon resolution does not change launch metadata')
  assert.equal(await getApplicationIcon('C:\\Programs\\Editor.LNK', h.environment), png)
  assert.deepEqual(h.files, [target, target])
})

test('explicit supported image files use native image decoding instead of associated file-type icons', async () => {
  for (const extension of ['ICO', 'png', 'jpg', 'jpeg']) {
    const icon = `C:\\Apps\\Editor\\logo.${extension}`
    const h = harness({ target, icon, iconIndex: 2 })
    assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
    assert.deepEqual(h.images, [icon])
    assert.deepEqual(h.files, [])
  }
})

test('an explicit executable default icon is extracted natively, while indexed EXE and DLL icons use the target', async () => {
  for (const iconIndex of [undefined, 0]) {
    const icon = 'C:\\Apps\\Editor\\Brand.exe'
    const h = harness({ target, icon, iconIndex })
    assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
    assert.deepEqual(h.files, [icon])
    assert.deepEqual(h.images, [])
  }
  for (const icon of ['C:\\Windows\\System32\\shell32.dll', 'C:\\Apps\\Editor\\Brand.exe']) {
    for (const iconIndex of [-42, 3]) {
      const h = harness({ target, icon, iconIndex })
      assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
      assert.deepEqual(h.files, [target])
      assert.deepEqual(h.images, [], 'nativeImage cannot decode DLL/EXE icon resources')
    }
  }
  const h = harness({ target, icon: 'C:\\Windows\\System32\\shell32.dll', iconIndex: 0 })
  assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
  assert.deepEqual(h.files, [target])
})

test('Windows environment variables are case insensitive and quoted absolute target paths retain spaces', async () => {
  const h = harness({ target: '"%programfiles%\\Editor App\\Editor.exe"', icon: '%LOCALAPPDATA%\\Editor\\logo.ico' })
  h.environment.variables = { ProgramFiles: 'C:\\Program Files', LocalAppData: 'C:\\Users\\Person\\AppData\\Local' }
  assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
  assert.deepEqual(h.images, ['C:\\Users\\Person\\AppData\\Local\\Editor\\logo.ico'])
  h.shortcut.icon = ''
  assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
  assert.deepEqual(h.files, ['C:\\Program Files\\Editor App\\Editor.exe'])
})

test('relative shortcut targets and custom images resolve against the shortcut directory', async () => {
  const h = harness({ target: '..\\Editor\\Editor.exe', icon: '.\\logos\\Editor.png' })
  assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
  assert.deepEqual(h.images, ['C:\\Start Menu\\Programs\\logos\\Editor.png'])
  h.shortcut.icon = ''
  assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
  assert.deepEqual(h.files, ['C:\\Start Menu\\Editor\\Editor.exe'])
})

test('drive-root-relative and UNC targets resolve without depending on the host working directory', async () => {
  const rooted = harness({ target: '\\Apps\\Editor.exe' })
  assert.equal(await getApplicationIcon(shortcutPath, rooted.environment), png)
  assert.deepEqual(rooted.files, ['C:\\Apps\\Editor.exe'])
  const unc = harness({ target: '\\\\server\\applications\\Editor.exe' })
  assert.equal(await getApplicationIcon(shortcutPath, unc.environment), png)
  assert.deepEqual(unc.files, ['\\\\server\\applications\\Editor.exe'])
})

test('missing, unreadable and empty explicit images fall back to the executable rather than fabricate an icon', async () => {
  for (const failure of ['throw', 'empty', 'no-data']) {
    const h = harness({ target, icon: 'C:\\Apps\\missing.ico' })
    h.environment.nativeImage.createFromPath = path => {
      h.images.push(path)
      if (failure === 'throw') throw new Error('decode failed')
      return image(failure === 'empty', failure === 'no-data' ? '' : png)
    }
    assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
    assert.deepEqual(h.files, [target])
  }
  const h = harness({ target, icon: 'C:\\Apps\\missing.exe' })
  h.environment.getFileIcon = async path => {
    h.files.push(path)
    if (path !== target) throw new Error('native extraction failed')
    return image()
  }
  assert.equal(await getApplicationIcon(shortcutPath, h.environment), png)
  assert.deepEqual(h.files, ['C:\\Apps\\missing.exe', target])
})

test('unresolved custom icon variables fall back, while invalid targets never request shortcut icons', async () => {
  const custom = harness({ target, icon: '%MISSING%\\icon.ico' })
  assert.equal(await getApplicationIcon(shortcutPath, custom.environment), png)
  assert.deepEqual(custom.images, [])
  assert.deepEqual(custom.files, [target])
  for (const invalid of ['', '%MISSING%\\Editor.exe', 'https://example.com', 'app:editor', 'C:Editor.exe', 'C:\\Programs\\Other.lnk']) {
    const h = harness({ target: invalid })
    await assert.rejects(getApplicationIcon(shortcutPath, h.environment), /usable icon target/)
    assert.deepEqual(h.files, [])
    assert.deepEqual(h.images, [])
  }
})

test('shortcut read and target extraction failures remain errors with no synthetic data URL', async () => {
  const readFailure = harness()
  readFailure.environment.readShortcutLink = () => { throw new Error('shortcut is corrupt') }
  await assert.rejects(getApplicationIcon(shortcutPath, readFailure.environment), /shortcut is corrupt/)
  assert.deepEqual(readFailure.files, [])
  const nativeFailure = harness()
  nativeFailure.environment.getFileIcon = async () => { throw new Error('native extraction failed') }
  await assert.rejects(getApplicationIcon(shortcutPath, nativeFailure.environment), /native extraction failed/)
  for (const result of [image(true), image(false, '')]) {
    nativeFailure.environment.getFileIcon = async () => result
    await assert.rejects(getApplicationIcon(shortcutPath, nativeFailure.environment), /Application icon/)
  }
})

test('macOS bundles and non-shortcut paths retain native file icon retrieval without Windows shortcut parsing', async () => {
  for (const [platform, path] of [['darwin', '/Applications/Editor.app'], ['win32', target]] as const) {
    const h = harness()
    h.environment.platform = platform
    assert.equal(await getApplicationIcon(path, h.environment), png)
    assert.deepEqual(h.files, [path])
    assert.deepEqual(h.reads, [])
    assert.deepEqual(h.images, [])
  }
})

test('injected environments resolve independently without sharing mutable icon or variable state', async () => {
  const first = harness({ target: '%APPROOT%\\Editor.exe' })
  const second = harness({ target: '%APPROOT%\\Editor.exe' })
  first.environment.variables = { APPROOT: 'C:\\First' }
  second.environment.variables = { APPROOT: 'D:\\Second' }
  await Promise.all([getApplicationIcon(shortcutPath, first.environment), getApplicationIcon(shortcutPath, second.environment)])
  assert.deepEqual(first.files, ['C:\\First\\Editor.exe'])
  assert.deepEqual(second.files, ['D:\\Second\\Editor.exe'])
})
