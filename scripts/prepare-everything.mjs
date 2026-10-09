import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const esAsset = Object.freeze({
  url: 'https://www.voidtools.com/ES-1.1.0.38.x64.zip',
  // Computed from the original official archive; not a mutable remote checksum.
  sha256: '5e0c70cbf4f694080c34aa7c6c745e606c16fe76a4b5423b93ebf9dc34274c99',
  executableSha256: 'f7378761cf6e01f51c4123a485e628d70e3fea147d341f473ce2820844e5cee5',
})

// Original LICENSE in the official ES-1.1.0.38.src.zip (the binary ZIP has no notice).
const license = `MIT License

Copyright (c) 2025 voidtools

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function downloadVerified(asset, destination) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Official download failed: ${response.status} ${asset.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== asset.sha256) throw new Error(`SHA256 mismatch for ${asset.url}: ${actual}`)
  await writeFile(destination, bytes)
  console.log(`Verified ${asset.url} SHA256 ${actual}`)
}

export async function extractZip(archive, destination) {
  await mkdir(destination, { recursive: true })
  const exec = promisify(execFile)
  if (process.platform === 'win32') {
    // Paths are passed via environment, never interpolated into PowerShell source.
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:NEXTLEEK_ARCHIVE -DestinationPath $env:NEXTLEEK_EXTRACT -Force"], {
      env: { ...process.env, NEXTLEEK_ARCHIVE: archive, NEXTLEEK_EXTRACT: destination }, timeout: 30000,
    })
  } else {
    await exec('unzip', ['-q', archive, '-d', destination], { timeout: 30000 })
  }
}

async function prepare() {
  const temporary = await mkdtemp(join(tmpdir(), 'nextleek-es-'))
  const destination = resolve('resources/everything')
  try {
    const archive = join(temporary, 'es.zip')
    const extracted = join(temporary, 'extracted')
    await downloadVerified(esAsset, archive)
    await extractZip(archive, extracted)
    const executable = join(extracted, 'es.exe')
    if (sha256(await readFile(executable)) !== esAsset.executableSha256) throw new Error('Unexpected extracted ES executable')
    await mkdir(destination, { recursive: true })
    await copyFile(executable, join(destination, 'es.exe'))
    await writeFile(join(destination, 'LICENSE'), license)
    console.log(`Prepared pinned Everything CLI in ${destination}`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare()
