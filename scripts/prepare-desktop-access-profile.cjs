const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function prepare({ profile, output, root = path.join(__dirname, '..'), exec = execFileSync }) {
  if (!profile || !output) throw new Error('Expected provisioning profile and entitlements output paths')
  const xml = exec('security', ['cms', '-D', '-i', path.resolve(profile)])
  const extract = (key, format = 'raw') => exec('plutil', ['-extract', key, format, '-o', '-', '--', '-'], { input: xml, encoding: 'utf8' }).trim()
  const platform = JSON.parse(extract('Platform', 'json'))
  if (!Array.isArray(platform) || !platform.includes('OSX')) throw new Error('Desktop activation requires a macOS provisioning profile, not an iOS profile')
  const expiration = Date.parse(extract('ExpirationDate'))
  if (!Number.isFinite(expiration) || expiration <= Date.now()) throw new Error('The macOS provisioning profile has expired or has an invalid expiration date')
  const entitlements = JSON.parse(extract('Entitlements', 'json'))
  const authorized = entitlements['com.apple.application-identifier']
  const team = extract('TeamIdentifier.0')
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('Invalid profile team identifier')
  const { appId, mac } = require(path.join(root, 'package.json')).build
  const identifier = `${team}.${appId}`
  const matches = (rule, value) => typeof rule === 'string' && (rule === value || rule.endsWith('*') && value.startsWith(rule.slice(0, -1)))
  if (!matches(authorized, identifier)) throw new Error('The profile does not authorize this desktop application identifier')
  if (!(entitlements['keychain-access-groups'] || []).some(value => matches(value, identifier))) throw new Error('The profile does not authorize the desktop Keychain access group')
  fs.copyFileSync(path.resolve(root, mac.entitlements), output)
  // plutil treats dots as path separators unless escaped; entitlements use
  // literal dotted keys at the root of the dictionary.
  const put = (key, kind, value) => exec('plutil', ['-insert', key.replace(/\./g, '\\.'), kind, value, output])
  put('com.apple.application-identifier', '-string', identifier)
  put('com.apple.developer.team-identifier', '-string', team)
  put('keychain-access-groups', '-json', JSON.stringify([identifier]))
  return output
}
if (require.main === module) console.log(prepare({ profile: process.argv[2], output: process.argv[3] }))
module.exports = { prepare }
