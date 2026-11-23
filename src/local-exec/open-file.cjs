const fs = require('node:fs/promises')
const { canonical } = require('./workspace.cjs')

// The OS owns file associations and directory/application opening behavior.
// Pass only the authorized local path, never an application choice or command.
async function openLocalPath(filename, { openPath, validate }) {
  const before = await fs.lstat(filename)
  if (!before.isFile() && !before.isDirectory()) throw new Error('只能打开本机文件或目录')
  await validate()
  const resolved = await canonical(filename), after = await fs.lstat(filename)
  if (resolved !== filename || (!after.isFile() && !after.isDirectory()) || after.dev !== before.dev || after.ino !== before.ino) throw new Error('目标路径已变化，请重新确认')
  await validate()
  let error
  try { error = await openPath(filename) }
  catch (failure) { error = failure.message || String(failure) }
  if (error) return { status:'open_failed', path:filename, error, isError:true,
    command_executed:true, may_have_partial_effects:true, retryable:false,
    message:'系统未确认打开目标，请根据实际错误处理；不要自动重试或改用 Shell 绕过。' }
  return { status:'open_requested', path:filename, command_executed:true, may_have_partial_effects:false,
    message:'已将目标路径交给系统按默认方式打开；此回执不验证目标应用的画面或文件内容。' }
}

module.exports = { openLocalPath }
