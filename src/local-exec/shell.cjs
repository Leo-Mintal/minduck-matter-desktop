const { spawn } = require('node:child_process')
const { stripVTControlCharacters } = require('node:util')
const { sandboxOptions, SANDBOX_EXEC } = require('./sandbox.cjs')

const OUTPUT_LIMIT = 1024 * 1024
function killGroup(pid, signal) {
  if (!pid) return
  try { process.kill(-pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
}

function runProcess(program, args, { cwd, env, signal, timeoutMs = 120000, input, outputLimit = OUTPUT_LIMIT }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('操作已取消'))
    const started = Date.now()
    const child = spawn(program, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const output = { stdout: [], stderr: [] }
    const sizes = { stdout: 0, stderr: 0 }
    let timedOut = false
    let cancelled = false
    let forceTimer
    let settled = false
    function stop() {
      killGroup(child.pid, 'SIGTERM')
      forceTimer ||= setTimeout(() => killGroup(child.pid, 'SIGKILL'), 2000)
    }
    const abort = () => { cancelled = true; stop() }
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      const available = Math.max(0, outputLimit - sizes[stream])
      if (available) output[stream].push(chunk.subarray(0, available))
      sizes[stream] += chunk.length
    })
    function cleanup() {
      clearTimeout(timer); clearTimeout(forceTimer)
      signal?.removeEventListener('abort', abort)
      // Background descendants are not supported, including on normal exit.
      killGroup(child.pid, 'SIGKILL')
    }
    child.on('error', error => { if (!settled) { settled = true; cleanup(); reject(error) } })
    child.on('exit', () => killGroup(child.pid, 'SIGKILL'))
    child.on('close', (code, exitSignal) => {
      if (settled) return
      settled = true; cleanup()
      resolve({ exit_code: code, signal: exitSignal, cwd, duration_ms: Date.now() - started,
        stdout: stripVTControlCharacters(Buffer.concat(output.stdout).toString('utf8')),
        stderr: stripVTControlCharacters(Buffer.concat(output.stderr).toString('utf8')),
        stdout_truncated: sizes.stdout > outputLimit, stderr_truncated: sizes.stderr > outputLimit,
        timed_out: timedOut, cancelled,
      })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

async function runSandboxed(options, program, args, extra = {}) {
  const sandbox = await sandboxOptions(options)
  try {
    const result = await runProcess(SANDBOX_EXEC, ['-p', sandbox.profile, program, ...args], {
      ...extra, cwd: sandbox.cwd, env: { ...sandbox.env, ...extra.env },
    })
    result.sandbox_denied = result.exit_code !== 0 && /operation not permitted|sandbox|permission denied/i.test(result.stderr)
    if (result.sandbox_denied) {
      result.allowed_directories = options.roots
      result.permission_hint = '请检查系统设置中的完全磁盘访问、文件自身权限，以及是否涉及受保护的凭据或应用数据目录。完全磁盘访问不会绕过这些保护。不要重复原命令或换写法绕过。'
    }
    return result
  } finally { await sandbox.cleanup() }
}

async function resolveUserPath(shell = process.env.SHELL) {
  const safeShell = ['/bin/bash', '/bin/zsh'].includes(shell) ? shell : '/bin/zsh'
  const result = await runProcess(safeShell, ['-ilc', 'printf "\\0MATTER_PATH\\0%s\\0" "$PATH"'], {
    env: process.env, cwd: require('node:os').homedir(), timeoutMs: 5000, outputLimit: 65536,
  })
  return result.stdout.split('\0MATTER_PATH\0').pop()?.split('\0')[0] || process.env.PATH
}

module.exports = { OUTPUT_LIMIT, runProcess, runSandboxed, resolveUserPath }
