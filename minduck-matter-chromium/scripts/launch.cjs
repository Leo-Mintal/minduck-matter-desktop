const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const {
  assertLaunchPrerequisites,
  extensionPaths,
  matterOrigin,
  resolveChromiumBinary,
} = require('./config.cjs')

function profileDirectory() {
  return path.resolve(
    process.env.MINDUCK_CHROMIUM_PROFILE ||
      path.join(os.homedir(), 'Library', 'Application Support', 'Minduck Matter Chromium'),
  )
}

function launchArguments(profile, origin) {
  return [
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--load-extension=${extensionPaths().join(',')}`,
    '--new-window',
    origin,
  ]
}

function launch() {
  const binary = resolveChromiumBinary()
  const profile = profileDirectory()
  const origin = matterOrigin()
  assertLaunchPrerequisites(binary)

  const child = spawn(binary, launchArguments(profile, origin), {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', (error) => console.error('Failed to launch Minduck Matter Chromium:', error.message))
  child.unref()

  console.log(`Started Chromium with profile: ${profile}`)
  console.log(`Matter startup page: ${origin}`)
}

if (require.main === module) {
  try {
    launch()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = {
  launchArguments,
  profileDirectory,
}
