import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import type { DirectorPlayer } from '../src/main/server/domains/auto-director/autoDirector.types'
import { computeGeometryFeatures } from '../src/main/server/domains/auto-director/geometry/geometryFeatures'
import { computeCameraVisibility } from '../src/main/server/domains/auto-director/geometry/cameraVisibility'
import {
  GeometryMap,
  type GeometryArtifact
} from '../src/main/server/domains/auto-director/geometry/geometryMap'
import { GeometryRegistry } from '../src/main/server/domains/auto-director/geometry/geometryRegistry'

const wallArtifact: GeometryArtifact = {
  schemaVersion: 1,
  mapName: 'de_geometry_fixture',
  sourceSha256: 'a'.repeat(64),
  coordinateSystem: 'source2-hammer-units',
  triangles: [5, -2, 0, 5, 2, 0, 5, 2, 3, 5, -2, 0, 5, 2, 3, 5, -2, 3]
}

const geometry = new GeometryMap(wallArtifact)
assert.equal(geometry.triangleCount, 2)
assert.equal(geometry.hasLineOfSight([0, 0, 1.6], [10, 0, 1.6]), false)
assert.equal(geometry.hasLineOfSight([0, 3, 1.6], [10, 3, 1.6]), true)
assert.equal(geometry.hasLineOfSight([0, 0, 4], [10, 0, 4]), true)
assert.equal(geometry.hasLineOfSight([0, 0, 1.6], [4, 0, 1.6]), true)
assert.equal(geometry.hasLineOfSight([6, 0, 1.6], [10, 0, 1.6]), true)
assert.ok(Math.abs(geometry.firstIntersectionDistance([0, 0, 1.6], [10, 0, 1.6])! - 5) < 1e-6)
assert.equal(geometry.toRenderArtifact(1).triangles.length, 9)
assert.equal(geometry.toRenderArtifact(1).sourceTriangleCount, 2)

assert.throws(() => new GeometryMap({ ...wallArtifact, schemaVersion: 2 as 1 }), /schema version/)
assert.throws(() => new GeometryMap({ ...wallArtifact, triangles: [0, 1, 2] }), /complete XYZ/)
assert.throws(() => new GeometryMap({ ...wallArtifact, sourceSha256: 'not-a-checksum' }), /SHA-256/)

const player = (
  steamId: string,
  team: 'CT' | 'T',
  position: [number, number, number],
  forward: [number, number, number]
): DirectorPlayer => ({
  steamId,
  name: steamId,
  team,
  observerSlot: team === 'CT' ? 1 : 6,
  health: 100,
  armor: 100,
  alive: true,
  flashed: 0,
  position,
  forward,
  weapon: 'weapon_ak47',
  weaponType: 'Rifle',
  ammoClip: 30,
  kills: 0,
  roundKills: 0,
  roundDamage: 0,
  hasBomb: false
})

const tallWall = new GeometryMap({
  ...wallArtifact,
  triangles: [5, -128, 0, 5, 128, 0, 5, 128, 128, 5, -128, 0, 5, 128, 128, 5, -128, 128]
})
const features = computeGeometryFeatures(
  [
    player('observer', 'CT', [0, 0, 0], [1, 0, 0]),
    player('visible', 'T', [3, 0, 0], [-1, 0, 0]),
    player('occluded', 'T', [10, 0, 0], [-1, 0, 0])
  ],
  tallWall
).get('observer')!
assert.equal(features.visibleEnemyCount, 1)
assert.equal(features.nearestVisibleEnemySteamId, 'visible')
assert.equal(features.nearestVisibleEnemyDistance, 3)
assert.equal(features.bestVisibleAimAlignment, 1)
assert.equal(features.forwardEnemyCount, 2)
assert.equal(features.forwardEnemyAlignment, 1)

const cameraVisibility = computeCameraVisibility(
  {
    position: [0, 0, 48],
    angles: [0, 0, 0]
  },
  [
    { steamId: 'visible-from-camera', position: [3, 0, 0], alive: true },
    { steamId: 'behind-box', position: [10, 0, 0], alive: true },
    { steamId: 'outside-shot', position: [3, 300, 0], alive: true },
    { steamId: 'dead-player', position: [3, 0, 0], alive: false }
  ],
  tallWall
)
assert.equal(cameraVisibility.get('visible-from-camera')?.visible, true)
assert.equal(cameraVisibility.get('visible-from-camera')?.reason, 'visible')
assert.equal(cameraVisibility.get('behind-box')?.inFrustum, true)
assert.equal(cameraVisibility.get('behind-box')?.visible, false)
assert.equal(cameraVisibility.get('behind-box')?.reason, 'occluded')
assert.equal(cameraVisibility.get('outside-shot')?.reason, 'outside-frustum')
assert.equal(cameraVisibility.get('dead-player')?.reason, 'dead')

const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jts-geometry-'))
try {
  fs.writeFileSync(
    path.join(artifactDirectory, 'de_geometry_fixture.jgeo.json.gz'),
    gzipSync(JSON.stringify(wallArtifact), { level: 9 })
  )
  const registry = new GeometryRegistry(artifactDirectory)
  assert.equal(registry.load('de_missing'), null)
  assert.equal(registry.getStatus().state, 'missing')
  assert.equal(registry.load('de_geometry_fixture')?.triangleCount, 2)
  assert.equal(registry.getStatus().state, 'loaded')
  assert.equal(registry.load('../escape'), null)
  assert.equal(registry.getStatus().state, 'error')
} finally {
  fs.rmSync(artifactDirectory, { recursive: true, force: true })
}

const startedAt = performance.now()
for (let index = 0; index < 10_000; index += 1) {
  geometry.hasLineOfSight([0, index % 4, 1.6], [10, index % 4, 1.6])
}
const elapsedMs = performance.now() - startedAt
assert.ok(elapsedMs < 1_000, `Synthetic LOS benchmark took ${elapsedMs.toFixed(1)} ms`)

console.log(
  `Auto-director geometry fixture passed: validation, registry, features, BVH raycasts and 10k LOS queries in ${elapsedMs.toFixed(1)} ms`
)
