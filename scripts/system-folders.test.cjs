const test = require('node:test')
const assert = require('node:assert/strict')
const { systemFolderFor, requestSystemFolder } = require('../src/local-exec/system-folders.cjs')

test('system folder routing accepts only absolute or tilde paths inside three standard folders', () => {
  const home = '/Users/example'
  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    assert.equal(systemFolderFor(`~/${name}/project/a.txt`, home).root, `${home}/${name}`)
    assert.equal(systemFolderFor(`${home}/${name}`, home).root, `${home}/${name}`)
  }
  for (const request of [undefined, '~', '~/Desktop-old', '~/Documents/../.ssh', 'Documents/file', '/tmp/Documents']) {
    assert.equal(systemFolderFor(request, home), null)
  }
})

test('native access probe reads at most one entry and closes the handle without returning contents', async () => {
  let reads = 0, closes = 0
  const folder = { root: '/Users/example/Documents', label: '文稿' }
  const fs = { realpath: async value => value, opendir: async value => {
    assert.equal(value, folder.root)
    return { read: async () => { reads++; return { name: 'private-file' } }, close: async () => { closes++ } }
  } }
  assert.equal(await requestSystemFolder(folder, fs), true)
  assert.equal(reads, 1); assert.equal(closes, 1)
})

test('system denial fails closed with settings guidance and never retries', async () => {
  const folder = { root: '/Users/example/Documents', label: '文稿' }
  for (const code of ['EPERM', 'EACCES']) {
    let attempts = 0, closes = 0
    await assert.rejects(requestSystemFolder(folder, {
      realpath: async value => value,
      opendir: async () => ({ read: async () => { attempts++; throw Object.assign(new Error('denied'), { code }) },
        close: async () => { closes++ } }),
    }), error => error.denied === true && error.message.includes('完全磁盘访问'))
    assert.equal(attempts, 1); assert.equal(closes, 1)
  }
})

test('replaced or absent standard folders fall back without probing their contents', async () => {
  const folder = { root: '/Users/example/Documents', label: '文稿' }
  const unexpected = async () => assert.fail('must not probe a redirected standard folder')
  assert.equal(await requestSystemFolder(folder, { realpath: async () => '/elsewhere', opendir: unexpected }), false)
  assert.equal(await requestSystemFolder(folder, { realpath: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }, opendir: unexpected }), false)
})

test('packaging declares the three system folder access purposes', () => {
  const info = require('../package.json').build.mac.extendInfo
  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    assert.ok(info[`NS${name}FolderUsageDescription`].includes('Matter'))
  }
})
