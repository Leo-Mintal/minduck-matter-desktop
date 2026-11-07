const fs = require('node:fs')
const path = require('node:path')
const { assertRuntime } = require('../src/companion/runtime.cjs')

// electron-builder omits a root node_modules in an extraResources file matcher.
// It therefore has a separate mapping, verified before a DMG can be produced.
module.exports = async ({ appOutDir, packager }) => {
  const resources = packager.getResourcesDir(appOutDir)
  for (const file of ['AppIcon.icns', 'Assets.car']) {
    if (!fs.existsSync(path.join(resources, file))) throw new Error(`Packaged application icon resource is missing: ${file}`)
  }
  assertRuntime(path.join(resources, 'companion-runtime'))
  for (const file of ['node_modules/koffi/package.json', 'node_modules/ws/package.json',
    'node_modules/sherpa-onnx-node/package.json', 'build/cortico/src/extensions/runtime.ts',
    'node_modules/cortico-world-desktop-pet/web/minduck-thinking/idle.js',
    'node_modules/cortico-world-desktop-pet/web/minduck-thinking/view.js',
    'node_modules/cortico-world-desktop-pet/web/minduck-panels.js',
    'node_modules/cortico-world-desktop-pet/web/minduck-panels.css',
    'node_modules/cortico-world-desktop-pet/web/minduck-qa/view.js',
    'node_modules/cortico-world-desktop-pet/web/minduck-qa/styles.js',
    'node_modules/cortico-world-desktop-pet/web/minduck-qa/SOURCE.json',
    'node_modules/cortico-world-desktop-pet/web/minduck-qa/LICENSES.txt',
    'node_modules/cortico-world-desktop-pet/web/kit/body.js',
    'node_modules/cortico-world-desktop-pet/web/minduck-thinking/artwork.js']) {
    if (!fs.existsSync(path.join(resources, 'companion-runtime', file))) {
      throw new Error(`Packaged companion dependency is missing: ${file}`)
    }
  }
  for (const id of ['minduck-duck', 'minduck-suit-duck']) {
    const figure = path.join(resources, 'companion-figures', id, 'figure.json')
    const manifest = JSON.parse(fs.readFileSync(figure, 'utf8'))
    if (manifest.api !== 2 || manifest.id !== id) throw new Error(`Invalid packaged API 2 figure: ${id}`)
    for (const file of [manifest.entry, manifest.thumb, 'flow-player.js', 'flow-state.js', 'LICENSE-Coopanion.txt',
      ...(id === 'minduck-duck' ? ['flow-artwork.js'] : [])]) {
      if (!fs.existsSync(path.join(path.dirname(figure), file))) throw new Error(`Missing packaged figure asset: ${id}/${file}`)
    }
  }
  if (!fs.existsSync(path.join(resources, 'companion-notices/LICENSE'))) throw new Error('Missing upstream license')
  console.log('Verified packaged Companion runtime, dependencies, API 2 figure and license')
}
