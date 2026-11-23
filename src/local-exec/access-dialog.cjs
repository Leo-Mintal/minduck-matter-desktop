function createAccessDialog({ dialog, getWindow }) {
  return async ({ path, access, reason, conversation, signal }) => {
    if (signal.aborted) return false
    const window = getWindow()
    if (!window || window.isDestroyed()) return false
    const options = {
      type: 'question', title: '本机文件访问授权',
      message: `允许当前任务${access === 'write' ? '读取和修改' : '读取'}指定位置吗？`,
      detail: `位置：${path}\n会话：${conversation || '当前会话'}\n用途：${reason || '完成你发起的本机文件任务'}\n\n授权仅对当前任务有效，包含所选目录的子项。读取的文件内容和命令输出可能回传你配置的 Matter 服务。`,
      buttons: ['不允许', '允许当前任务'], defaultId: 0, cancelId: 0, noLink: true, signal,
    }
    const result = await dialog.showMessageBox(window, options)
    return !signal.aborted && result.response === 1
  }
}

module.exports = { createAccessDialog }
