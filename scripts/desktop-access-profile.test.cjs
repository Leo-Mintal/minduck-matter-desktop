const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { prepare } = require('./prepare-desktop-access-profile.cjs')

test('packaging rejects incompatible profiles before writing entitlements', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-profile-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'build'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ build: { appId: 'com.minduck.matter' } }))
  fs.writeFileSync(path.join(root, 'build/entitlements.mac.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>existing</key><true/></dict></plist>')
  const valid = { Platform: '["OSX"]', ExpirationDate: '2099-01-01T00:00:00Z', 'TeamIdentifier.0': 'TEAM123456',
    Entitlements: JSON.stringify({ 'com.apple.application-identifier': 'TEAM123456.com.minduck.matter', 'keychain-access-groups': ['TEAM123456.*'] }) }
  const output = path.join(root, 'out.plist')
  const run = fields => {
    const inserts = []
    prepare({ root, output, profile: '/test/profile', exec: (bin, args) => {
      if (bin === 'security') return Buffer.from('test signed profile')
      if (args[0] === '-extract') return fields[args[1]]
      inserts.push(args)
      if (process.platform === 'darwin') return execFileSync(bin,args)
      return ''
    } })
    return inserts
  }
  for (const invalid of [{ Platform: '["iOS"]' }, { ExpirationDate: 'invalid' }, { ExpirationDate: '2020-01-01' },
    { 'TeamIdentifier.0': '' }, { Entitlements: JSON.stringify({ 'com.apple.application-identifier': 'OTHER.*' }) },
    { Entitlements: JSON.stringify({ 'com.apple.application-identifier': 'TEAM123456.*', 'keychain-access-groups': ['OTHER.*'] }) }]) {
    assert.throws(() => run({ ...valid, ...invalid }))
    assert.equal(fs.existsSync(output), false)
  }
  const inserts = run(valid)
  assert.deepEqual(inserts.map(value => value[1]), ['com\\.apple\\.application-identifier', 'com\\.apple\\.developer\\.team-identifier', 'keychain-access-groups'])
  if (process.platform === 'darwin') {
    const plist=JSON.parse(execFileSync('plutil',['-convert','json','-o','-',output],{encoding:'utf8'}))
    assert.equal(plist.existing,true)
    assert.equal(plist['com.apple.application-identifier'],'TEAM123456.com.minduck.matter')
    assert.equal(plist['com.apple.developer.team-identifier'],'TEAM123456')
    assert.deepEqual(plist['keychain-access-groups'],['TEAM123456.com.minduck.matter'])
  }
})
