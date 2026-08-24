import assert from 'node:assert/strict'
import test from 'node:test'
import { computeCameraDebugStatus, emptyCameraDebugStatus } from '../src/main/server/domains/auto-director/cameraDebug'
import type { AerialCameraAnchor } from '../src/main/server/domains/auto-director/aerial/aerialCameraRegistry'
import type { DirectorPlayer, PlayerScore } from '../src/main/server/domains/auto-director/autoDirector.types'
import { GeometryMap } from '../src/main/server/domains/auto-director/geometry/geometryMap'
import { getRadarMapConfig, worldToRadar } from '../src/renderer/src/features/auto-director/radar'

const makePlayer = (
  steamId: string,
  name: string,
  team: 'T' | 'CT',
  position: [number, number, number],
  forward: [number, number, number]
): DirectorPlayer => ({
  steamId,
  name,
  team,
  observerSlot: team === 'T' ? 1 : 2,
  health: 100,
  armor: 100,
  alive: true,
  flashed: 0,
  position,
  forward,
  weapon: 'weapon_ak47',
  weaponType: 'Rifle',
  ammoClip: 30,
  kills: 2,
  roundKills: 1,
  roundDamage: 80,
  hasBomb: false
})

const makeScore = (player: DirectorPlayer, total: number): PlayerScore => ({
  steamId: player.steamId,
  name: player.name,
  team: player.team,
  observerSlot: player.observerSlot,
  alive: player.alive,
  total,
  factors: [],
  nearestEnemyDistance: 300,
  switchEligible: true
})

const anchor: AerialCameraAnchor = {
  id: 'mid',
  label: 'Mid',
  kind: 'mid',
  position: [0, -200, 64],
  angles: [0, 0, 0]
}

const geometry = new GeometryMap({
  schemaVersion: 1,
  mapName: 'de_ancient',
  sourceSha256: 'a'.repeat(64),
  coordinateSystem: 'source2-hammer-units',
  triangles: [1000, 1000, 0, 1100, 1000, 0, 1000, 1100, 0]
})

const players = [
  makePlayer('t', 'Rainwaker', 'T', [300, 0, 0], [-1, 0, 0]),
  makePlayer('ct', 'sh1ro', 'CT', [-300, 0, 0], [1, 0, 0])
]

test('empty camera debug status is safe before GSI', () => {
  const status = emptyCameraDebugStatus()
  assert.equal(status.mapName, null)
  assert.deepEqual(status.players, [])
  assert.deepEqual(status.anchors, [])
})

test('JTs-Hud radar transform places Ancient spawn anchors on the map', () => {
  const config = getRadarMapConfig('maps/de_ancient.bsp')
  assert.ok(config)
  assert.equal(config.asset, 'radar-257c12c3.png')
  const tSpawn = worldToRadar([-250.964157, -2430.066406, -13.788737], config)
  const ctSpawn = worldToRadar([-98.902443, 1030.861328, 85.071098], config)
  assert.deepEqual(tSpawn.map(Math.round), [540, 919])
  assert.deepEqual(ctSpawn.map(Math.round), [571, 227])
})

test('radar resolver switches assets by map and falls back for unsupported maps', () => {
  const expectedAssets = {
    de_ancient: 'radar-257c12c3.png',
    de_anubis: 'radar-d6f7b7b1.png',
    de_cache: 'radar-9ed7aced.png',
    de_dust2: 'radar-d2e673ab.png',
    de_inferno: 'radar-230b60d6.png',
    de_mirage: 'radar-0f6c4bb0.png',
    de_nuke: 'radar-e7a6de7b.png',
    de_overpass: 'radar-5ec70095.png',
    de_train: 'radar-63202ed1.png',
    de_vertigo: 'radar-f15cebdb.png'
  } as const

  for (const [mapName, asset] of Object.entries(expectedAssets)) {
    assert.equal(getRadarMapConfig(mapName)?.asset, asset)
  }
  assert.equal(getRadarMapConfig('de_unknown'), null)
  assert.equal(getRadarMapConfig(null), null)
})

test('camera debug projects player and Aerial visibility evidence', () => {
  const status = computeCameraDebugStatus({
    mapName: 'de_ancient',
    at: 123,
    players,
    scores: [makeScore(players[0], 42), makeScore(players[1], -4)],
    geometryFeatures: null,
    geometry,
    anchors: [anchor],
    currentPlayerSteamId: 't',
    candidatePlayerSteamId: 't',
    activeAnchorId: null,
    geometryMessage: '1 triangle loaded'
  })
  assert.equal(status.geometryAvailable, true)
  assert.equal(status.mapName, 'de_ancient')
  assert.equal(status.players.length, 2)
  assert.equal(status.anchors.length, 1)
  assert.equal(status.anchors[0].visibleSteamIds.includes('t'), true)
  assert.equal(status.anchors[0].occludedSteamIds.length, 0)
  assert.equal(status.currentPlayerSteamId, 't')
  assert.equal(status.players[0].cameraScore > status.players[1].cameraScore, true)
})

test('camera debug distinguishes frustum coverage from geometry occlusion', () => {
  const wallGeometry = new GeometryMap({
    schemaVersion: 1,
    mapName: 'de_ancient',
    sourceSha256: 'b'.repeat(64),
    coordinateSystem: 'source2-hammer-units',
    triangles: [
      150, -128, 0, 150, 128, 0, 150, 128, 128,
      150, -128, 0, 150, 128, 128, 150, -128, 128
    ]
  })
  const status = computeCameraDebugStatus({
    mapName: 'de_ancient',
    at: 456,
    players: [players[0]],
    scores: [makeScore(players[0], 42)],
    geometryFeatures: null,
    geometry: wallGeometry,
    anchors: [anchor],
    currentPlayerSteamId: null,
    candidatePlayerSteamId: null,
    activeAnchorId: 'mid',
    geometryMessage: 'wall loaded'
  })
  assert.deepEqual(status.anchors[0].inFrustumSteamIds, ['t'])
  assert.deepEqual(status.anchors[0].visibleSteamIds, [])
  assert.deepEqual(status.anchors[0].occludedSteamIds, ['t'])
  assert.match(status.anchors[0].reason, /occluded/)
})
