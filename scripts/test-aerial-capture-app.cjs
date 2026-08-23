const assert = require('node:assert/strict')
const test = require('node:test')

const {
  MAP_PATTERN,
  parseCurrentMap,
  parseGetposOutput,
  formatPoseCommand
} = require('../tools/aerial-capture/app/netcon.cjs')

test('parses a current de_* map from status output', () => {
  assert.equal(parseCurrentMap('hostname: test\nmap : de_Mirage\nplayers : 1'), 'de_mirage')
  assert.equal(parseCurrentMap('map : workshop/custom_map'), null)
  assert.equal(parseCurrentMap('Current map: de_dust2'), 'de_dust2')
  assert.equal(MAP_PATTERN.test('de_cache'), true)
  assert.equal(MAP_PATTERN.test('cache'), false)
})

test('formats a saved pose as exact teleport commands', () => {
  assert.equal(
    formatPoseCommand({ position: [1, -2.5, 300], angles: [-10, 90, 0] }),
    'setpos_exact 1 -2.5 300; setang_exact -10 90 0'
  )
  assert.throws(
    () => formatPoseCommand({ position: [1, 2], angles: [0, 0, 0] }),
    /Invalid anchor pose/
  )
})

test('parses getpos output used by the capture IPC handler', () => {
  assert.deepEqual(parseGetposOutput('setpos_exact 10.5 -20 30; setang 12.5 180 0'), {
    position: [10.5, -20, 30],
    angles: [12.5, 180, 0]
  })
})
