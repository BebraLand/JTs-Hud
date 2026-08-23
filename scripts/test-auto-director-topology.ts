import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { DirectorPlayer } from '../src/main/server/domains/auto-director/autoDirector.types'
import { GeometryMap } from '../src/main/server/domains/auto-director/geometry/geometryMap'
import { computeTopologyFeatures } from '../src/main/server/domains/auto-director/topology/topologyFeatures'
import {
  TopologyMap,
  type TopologyArtifact
} from '../src/main/server/domains/auto-director/topology/topologyMap'

const resourceDirectory = path.join(process.cwd(), 'resources', 'auto-director', 'topology')
const officialMaps = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_overpass'
]

for (const mapName of officialMaps) {
  const artifactPath = path.join(resourceDirectory, `${mapName}.jtopo.json.gz`)
  assert.equal(fs.existsSync(artifactPath), true, `${mapName} topology artifact is missing`)
  const artifact = JSON.parse(
    gunzipSync(fs.readFileSync(artifactPath)).toString('utf8')
  ) as TopologyArtifact
  const topology = new TopologyMap(artifact)
  assert.ok(topology.areaCount > 100, `${mapName} has too few topology areas`)
  assert.ok(topology.portalCount > 50, `${mapName} has too few topology portals`)
  assert.ok(artifact.areas.some((area) => area.routeClasses.includes('site_a')))
  assert.ok(artifact.areas.some((area) => area.routeClasses.includes('site_b')))
  const sourceArea = artifact.areas[0]
  const targetArea = artifact.areas.find(
    (area) => area.id !== sourceArea.id && area.neighbors.includes(sourceArea.id)
  )
  assert.ok(targetArea, `${mapName} has no adjacent topology area`)
  const route = topology.findNearestEnemyPath(sourceArea.id, [targetArea!.id])
  assert.ok(route && route.areaIds.length >= 2, `${mapName} cannot traverse an adjacent route`)
}

const area = (
  id: number,
  center: [number, number, number],
  neighbors: number[],
  callout: string,
  routeClasses: TopologyArtifact['areas'][number]['routeClasses']
) => ({
  id,
  center,
  bounds: [
    center[0] - 40,
    center[1] - 40,
    center[0] + 40,
    center[1] + 40,
    center[2],
    center[2] + 16
  ] as [number, number, number, number, number, number],
  neighbors,
  callout,
  calloutConfidence: 1,
  routeClasses
})

const testArtifact: TopologyArtifact = {
  schemaVersion: 1,
  mapName: 'de_fixture',
  coordinateSystem: 'source2-hammer-units',
  source: {
    navigationSha256: 'a'.repeat(64),
    calloutSha256: 'b'.repeat(64)
  },
  bounds: [-40, -40, 440, 240, 0, 16],
  areas: [
    area(1, [0, 0, 0], [2], 'TSpawn', ['spawn']),
    area(2, [200, 0, 0], [1, 3, 4], 'Middle', ['mid']),
    area(3, [400, 0, 0], [2], 'BombsiteB', ['site_b']),
    area(4, [200, 200, 0], [2], 'Short', ['short'])
  ],
  portals: [
    {
      id: '1:2',
      from: 1,
      to: 2,
      center: [100, 0, 0],
      width: 128,
      orientation: 'horizontal',
      normal: [1, 0],
      vertical: false
    },
    {
      id: '2:3',
      from: 2,
      to: 3,
      center: [300, 0, 0],
      width: 128,
      orientation: 'horizontal',
      normal: [1, 0],
      vertical: false
    },
    {
      id: '2:4',
      from: 2,
      to: 4,
      center: [200, 100, 0],
      width: 96,
      orientation: 'vertical',
      normal: [0, 1],
      vertical: false
    }
  ]
}

const topology = new TopologyMap(testArtifact)
const makePlayer = (
  steamId: string,
  team: 'CT' | 'T',
  position: [number, number, number]
): DirectorPlayer => ({
  steamId,
  name: steamId,
  team,
  observerSlot: 1,
  health: 100,
  armor: 100,
  alive: true,
  flashed: 0,
  position,
  forward: [1, 0, 0],
  weapon: 'rifle',
  weaponType: 'Rifle',
  ammoClip: 30,
  kills: 0,
  roundKills: 0,
  roundDamage: 0,
  hasBomb: false
})

const defender = makePlayer('defender', 'CT', [400, 0, 0])
const enemiesAtSpawn = [
  makePlayer('t1', 'T', [0, 0, 0]),
  makePlayer('t2', 'T', [0, 0, 0]),
  makePlayer('t3', 'T', [0, 0, 0]),
  makePlayer('short-lurk', 'T', [200, 200, 0])
]
const firstSnapshot = computeTopologyFeatures([defender, ...enemiesAtSpawn], topology, null)
const first = firstSnapshot.get('defender')!
assert.equal(first.callout, 'BombsiteB')
assert.equal(first.routeTargetCount, 3)
assert.equal(first.routePortalId, '2:3')
assert.ok(first.routeEntryRelevance >= 0.35)
assert.equal(first.peekPotential, true)
assert.equal(first.topologyConfidence, 1)

const enemiesAtMiddle = enemiesAtSpawn.map((enemy) =>
  enemy.steamId === 'short-lurk'
    ? enemy
    : { ...enemy, position: [200, 0, 0] as [number, number, number] }
)
const previous = new Map(enemiesAtSpawn.map((enemy) => [enemy.steamId, enemy]))
const secondSnapshot = computeTopologyFeatures(
  [defender, ...enemiesAtMiddle],
  topology,
  null,
  previous
)
const second = secondSnapshot.get('defender')!
assert.equal(second.incomingRouteCount, 3)
assert.ok(second.incomingRoutePressure >= 0.9)
assert.ok(second.routeEntryRelevance >= first.routeEntryRelevance)

const wallGeometry = new GeometryMap({
  schemaVersion: 1,
  mapName: 'de_fixture',
  sourceSha256: 'c'.repeat(64),
  coordinateSystem: 'source2-hammer-units',
  triangles: [350, -80, 0, 350, 80, 0, 350, 80, 120, 350, -80, 0, 350, 80, 120, 350, -80, 120]
})
const wallOccluded = computeTopologyFeatures(
  [defender, ...enemiesAtSpawn],
  topology,
  wallGeometry
).get('defender')!
assert.equal(wallOccluded.routePortalId, '2:3')
assert.equal(wallOccluded.peekPotential, false)

const shortReceiver = makePlayer('short-receiver', 'CT', [200, 200, 0])
const actionableShort = computeTopologyFeatures(
  [shortReceiver, ...enemiesAtSpawn],
  topology,
  wallGeometry
).get('short-receiver')!
assert.equal(actionableShort.routePortalId, '2:4')
assert.equal(actionableShort.peekPotential, true)

console.log('Auto Director topology tests passed')
