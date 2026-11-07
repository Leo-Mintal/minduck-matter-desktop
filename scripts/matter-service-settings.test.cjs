const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'matter-service-settings.html'), 'utf8')

test('Matter service settings uses the shared desktop stylesheet and pill control contracts', () => {
  assert.match(source, /web-dist\/desktop-shell\/assets\/shared\.css/)
  assert.match(source, /class="field-control-wrap input input--pill"/)
  assert.match(source, /class="field-control input-control"/)
  assert.equal((source.match(/class="b b-(?:primary|tertiary) b-pill b-md"/g) || []).length, 3)
  assert.match(source, /prefers-reduced-motion/)
})
