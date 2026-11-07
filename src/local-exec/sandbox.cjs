const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { canonical, sensitivePaths } = require('./workspace.cjs')

const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
function quoted(value) { return JSON.stringify(value) }
function subpath(value) { return `(subpath ${quoted(value)})` }

// Read user files only inside authorized projects. Toolchains stay readable;
// caches are private to this workspace rather than shared executable caches.
function profileFor({ roots, temporary, denied = sensitivePaths(), home = os.homedir(), network = false }) {
  const appEnd = process.execPath.indexOf('.app/')
  const runtime = appEnd >= 0 ? process.execPath.slice(0, appEnd + 4) : path.dirname(process.execPath)
  const readable = [...roots, temporary, '/System', '/usr', '/bin', '/sbin', '/dev', '/opt/homebrew',
    '/Library/Apple', '/Library/Developer', '/private/etc', '/private/var/db/timezone', runtime, __dirname,
    path.join(home, '.nvm/versions'), path.join(home, '.volta/tools'), path.join(home, '.local/bin')]
  const exclusions = [...denied, '/private/etc/master.passwd', '/private/etc/security', '/private/etc/ssh']
  const readFilter = `(require-all (require-any ${readable.map(subpath).join(' ')}) ${exclusions.map(value => `(require-not ${subpath(value)})`).join(' ')})`
  return `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/"))
(allow file-read* ${readFilter})
(allow file-write* (require-any ${[...roots, temporary].map(subpath).join(' ')}))
(allow file-write-data (literal "/dev/null") (literal "/dev/tty"))
(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.bsd.dirhelper") (global-name "com.apple.system.opendirectoryd.libinfo"))
${network ? '(allow network-outbound)\n(allow mach-lookup (global-name "com.apple.mDNSResponder"))' : ''}
`
}

async function sandboxOptions({ roots, denied, cwd, network, userPath, home = os.homedir() }) {
  await fs.access(SANDBOX_EXEC, fs.constants.X_OK)
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'matter-exec-'))
  const tempRoot = await canonical(temporary)
  const canonicalRoots = await Promise.all(roots.map(canonical))
  const cache = path.join(canonicalRoots[0], '.matter-cache')
  await fs.mkdir(cache, { recursive: true, mode: 0o700 })
  const env = {
    PATH: userPath || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: home, USER: os.userInfo().username, LOGNAME: os.userInfo().username,
    SHELL: ['/bin/bash', '/bin/zsh'].includes(process.env.SHELL) ? process.env.SHELL : '/bin/zsh',
    TMPDIR: tempRoot, LANG: 'en_US.UTF-8', TERM: 'dumb', NO_COLOR: '1',
    ZDOTDIR: tempRoot, NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_CACHE: path.join(cache, 'npm'),
    GIT_CONFIG_GLOBAL: '/dev/null', GOCACHE: path.join(cache, 'go-build'), GOPATH: path.join(cache, 'go'),
    CARGO_HOME: path.join(cache, 'cargo'), XDG_CACHE_HOME: path.join(cache, 'xdg'),
  }
  return {
    profile: profileFor({ roots: canonicalRoots, temporary: tempRoot, denied, home, network }), env, cwd,
    cleanup: () => fs.rm(temporary, { recursive: true, force: true }),
  }
}

module.exports = { SANDBOX_EXEC, profileFor, sandboxOptions }
