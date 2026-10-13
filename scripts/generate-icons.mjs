import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const icons = new URL('../resources/icons/', import.meta.url)
const mark = await readFile(new URL('mark.svg', icons), 'utf8')
// 分发 SVG 是品牌图标的唯一来源，不依赖已退役的重建页面组件。
const svg = await readFile(new URL('icon.svg', icons), 'utf8')
const glyph = source => [...source.matchAll(/<path\s+d="([^"]+)"/g)].map(match => match[1])
assert.deepEqual(glyph(svg), glyph(mark), 'Distributed icon must preserve the canonical brand glyph')
const canvasSize = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)?.[1])
assert.ok(Number.isFinite(canvasSize) && canvasSize > 0, 'Icon SVG requires a square canvas')
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const pngs = new Map(await Promise.all(sizes.map(async size => {
  const png = await sharp(Buffer.from(svg), { density: size * 72 / canvasSize }).resize(size, size).png().toBuffer()
  await writeFile(new URL(`icon-${size}.png`, icons), png)
  return [size, png]
})))
await writeFile(new URL('icon.png', icons), pngs.get(512))

// Windows Vista+ reads PNG-compressed ICO frames directly, preserving alpha.
const windowsSizes = sizes.filter(size => size <= 256)
const directory = Buffer.alloc(6 + windowsSizes.length * 16)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(windowsSizes.length, 4)
let offset = directory.length
for (const [index, size] of windowsSizes.entries()) {
  const png = pngs.get(size)
  const entry = 6 + index * 16
  directory.writeUInt8(size === 256 ? 0 : size, entry)
  directory.writeUInt8(size === 256 ? 0 : size, entry + 1)
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(png.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += png.length
}
await writeFile(new URL('icon.ico', icons), Buffer.concat([directory, ...windowsSizes.map(size => pngs.get(size))]))

// Modern ICNS chunks contain native PNG payloads at standard and Retina sizes.
const macFrames = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]
const chunks = macFrames.map(([type, size]) => {
  const png = pngs.get(size)
  const header = Buffer.alloc(8)
  header.write(type, 0, 'ascii')
  header.writeUInt32BE(png.length + 8, 4)
  return Buffer.concat([header, png])
})
const header = Buffer.alloc(8)
header.write('icns', 0, 'ascii')
header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
await writeFile(new URL('icon.icns', icons), Buffer.concat([header, ...chunks]))
console.log(`Generated NextTools SVG, ${sizes.length + 1} PNGs, ${windowsSizes.length}-frame ICO and ${macFrames.length}-frame ICNS in ${fileURLToPath(icons)}`)
