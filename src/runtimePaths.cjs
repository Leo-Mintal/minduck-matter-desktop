const path = require('node:path')

function developmentUserDataPath(appDataDirectory, override) {
  return override || path.join(appDataDirectory, 'minduck-matter-desktop-dev')
}

module.exports = {
  developmentUserDataPath,
}
