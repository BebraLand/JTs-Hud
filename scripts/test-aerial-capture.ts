import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createManifest,
  manifestToJson,
  normalizeAnchorName,
  parseGetposOutput,
  upsertAnchor
} from '../tools/aerial-capture/src/protocol'

test('parses Source 2 getpos output', () => {
  const pose = parseGetposOutput(
    'setpos_exact 123.500000 -45.250000 80.000000;setang 12.000000 270.500000 0.000000'
  )

  assert.deepEqual(pose, {
    position: [123.5, -45.25, 80],
    angles: [12, 270.5, 0]
  })
})

test('parses getpos output embedded in console noise', () => {
  const pose = parseGetposOutput(
    'Console: current camera\nsetpos 1 2 3; setang -10 90 0\n> '
  )

  assert.deepEqual(pose, {
    position: [1, 2, 3],
    angles: [-10, 90, 0]
  })
})

test('rejects malformed getpos output and normalizes names', () => {
  assert.equal(parseGetposOutput('setpos 1 2 3'), null)
  assert.equal(normalizeAnchorName('A Site / Overview'), 'a_site_overview')
  assert.throws(() => normalizeAnchorName(''))
})

test('stores an anchor in a versioned manifest', () => {
  const manifest = upsertAnchor(
    createManifest('de_ancient'),
    'A Site',
    { position: [1, 2, 3], angles: [4, 5, 6] },
    'setpos 1 2 3; setang 4 5 6',
    'wide plant overview'
  )

  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.map, 'de_ancient')
  assert.deepEqual(manifest.anchors.a_site.position, [1, 2, 3])
  assert.equal(manifest.anchors.a_site.notes, 'wide plant overview')
  assert.match(manifestToJson(manifest), /"coordinateSystem": "source2-hammer-units"/)
})
