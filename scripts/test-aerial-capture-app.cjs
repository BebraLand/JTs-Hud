const assert = require('node:assert/strict')
const test = require('node:test')

const {
  MAP_PATTERN,
  parseCurrentMap,
  parseGetposOutput,
  formatPoseCommand
} = require('../tools/aerial-capture/app/netcon.cjs')
const {
  DEFAULT_GSI_STATE_URL,
  GSI_STATE_PATH,
  parseGsiMap,
  validateGsiStateUrl
} = require('../tools/aerial-capture/app/gsi.cjs')
const {
  createAerialBundle,
  getBundleManifests,
  isAerialBundle,
  isValidManifest
} = require('../tools/aerial-capture/app/manifest.cjs')

test('parses the current map from JTs-Hud GSI state', () => {
  assert.equal(parseGsiMap({ map: { name: 'de_Ancient' } }), 'de_ancient')
  assert.equal(parseGsiMap({ map: { name: 'maps/de_mirage' } }), 'de_mirage')
  assert.equal(parseGsiMap({ map: { name: 'game' } }), null)
  assert.equal(DEFAULT_GSI_STATE_URL, 'http://127.0.0.1:23415/cs2/state')
  assert.equal(validateGsiStateUrl(DEFAULT_GSI_STATE_URL), DEFAULT_GSI_STATE_URL)
  assert.equal(
    validateGsiStateUrl('http://localhost:23415/cs2/state'),
    'http://localhost:23415/cs2/state'
  )
  assert.throws(() => validateGsiStateUrl('http://127.0.0.1:23415/cs2/input'), /must end with/)
  assert.equal(GSI_STATE_PATH, '/cs2/state')
})

test('creates one multi-map Aerial bundle and accepts legacy single-map manifests', () => {
  const ancient = {
    schemaVersion: 1,
    map: 'de_ancient',
    coordinateSystem: 'source2-hammer-units',
    source: 'cs2-netcon-getpos',
    anchors: { t_spawn: { id: 't_spawn', position: [1, 2, 3], angles: [0, 90, 0] } }
  }
  const dust2 = {
    schemaVersion: 1,
    map: 'de_dust2',
    coordinateSystem: 'source2-hammer-units',
    source: 'cs2-netcon-getpos',
    anchors: { a_site: { id: 'a_site', position: [4, 5, 6], angles: [0, 180, 0] } }
  }
  const bundle = createAerialBundle({ [ancient.map]: ancient, [dust2.map]: dust2 })
  assert.equal(isValidManifest(ancient, 'de_ancient'), true)
  assert.equal(isAerialBundle(bundle), true)
  assert.deepEqual(Object.keys(getBundleManifests(bundle)), ['de_ancient', 'de_dust2'])
  assert.equal(getBundleManifests(bundle).de_dust2.anchors.a_site.position[0], 4)
  assert.equal(isAerialBundle({ ...bundle, maps: { de_cache: ancient } }), false)
})

test('parses a current de_* map from status output', () => {
  assert.equal(parseCurrentMap('hostname: test\nmap : de_Mirage\nplayers : 1'), 'de_mirage')
  assert.equal(parseCurrentMap('map : workshop/custom_map'), null)
  assert.equal(parseCurrentMap('Current map: de_dust2'), 'de_dust2')
  assert.equal(MAP_PATTERN.test('de_cache'), true)
  assert.equal(MAP_PATTERN.test('cache'), false)
})

test('formats a saved pose as a free-camera teleport command', () => {
  assert.equal(
    formatPoseCommand({ position: [1, -2.5, 300], angles: [-10, 90, 0] }),
    'spec_mode 5; spec_mode 6; spec_goto 1 -2.5 300 -10 90'
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
