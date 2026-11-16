const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function build({ root = path.join(__dirname, '..'), output = path.join(root, 'build', 'desktop-access'),
  include = process.env.MINDUCK_NODE_HEADERS || '/opt/homebrew/include/node' } = {}) {
  if (process.platform !== 'darwin') throw new Error('The activation key module requires macOS')
  if (!fs.existsSync(path.join(include, 'node_api.h'))) throw new Error('Set MINDUCK_NODE_HEADERS to the Node N-API include directory')
  fs.mkdirSync(output, { recursive: true })
  const target = path.join(output, 'desktop-access.node')
  execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-bundle', '-undefined', 'dynamic_lookup',
    '-arch', 'arm64', '-mmacosx-version-min=12.0', '-framework', 'Foundation', '-framework', 'Security', '-I', include,
    path.join(root, 'native', 'desktop-access.mm'), '-o', target], { stdio: 'inherit' })
  return target
}
if (require.main === module) console.log(build())
module.exports = { build }
