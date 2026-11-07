const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { assertRuntime } = require('../src/companion/runtime.cjs')

const root = path.resolve(__dirname, '../vendor/coopanion')
assertRuntime(path.join(root, 'runtime'))
const upstream = JSON.parse(fs.readFileSync(path.join(root, 'UPSTREAM.json'), 'utf8'))
if (upstream.version !== '0.2.16') throw new Error('Unexpected Coopanion version')
// A file may have several documented patches; verify its final hash.
const finalChanges = new Map(upstream.changes.map((change) => [change.file, change]))
for (const change of finalChanges.values()) {
  const digest = createHash('sha256').update(fs.readFileSync(path.join(root, 'runtime', change.file))).digest('hex')
  if (digest !== change.integratedSha256) throw new Error(`Undocumented runtime change: ${change.file}`)
}
for (const id of ['minduck-duck', 'minduck-suit-duck']) {
  const figureRoot = path.resolve(__dirname, '../src/companion/figures', id)
  const manifest = JSON.parse(fs.readFileSync(path.join(figureRoot, 'figure.json'), 'utf8'))
  if (manifest.api !== 2 || manifest.id !== id) throw new Error(`Invalid figure manifest: ${id}`)
  for (const file of [manifest.entry, manifest.thumb, 'artwork.js', 'flow-player.js', 'flow-state.js', 'LICENSE-Coopanion.txt',
    ...(id === 'minduck-duck' ? ['flow-artwork.js'] : [])]) {
    if (!fs.existsSync(path.join(figureRoot, file))) throw new Error(`Missing figure asset: ${id}/${file}`)
  }
}
console.log(`Coopanion ${upstream.version}: runtime, patch hashes and default/Suit Duck API 2 assets verified`)
