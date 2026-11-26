const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml')
const { parseVersion } = require('../src/updateCheck.cjs')
const { validateUpdateInfo } = require('../src/desktopUpdater.cjs')

function readUpdateManifest(file) {
  return validateUpdateInfo(yaml.load(fs.readFileSync(file, 'utf8')))
}

function verifyUpdateArtifacts(directory, manifestFile, version) {
  const info = readUpdateManifest(manifestFile)
  if (info.version !== version) throw new Error('应用内更新清单版本不一致')
  for (const file of info.files) {
    const bytes = fs.readFileSync(path.join(directory, file.url))
    if (file.size !== bytes.length || file.sha512 !== crypto.createHash('sha512').update(bytes).digest('base64')) {
      throw new Error(`更新安装文件校验失败：${file.url}`)
    }
  }
  return info
}

function refreshUpdateManifest(directory, version, releaseNotes) {
  parseVersion(version)
  const manifestFile = path.join(directory, 'latest-mac.yml')
  const original = yaml.load(fs.readFileSync(manifestFile, 'utf8'))
  if (original.version !== version) throw new Error('更新清单版本与安装包不符')
  const files = ['zip', 'dmg'].map(extension => {
    const name = `MinduckMatter-${version}-arm64.${extension}`
    const bytes = fs.readFileSync(path.join(directory, name))
    const generated = original.files?.find(file => file.url === name)
    return { ...generated, url: name,
      sha512: crypto.createHash('sha512').update(bytes).digest('base64'), size: bytes.length }
  })
  const info = validateUpdateInfo({ ...original, ...(releaseNotes === undefined ? {} : { releaseNotes }),
    files, path: files[0].url, sha512: files[0].sha512 })
  fs.writeFileSync(manifestFile, yaml.dump(info, { lineWidth: -1 }))
  return info
}

if (require.main === module) {
  const [directory, version, notesFile] = process.argv.slice(2)
  refreshUpdateManifest(directory, version, notesFile ? fs.readFileSync(notesFile, 'utf8').trim() : undefined)
  console.log('Refreshed macOS update manifest for final ZIP/DMG bytes.')
}

module.exports = { readUpdateManifest, refreshUpdateManifest, verifyUpdateArtifacts }
