// Runs in an isolated Electron child using this app's own executable, never Coopanion.app.
const { app } = require('electron')
const path = require('node:path')
const { mkdirSync } = require('node:fs')
const { assertRuntime, loopbackOrigin } = require('./runtime.cjs')
const { sendMatterAction, watchMatterOutput } = require('./matter-actions.cjs')

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const root = argument('companion-runtime')
const dataDir = argument('companion-data')
const url = argument('pet-url')
if (!root || !dataDir || !path.isAbsolute(root) || !path.isAbsolute(dataDir) || !loopbackOrigin(url)) {
  throw new Error('Invalid companion host arguments')
}
assertRuntime(root)
mkdirSync(path.join(dataDir, 'pet-window'), { recursive: true })
app.setPath('userData', path.join(dataDir, 'pet-window'))
const { runPetHost } = require(path.join(root, 'node_modules/cortico-world-desktop-pet/host/electron-main.cjs'))
runPetHost({ url, parentPid: Number(argument('parent-pid')) || 0, tray: false,
  onMatterAction: (action, target) => sendMatterAction(action, process.env, target), subscribeMatterOutput: watchMatterOutput })
