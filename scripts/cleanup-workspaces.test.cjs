const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { cleanupLegacyWorkspaces } = require('../src/local-exec/cleanup-workspaces.cjs')

async function fixture(t) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'matter-cleanup-')))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  return { home, root: path.join(home, 'Matter') }
}

test('cleanup removes only mapped or recognizable empty legacy directories, including an empty generated cache', async t => {
  const f = await fixture(t)
  const orphan = '查看桌面-cv_01M79PJHKRWFRS5JFJYRJRK1RR'
  for (const name of ['Mapped-conv1', orphan, 'Has-files-conv2', 'User folder', 'Linked-conv3', 'Has-cache-conv4']) {
    if (name !== 'Linked-conv3') await fs.mkdir(path.join(f.root, name), { recursive: true })
  }
  await fs.mkdir(path.join(f.root, 'Mapped-conv1/.matter-cache'))
  await fs.mkdir(path.join(f.root, 'Has-cache-conv4/.matter-cache'))
  await fs.writeFile(path.join(f.root, 'Has-cache-conv4/.matter-cache/keep'), 'cache')
  await fs.writeFile(path.join(f.root, 'Has-files-conv2/report.txt'), 'report')
  const outside = path.join(f.home, 'outside'); await fs.mkdir(outside)
  await fs.symlink(outside, path.join(f.root, 'Linked-conv3'))
  const workspaces = { conv1: 'Mapped-conv1', conv2: 'Has-files-conv2', conv3: 'Linked-conv3', conv4: 'Has-cache-conv4' }
  const result = await cleanupLegacyWorkspaces({ ...f, workspaces })
  assert.deepEqual(result, { removed: 2, preserved: 2, errors: 0 })
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['Has-cache-conv4', 'Has-files-conv2', 'Linked-conv3', 'User folder'])
  assert.equal(await fs.readFile(path.join(f.root, 'Has-files-conv2/report.txt'), 'utf8'), 'report')
  assert.equal(await fs.readFile(path.join(f.root, 'Has-cache-conv4/.matter-cache/keep'), 'utf8'), 'cache')
  assert.equal((await fs.lstat(outside)).isDirectory(), true)
  assert.equal((await cleanupLegacyWorkspaces({ ...f, workspaces })).removed, 0)
})

test('cleanup does not create an absent root, traverse a replaced root or remove the home directory', async t => {
  const f = await fixture(t)
  assert.deepEqual(await cleanupLegacyWorkspaces(f), { removed: 0, preserved: 0, errors: 0 })
  assert.deepEqual(await fs.readdir(f.home), [])
  const outside = path.join(f.home, 'outside'); await fs.mkdir(outside)
  await fs.mkdir(path.join(outside, 'Mapped-conv1'))
  await fs.symlink(outside, f.root)
  assert.equal((await cleanupLegacyWorkspaces({ ...f, workspaces: { conv1: 'Mapped-conv1' } })).removed, 0)
  assert.deepEqual(await fs.readdir(outside), ['Mapped-conv1'])
  assert.equal((await cleanupLegacyWorkspaces({ home: f.home, root: f.home })).removed, 0)
})
