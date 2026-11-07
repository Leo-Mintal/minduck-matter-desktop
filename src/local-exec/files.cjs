const path = require('node:path')
const { runSandboxed } = require('./shell.cjs')

function fileDiff(filename, before, after) {
  if (before === after) return `文件没有变化：${filename}`
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++
  let suffix = 0
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix++
  return [`--- ${filename}`, `+++ ${filename}`, `@@ 从第 ${prefix + 1} 行修改 @@`,
    ...oldLines.slice(prefix, oldLines.length - suffix).map(line => '-' + line),
    ...newLines.slice(prefix, newLines.length - suffix).map(line => '+' + line)].join('\n')
}

async function fileOperation(request, options, signal) {
  const worker = path.join(__dirname, 'file-worker.cjs').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
  const result = await runSandboxed(options, process.execPath, [worker], {
    signal, timeoutMs: 30000, input: JSON.stringify(request), outputLimit: 4 * 1024 * 1024,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  if (result.cancelled || result.timed_out) throw new Error('文件操作已取消或超时')
  let parsed
  try { parsed = JSON.parse(result.stdout) } catch { throw new Error('文件工具执行失败：' + result.stderr.slice(0, 1000)) }
  if (result.exit_code !== 0 || parsed.error) throw new Error(parsed.error || result.stderr)
  return parsed
}

module.exports = { fileOperation, fileDiff }
