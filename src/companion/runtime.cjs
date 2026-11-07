const path = require('node:path')
const { existsSync } = require('node:fs')

const HOST_FLAG = '--minduck-companion-host'

function runtimeRoot(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'companion-runtime')
    : path.resolve(__dirname, '../../vendor/coopanion/runtime')
}

function assertRuntime(root) {
  for (const file of ['core/boot.ts', 'app/core-host.cjs', 'build/console/index.html',
    'node_modules/tsx/dist/loader.mjs', 'node_modules/cortico-world-desktop-pet/host/electron-main.cjs']) {
    if (!existsSync(path.join(root, file))) throw new Error(`桌宠运行时不完整：${file}`)
  }
}

function hostCommand(app, root, dataDir) {
  return [process.execPath, ...app.isPackaged ? [] : [app.getAppPath()], HOST_FLAG,
    `--companion-runtime=${root}`, `--companion-data=${dataDir}`]
}

function loopbackOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port ? url.origin : null
  } catch { return null }
}

module.exports = { HOST_FLAG, runtimeRoot, assertRuntime, hostCommand, loopbackOrigin }
