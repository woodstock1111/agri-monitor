// Rebuild the park map's runtime assets from the delivered painting and its plot outlines.
// The painting is cropped to the farmed valley plus a forest margin for panning, then
// downsampled; outlines are shifted into the crop, inset off the ridge, and given a swatch.
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'miniprogram/assets/park')
const design = path.join(root, 'miniprogram-design/park-map/assets')
const VERSION = 'v9'
// The crop leaves enough forest round the fields for any plot to sit at the centre of a tall phone.
const CROP = { left: 100, top: 180, width: 1980, height: 3240 }
// Output px per source px; keeps plots the same size on screen as earlier builds.
const SCALE = 1400 / 1660
const OUTPUT_WIDTH = Math.round(CROP.width * SCALE)
const INSET = 4
const GLOW_PAD = 26

// One cloud sprite, reused (scaled, flipped, turned) over every empty plot as fog of war.
function fogSvg() {
  const W = 480, H = 390, R = (() => { let seed = 11; return () => (seed = (seed * 16807) % 2147483647) / 2147483647 })()
  const puffs = []
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2 + R() * 0.3, d = 0.6 + R() * 0.25
    puffs.push([W / 2 + Math.cos(a) * W * 0.33 * d, H / 2 + Math.sin(a) * H * 0.32 * d, 50 + R() * 46])
  }
  for (let i = 0; i < 8; i++) puffs.push([W / 2 + (R() - 0.5) * W * 0.4, H / 2 + (R() - 0.5) * H * 0.34, 64 + R() * 44])
  const layer = (dx, dy, k, fill) => puffs.map(([x, y, r]) => `<circle cx="${(x + dx).toFixed(0)}" cy="${(y + dy).toFixed(0)}" r="${(r * k).toFixed(0)}" fill="${fill}"/>`).join('')
  // Cumulus in three passes: a cool shadow underneath, the body, and lit tops; noise wisps break up the mass.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
    <filter id="b1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="20"/></filter>
    <filter id="b2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="13"/></filter>
    <filter id="wisp" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="4"/><feColorMatrix type="matrix" values="0 0 0 0 0.84  0 0 0 0 0.86  0 0 0 0 0.82  0 0 0 1.4 -0.55"/></filter>
    <mask id="m"><rect width="100%" height="100%" fill="#000"/><g filter="url(#b1)">${layer(0, 0, 0.9, '#fff')}</g></mask></defs>
    <g opacity=".92">
      <g filter="url(#b1)" opacity=".55">${layer(6, 16, 1, '#aeb4a3')}</g>
      <g filter="url(#b1)">${layer(0, 0, 1, '#eeeee5')}</g>
      <g filter="url(#b2)" opacity=".8">${layer(-8, -12, 0.62, '#ffffff')}</g>
      <rect width="100%" height="100%" filter="url(#wisp)" mask="url(#m)" opacity=".6"/>
    </g></svg>`
}

// A soft fluorescent halo per plot, pre-rendered so the map needs no canvas at runtime.
async function glow(region, file) {
  const xs = region.points.map(p => p[0]), ys = region.points.map(p => p[1])
  const x = Math.floor(Math.min(...xs) - GLOW_PAD), y = Math.floor(Math.min(...ys) - GLOW_PAD)
  const w = Math.ceil(Math.max(...xs) + GLOW_PAD) - x, h = Math.ceil(Math.max(...ys) + GLOW_PAD) - y
  const pts = region.points.map(([px, py]) => `${(px - x).toFixed(1)},${(py - y).toFixed(1)}`).join(' ')
  const rings = [[40, .1], [30, .14], [21, .2], [13, .32], [7, .55]]
    .map(([width, alpha]) => `<polygon points="${pts}" fill="none" stroke="rgb(226,255,150)" stroke-opacity="${alpha}" stroke-width="${width}" stroke-linejoin="round"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><filter id="s" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.5"/></filter></defs>
    <polygon points="${pts}" fill="rgb(240,255,190)" fill-opacity=".16"/><g filter="url(#s)">${rings}</g>
    <polygon points="${pts}" fill="none" stroke="rgb(252,255,228)" stroke-opacity=".95" stroke-width="2.5" stroke-linejoin="round"/></svg>`
  await sharp(Buffer.from(svg)).png({ palette: true, quality: 90 }).toFile(file)
  return { x, y, w, h }
}

// Move every vertex inward along its corner normal so outlines sit inside the painted ridge.
function inset(points, amount) {
  let area = 0
  points.forEach(([x1, y1], i) => { const [x2, y2] = points[(i + 1) % points.length]; area += x1 * y2 - x2 * y1 })
  const inward = area > 0 ? 1 : -1
  return points.map((p, i) => {
    const a = points[(i - 1 + points.length) % points.length], b = points[(i + 1) % points.length]
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1
    return [p[0] - inward * dy / len * amount, p[1] + inward * dx / len * amount]
  })
}

async function build() {
  await fs.mkdir(out, { recursive: true })
  const source = path.join(design, `park-world-${VERSION}.png`)
  const meta = await sharp(source).metadata()
  const scale = SCALE
  await sharp(source).extract(CROP).resize(OUTPUT_WIDTH).jpeg({ quality: 72, mozjpeg: true }).toFile(path.join(out, 'park-world.jpg'))

  // Swatch = the plot's mean colour, read through the delivered mask (plot n is grey n × 10).
  const pixels = await sharp(source).removeAlpha().raw().toBuffer()
  const mask = await sharp(path.join(design, `park-world-${VERSION}-mask.png`)).greyscale().raw().toBuffer()
  const sums = new Map()
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue
    const s = sums.get(mask[p]) || [0, 0, 0, 0]
    s[0] += pixels[p * 3]; s[1] += pixels[p * 3 + 1]; s[2] += pixels[p * 3 + 2]; s[3]++
    sums.set(mask[p], s)
  }
  const hex = s => '#' + [0, 1, 2].map(k => Math.round(s[k] / s[3]).toString(16).padStart(2, '0')).join('')

  const plots = JSON.parse(await fs.readFile(path.join(design, `park-world-${VERSION}.json`), 'utf8')).sort((a, b) => a.id - b.id)
  const round = v => Math.round(v * 10) / 10
  const local = ([x, y]) => [round((x - CROP.left) * scale), round((y - CROP.top) * scale)]
  const regions = plots.map(plot => ({
    id: plot.id,
    swatch: hex(sums.get(plot.id * 10)),
    center: local(plot.center),
    points: inset(plot.points, INSET).map(local)
  }))
  await fs.rm(path.join(out, 'glow'), { recursive: true, force: true })
  await fs.mkdir(path.join(out, 'glow'), { recursive: true })
  for (const r of regions) r.glow = await glow(r, path.join(out, 'glow', r.id + '.png'))
  await sharp(Buffer.from(fogSvg())).png({ palette: true, dither: 1, quality: 95 }).toFile(path.join(out, 'fog.png'))
  const lines = regions.map(r => `  { id:${r.id}, swatch:'${r.swatch}', center:${JSON.stringify(r.center)}, glow:${JSON.stringify(r.glow)}, points:${JSON.stringify(r.points)} }`)
  await fs.writeFile(path.join(root, 'miniprogram/utils/park-regions.js'),
    `// Generated by scripts/build-park-art.cjs from park-world-${VERSION} (${meta.width} × ${meta.height}). Do not edit.\n` +
    `// Image px of assets/park/park-world.jpg (${OUTPUT_WIDTH} × ${Math.round(CROP.height * scale)}); ids run top to bottom.\n` +
    `module.exports = {\n  IMAGE_WIDTH: ${OUTPUT_WIDTH},\n  IMAGE_HEIGHT: ${Math.round(CROP.height * scale)},\n  REGIONS: [\n${lines.join(',\n')}\n  ]\n}\n`)

  const icons={
    steward:'<path d="M24 40V23M24 27C9 29 6 21 6 9c13 0 20 4 18 18Zm0-6C23 9 31 6 42 6c0 11-5 18-18 18"/>',
    chat:'<path d="M10 7h27a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H21l-10 7v-7a6 6 0 0 1-6-6V13a6 6 0 0 1 5-6Z"/><circle cx="15" cy="22" r="1"/><circle cx="24" cy="22" r="1"/><circle cx="33" cy="22" r="1"/>',
    maturity:'<path d="M6 33a18 18 0 1 1 36 0M10 40h28M24 32l10-14M11 17l3 3M24 11v4M37 17l-3 3"/><circle cx="24" cy="32" r="3"/>',
    harvest:'<rect x="6" y="26" width="8" height="16" rx="2"/><rect x="20" y="8" width="8" height="34" rx="2"/><rect x="34" y="18" width="8" height="24" rx="2"/>'
  }
  for (const [name,body] of Object.entries(icons)) {
    const source=`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><g fill="none" stroke="#354b3d" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`
    await sharp(Buffer.from(source)).resize(96,96).png().toFile(path.join(out,name+'.png'))
  }
  const files=(await fs.readdir(out,{recursive:true})).filter(name=>/\.(png|jpg)$/.test(name))
  let bytes=0
  for(const name of files) bytes+=(await fs.stat(path.join(out,name))).size
  console.log(`${regions.length} plots from park-world-${VERSION}; ${files.length} park assets, ${(bytes/1024).toFixed(0)} KB total`)
}
build().catch(error=>{ console.error(error);process.exitCode=1 })
