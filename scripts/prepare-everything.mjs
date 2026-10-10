import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const revision = '1e5f0f1859e72a7bac8d727a979b3b0de67a79b6'
const upstream = `https://raw.githubusercontent.com/ZToolsCenter/ZTools-plugins/${revision}/plugins/everything/preload`

export const nativeAssets = Object.freeze({
  addon: {
    url: `${upstream}/addon-x64.node`,
    sha256: '5213b22f4bc150c040888d9e04c8b822aeaac932b96754970b2938e1ebc155d8',
    file: 'addon-x64.node',
  },
  engine: {
    url: `${upstream}/everything/Everything.exe`,
    sha256: '8af53ee05abd7ed90db4c7f06be686e8086fe5ea536d72bebaee2bcdf9cc4dce',
    file: 'Everything.exe',
  },
  config: {
    url: `${upstream}/everything/Everything.ini`,
    sha256: '41bdb1f0e58267e2a10da5c933df450ecb26fa7a3d4e79fbcebd7cf5e8d2283a',
    file: 'Everything.ini',
  },
  ztoolsLicense: {
    url: `https://raw.githubusercontent.com/ZToolsCenter/ZTools-plugins/${revision}/LICENSE`,
    sha256: '0edef6a28c31990181e6b2188e0694a7df57c29242082a711ed028c41d76f2ae',
    file: 'LICENSE-ZTools',
  },
  everythingLicense: {
    url: 'https://www.voidtools.com/License.txt',
    sha256: 'c13d19adcbfd5d07e9512de9df99956a3423399ed1fadc5fd33186697ad8df2f',
    file: 'LICENSE-Everything',
  },
})

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function downloadVerified(asset, destination) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Official download failed: ${response.status} ${asset.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== asset.sha256) throw new Error(`SHA256 mismatch for ${asset.url}: ${actual}`)
  console.log(`Verified ${asset.url} SHA256 ${actual}`)
  await writeFile(destination, bytes)
}


export async function prepare(destination = resolve('resources/everything')) {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  await downloadVerified(nativeAssets.addon, resolve(destination, nativeAssets.addon.file))
  await downloadVerified(nativeAssets.engine, resolve(destination, nativeAssets.engine.file))
  await downloadVerified(nativeAssets.config, resolve(destination, nativeAssets.config.file))
  // Preserve the repository MIT and the engine's complete MIT/PCRE notices.
  // The repository contains no addon-specific source or author notice.
  await downloadVerified(nativeAssets.ztoolsLicense, resolve(destination, nativeAssets.ztoolsLicense.file))
  await downloadVerified(nativeAssets.everythingLicense, resolve(destination, nativeAssets.everythingLicense.file))
  const addonHash = sha256(await readFile(resolve(destination, nativeAssets.addon.file)))
  const engineHash = sha256(await readFile(resolve(destination, nativeAssets.engine.file)))
  if (addonHash !== nativeAssets.addon.sha256 || engineHash !== nativeAssets.engine.sha256) throw new Error('Prepared native Everything resources failed final verification')
  console.log(`Prepared pinned native Everything addon and engine in ${destination}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare()
