// Runs as a short-lived Node process inside the same OS sandbox as Shell.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { TextDecoder } = require('node:util')
const MAX_BYTES = 256 * 1024

function revision(text) { return crypto.createHash('sha256').update(text).digest('hex') }
function transferRead(filename, args) {
  if (!Number.isSafeInteger(args.offset) || args.offset < 0 || !Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > MAX_BYTES) throw new Error('文件分块参数无效')
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
  const fingerprint = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true })
    if (!stat.isFile() || stat.size > 268435456n) throw new Error('只支持不超过 256MiB 的普通文件')
    const size = Number(stat.size), version = fingerprint(stat)
    if (args.offset > size || (args.offset !== 0 && !args.revision) || (args.revision && args.revision !== version)) throw new Error('文件已变化或分块位置无效')
    const data = Buffer.alloc(Math.min(args.limit, size - args.offset))
    let read = 0
    while (read < data.length) {
      const count = fs.readSync(descriptor, data, read, data.length - read, args.offset + read)
      if (!count) throw new Error('文件在传输中发生变化')
      read += count
    }
    if (fingerprint(fs.fstatSync(descriptor, { bigint: true })) !== version) throw new Error('文件在传输中发生变化')
    return { filename: path.basename(filename), size, offset: args.offset, revision: version, data: data.toString('base64'), eof: args.offset + read === size }
  } finally { fs.closeSync(descriptor) }
}
function read(filename) {
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('只支持不超过 256KB 的文本文件')
    const buffer = fs.readFileSync(descriptor)
    if (buffer.length > MAX_BYTES || buffer.includes(0)) throw new Error('文件过大或是二进制文件')
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), mode: stat.mode & 0o777 }
  } finally { fs.closeSync(descriptor) }
}

function operation(request) {
  const { action, filename, args = {} } = request
  if (action === 'transfer-read') return transferRead(filename, args)
  let before = null
  try { before = read(filename) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (action === 'read') {
    if (!before) throw new Error('文件不存在')
    const lines = before.text.split('\n')
    const offset = args.offset ?? 0
    const selected = lines.slice(offset, offset + (args.limit ?? 2000))
    return { path: filename, content: selected.map((line, i) => `${offset + i + 1}: ${line}`).join('\n'),
      revision: revision(before.text), total_lines: lines.length, truncated: offset + selected.length < lines.length }
  }
  const currentRevision = before ? revision(before.text) : null
  if (currentRevision !== request.expectedRevision) throw new Error('文件在读取后发生变化，请先重新读取')
  let after = args.content
  if (action === 'prepare-edit') {
    if (!before) throw new Error('文件不存在，请先读取')
    const count = before.text.split(args.old_string).length - 1
    if (!count || (!args.replace_all && count !== 1)) throw new Error('old_string 必须匹配且唯一，请重新读取并提供更多上下文')
    after = args.replace_all ? before.text.split(args.old_string).join(args.new_string) : before.text.replace(args.old_string, () => args.new_string)
  }
  if (typeof after !== 'string' || after.includes('\0') || Buffer.byteLength(after) > MAX_BYTES) throw new Error('写入内容无效或超过 256KB')
  if (action.startsWith('prepare-')) return { before: before?.text || '', after, revision: currentRevision, exists: before !== null }
  if (action !== 'commit') throw new Error('未知文件操作')
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  const temporary = path.join(path.dirname(filename), `.matter-edit-${crypto.randomUUID()}`)
  try {
    fs.writeFileSync(temporary, after, { mode: before?.mode ?? 0o600, flag: 'wx' })
    if (before) {
      if (revision(read(filename).text) !== currentRevision) throw new Error('文件已变化，请重新读取')
      fs.renameSync(temporary, filename)
    } else fs.linkSync(temporary, filename)
  } finally { fs.rmSync(temporary, { force: true }) }
  return { path: filename, revision: revision(after), bytes_written: Buffer.byteLength(after) }
}

if (require.main === module) {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    input += chunk
    if (input.length > MAX_BYTES * 12) process.exit(1)
  })
  process.stdin.on('end', () => {
    try { process.stdout.write(JSON.stringify(operation(JSON.parse(input)))) }
    catch (error) { process.stdout.write(JSON.stringify({ error: error.message, code: error.code, path: error.path })); process.exitCode = 1 }
  })
}

module.exports = { operation, revision, MAX_BYTES }
