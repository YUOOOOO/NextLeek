import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const icons = new URL('../resources/icons/', import.meta.url)
const mark = await readFile(new URL('mark.svg', icons), 'utf8')
const component = await readFile(new URL('../src/client/components/AppIcon.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/client/styles.css', import.meta.url), 'utf8')
const glyph = [...mark.matchAll(/<path\s+d="([^"]+)"/g)].map(match => match[1])
const brand = component.slice(component.indexOf("name === 'brand'"), component.indexOf('</template>', component.indexOf("name === 'brand'")))
assert.deepEqual(glyph, [...brand.matchAll(/<path\s+d="([^"]+)"/g)].map(match => match[1]), 'Desktop and search button must use the same brand glyph')
const token = name => {
  const value = styles.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
  assert.ok(value, `Missing brand CSS token: ${name}`)
  return value
}
const buttonSize = parseFloat(token('space-12'))
const glyphSize = parseFloat(token('space-8'))
const canvasSize = 24 * buttonSize / glyphSize
const inset = (canvasSize - 24) / 2
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}">\n  <!-- Brand glyph provenance and MIT terms: ZTools-LICENSE. Palette and scale match the light search button. -->\n  <circle cx="${canvasSize / 2}" cy="${canvasSize / 2}" r="${canvasSize / 2}" fill="${token('brand')}"/>\n  <g transform="translate(${inset} ${inset})" fill="${token('brand-ink')}">\n${glyph.map(path => `    <path d="${path}"/>`).join('\n')}\n  </g>\n</svg>\n`
await writeFile(new URL('icon.svg', icons), svg)
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
