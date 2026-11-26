const fs = require('node:fs')
const { parseVersion } = require('../src/updateCheck.cjs')

function readReleaseNotes(file, version) {
  parseVersion(version)
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').split('\n')
  const headings = lines.flatMap((line, index) => line.trim() === `## ${version}` ? [index] : [])
  if (headings.length !== 1) throw new Error(`请在 CHANGELOG.md 中为版本 ${version} 写一份简短更新说明（## ${version}）`)
  const start = headings[0] + 1
  const next = lines.findIndex((line, index) => index >= start && /^##\s/.test(line))
  const notes = lines.slice(start, next < 0 ? undefined : next).join('\n').trim()
  if (!notes || notes.length > 2000) throw new Error(`版本 ${version} 的更新说明不能为空，且不超过 2000 字符`)
  return notes
}

if (require.main === module) {
  try { process.stdout.write(readReleaseNotes(process.argv[2], process.argv[3]) + '\n') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}

module.exports = { readReleaseNotes }
