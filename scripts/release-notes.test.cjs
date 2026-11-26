const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const { readReleaseNotes } = require('./release-notes.cjs')

function fixture(t, text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-release-notes-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'CHANGELOG.md')
  fs.writeFileSync(file, text)
  return file
}

test('release notes select only the exact version and leave drafts and other releases out', t => {
  const file = fixture(t, '# 更新内容\r\n\r\n## 未发布\r\n- 尚未发布\r\n\r\n## 0.1.8\r\n\r\n- 新增：更新说明。\r\n- 修复：桌宠抖动。\r\n\r\n## 0.1.7\r\n- 旧版内容\r\n')
  assert.equal(readReleaseNotes(file, '0.1.8'), '- 新增：更新说明。\n- 修复：桌宠抖动。')
})

test('formal releases reject missing, duplicate, empty or oversized version notes', t => {
  for (const text of ['## 未发布\n- 草稿', '## 0.1.8\n\n## 0.1.7\n- 旧版',
    '## 0.1.8\n- 第一份\n## 0.1.8\n- 重复', '## 0.1.8\n' + 'x'.repeat(2001)]) {
    assert.throws(() => readReleaseNotes(fixture(t, text), '0.1.8'), /更新说明/)
  }
  assert.throws(() => readReleaseNotes(fixture(t, ''), '../0.1.8'), /版本号/)
})

test('packaging CLI freezes the selected notes and reports missing notes before building', t => {
  const file = fixture(t, '## 0.1.8\n\n- 优化：应用内更新。\n')
  const run = version => spawnSync(process.execPath, [path.join(__dirname, 'release-notes.cjs'), file, version], { encoding: 'utf8' })
  const success = run('0.1.8')
  assert.equal(success.status, 0)
  assert.equal(success.stdout, '- 优化：应用内更新。\n')
  const missing = run('0.1.9')
  assert.equal(missing.status, 1)
  assert.equal(missing.stdout, '')
  assert.match(missing.stderr, /0\.1\.9.*更新说明/)
})
