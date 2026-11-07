const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')

function pnpmCommand() {
  // npm_execpath is provided by pnpm scripts, including Corepack-managed runs.
  if (process.env.npm_execpath) return [process.execPath, [process.env.npm_execpath]]
  return [process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', []]
}

function stageSharedDesktopStyles(dist) {
  const desktopShell = path.join(dist, 'desktop-shell')
  const index = fs.readFileSync(path.join(desktopShell, 'index.html'), 'utf8')
  const match = index.match(/<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*>/i)
  if (!match) throw new Error('Shared desktop chrome stylesheet is missing.')

  const stylesheet = path.resolve(desktopShell, match[1])
  const assets = path.join(desktopShell, 'assets')
  if (!stylesheet.startsWith(assets + path.sep) || !fs.existsSync(stylesheet)) {
    throw new Error('Shared desktop chrome stylesheet is invalid.')
  }

  const destination = path.join(assets, 'shared.css')
  if (stylesheet !== destination) fs.copyFileSync(stylesheet, destination)
  return destination
}

function buildWeb() {
  const source = path.resolve(process.env.MINDUCK_WEB_SOURCE || path.join(projectRoot, '..', 'minduck-matter-web-prod'))
  const prebuilt = process.env.MINDUCK_WEB_DIST
  const dist = prebuilt ? path.resolve(prebuilt) : path.join(source, 'dist')
  if (!prebuilt) {
    if (!fs.existsSync(path.join(source, 'package.json'))) {
      throw new Error('Web project not found. Set MINDUCK_WEB_SOURCE to the Matter Web project directory.')
    }
    if (!fs.existsSync(path.join(source, 'node_modules'))) {
      throw new Error('Web dependencies are missing. Run pnpm install --frozen-lockfile in the Web project.')
    }
    const [command, args] = pnpmCommand()
    console.log('Building the shared Matter Web source:', source)
    for (const script of ['build', 'build:desktop-shell']) {
      const result = spawnSync(command, [...args, 'run', script], { cwd: source, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`Matter Web ${script} failed (exit ${result.status}).`)
    }
  }
  if (!fs.existsSync(path.join(dist, 'desktop-shell', 'index.html'))) {
    throw new Error('Shared desktop chrome is missing. Run build and build:desktop-shell in the Web project before staging dist.')
  }
  stageSharedDesktopStyles(dist)
  const index = fs.readFileSync(path.join(dist, 'index.html'))
  const staging = fs.mkdtempSync(path.join(projectRoot, '.web-dist-'))
  try {
    fs.cpSync(dist, staging, { recursive: true, dereference: true })
    const metadata = {
      source: '@minduck/matter-web',
      builtAt: new Date().toISOString(),
      indexSha256: createHash('sha256').update(index).digest('hex'),
    }
    fs.writeFileSync(path.join(staging, 'desktop-build.json'), JSON.stringify(metadata, null, 2) + '\n')
    fs.rmSync(path.join(projectRoot, 'web-dist'), { recursive: true, force: true })
    fs.renameSync(staging, path.join(projectRoot, 'web-dist'))
    console.log('Shared Web frontend staged in web-dist/ (no frontend source copied).')
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    buildWeb()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { buildWeb, stageSharedDesktopStyles }
