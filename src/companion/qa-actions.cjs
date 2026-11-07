const fs = require('node:fs/promises')
const path = require('node:path')
const { createQaContract } = require('./qa-contract.cjs')
const contract = createQaContract()
const MAX_FILE_BYTES = 50 * 1024 * 1024

// The pet can request a chooser, never name a local path. File bytes stay in the native parent and
// Matter's authenticated isolated world; only attachment IDs/names return to the pet.
async function handleMatterQa({ bridge, dialog }, action, value) {
  if (!bridge) throw new Error('Matter 会话暂不可用')
  if (action.startsWith('chat-')) {
    const command = action.slice(5), target = contract.chatTarget(value,command)
    if (command !== 'upload') return bridge.executeQa(action,target)
    // Verify the editor's captured login/organization before opening the native chooser.
    if (target.conversationId) await bridge.executeQa('chat-check',target)
    else {
      const context = await bridge.executeQa('chat-context',{})
      if (context.contextId !== target.contextId) throw new Error('会话已切换，请重新打开桌宠输入框')
    }
    return chooseFiles(dialog,files => bridge.executeQa('chat-upload',target,files))
  }
  const command = action === 'qa-answer' ? 'answer' : action === 'qa-upload' ? 'upload' : ''
  const target = contract.target(value, command)
  if (command === 'answer') return bridge.executeQa(command, target)
  await bridge.executeQa('check', target)
  return chooseFiles(dialog,files => bridge.executeQa('upload',target,files))
}

async function chooseFiles(dialog, upload) {
  const selection = await dialog.showOpenDialog({ title:'为 Matter 添加附件', properties:['openFile', 'multiSelections'] })
  if (selection.canceled || !selection.filePaths.length) return { ok:true, attachments:[] }
  if (selection.filePaths.length > 20) throw new Error('一次最多上传 20 个文件')
  const attachments = []
  for (const filename of selection.filePaths) {
    const stat = await fs.stat(filename)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('请选择不超过 50 MB 的文件')
    const data = await fs.readFile(filename)
    if (data.length > MAX_FILE_BYTES) throw new Error('文件过大，请重新选择')
    const result = await upload([{ name:path.basename(filename), base64:data.toString('base64') }])
    attachments.push(...result.attachments)
  }
  return { ok:true, attachments }
}

module.exports = { handleMatterQa }
