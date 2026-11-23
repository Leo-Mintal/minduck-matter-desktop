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
    result.command_executed = true
    result.may_have_partial_effects = result.exit_code !== 0 || result.cancelled || result.timed_out
    if (result.sandbox_denied) {
      result.allowed_directories = options.roots
      result.permission_hint = '本次访问可能被系统权限或命令沙箱拒绝，不表示系统不支持。若刚才选择了“不允许”，请停止此项任务；否则核对目标路径及文件自身权限。此诊断不能确认用户点击了哪个按钮，也不能证明缺少完全磁盘访问。命令可能已部分执行，不要自动重放或换写法绕过。'
    }
    return result
  } finally { await sandbox.cleanup() }
}

async function resolveUserPath() {
  // Do not run unrestricted login scripts while enabling the executor.
  return [...new Set([...(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin',
    '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(value => value.startsWith('/') && !value.includes('\0')))].join(':')
}

module.exports = { OUTPUT_LIMIT, runProcess, runSandboxed, resolveUserPath }
