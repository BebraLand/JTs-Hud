import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AutoDirectorDecision,
  AutoDirectorSettings,
  DirectorPlayer,
  GsiLikePayload
} from '../src/main/server/domains/auto-director/autoDirector.types'
import { AerialCameraRegistry } from '../src/main/server/domains/auto-director/aerial/aerialCameraRegistry'
import { decideAerialPresentation } from '../src/main/server/domains/auto-director/aerial/aerialPresentation'
import {
  GeometryMap,
  type GeometryArtifact
} from '../src/main/server/domains/auto-director/geometry/geometryMap'

const settings: AutoDirectorSettings = {
  enabled: true,
  paused: false,
  mode: 'balanced',
  autoFallback: false,
  rulesEnabled: true,
  sceneAdvisoryEnabled: true,
  geometryAdvisoryEnabled: true,
  mlAdvisoryEnabled: true,
  aerialPresentationEnabled: true,
  aerialPresentationPhases: {
    freezeTime: true,
    midRound: true,
    roundEnd: true
  },
  minimumDwellOverrideMs: null,
  postDeathHoldMs: 1000,
  customPresets: [],
  scoringIntervalMs: 100,
  manualOverrideSteamId: null,
  customWeights: {}
}

const decision = (overrides: Partial<AutoDirectorDecision> = {}): AutoDirectorDecision => ({
  at: 1,
  scores: [],
  currentSteamId: 'ct-1',
  currentName: 'ct-1',
  candidateSteamId: 'ct-1',
  candidateName: 'ct-1',
  runnerUpSteamId: null,
  runnerUpName: null,
  shouldSwitch: false,
  reason: 'Current POV remains informative',
  lockKind: 'none',
  lockUntil: null,
  ...overrides
})

const player = (
  steamId: string,
  team: 'CT' | 'T',
  position: [number, number, number]
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
  forward: [1, 0, 0],
  weapon: 'weapon_ak47',
  weaponType: 'Rifle',
  ammoClip: 30,
  kills: 0,
  roundKills: 0,
  roundDamage: 0,
  hasBomb: false
})

const geometry = new GeometryMap({
  schemaVersion: 1,
  mapName: 'de_ancient',
  sourceSha256: 'a'.repeat(64),
  coordinateSystem: 'source2-hammer-units',
  triangles: [
    -1000, -1000, -1000, -1000, 1000, -1000, -1000, 1000, 1000, -1000, -1000, -1000, -1000, 1000,
    1000, -1000, -1000, 1000
  ]
} satisfies GeometryArtifact)

const players = [
  player('ct-1', 'CT', [100, 0, 0]),
  player('ct-2', 'CT', [120, 20, 0]),
  player('ct-3', 'CT', [140, 20, 0]),
  player('t-1', 'T', [140, -20, 0]),
  player('t-2', 'T', [160, 10, 0]),
  player('t-3', 'T', [180, -10, 0])
]

const aerialMap = {
  mapName: 'de_ancient',
  anchors: [
    {
      id: 't_spawn',
      label: 'T Spawn',
      kind: 'spawn' as const,
      position: [0, 0, 0] as const,
      angles: [0, 0, 0] as const
    },
    {
      id: 'ct_spawn',
      label: 'CT Spawn',
      kind: 'spawn' as const,
      position: [0, 0, 0] as const,
      angles: [0, 0, 0] as const
    },
    {
      id: 'mid',
      label: 'Mid',
      kind: 'mid' as const,
      position: [0, 0, 0] as const,
      angles: [0, 0, 0] as const
    },
    {
      id: 'a_postplant',
      label: 'A Postplant',
      kind: 'postplant' as const,
      position: [0, 0, 0] as const,
      angles: [0, 0, 0] as const
    }
  ]
}

const quietPayload: GsiLikePayload = {
  map: { name: 'de_ancient', phase: 'live' },
  round: { phase: 'live' }
}
const quiet = decideAerialPresentation(
  quietPayload,
  settings,
  players,
  decision(),
  aerialMap,
  geometry
)
assert.equal(quiet.eligible, true)
assert.equal(quiet.anchor?.id, 'mid')
assert.equal(quiet.visibleSteamIds.length, 6)

const freeze = decideAerialPresentation(
  { map: { name: 'de_ancient', phase: 'live' }, round: { phase: 'freezetime' } },
  settings,
  players,
  decision(),
  aerialMap,
  geometry
)
assert.equal(freeze.eligible, true)
assert.equal(freeze.anchor?.id, 't_spawn')

const freezeNextAnchor = decideAerialPresentation(
  { map: { name: 'de_ancient', phase: 'live' }, round: { phase: 'freezetime' } },
  settings,
  players,
  decision(),
  aerialMap,
  geometry,
  { excludedAnchorIds: new Set(['t_spawn']) }
)
assert.equal(freezeNextAnchor.eligible, true)
assert.equal(freezeNextAnchor.anchor?.id, 'ct_spawn')
assert.equal(freezeNextAnchor.visibleCtCount, 3)
assert.match(freezeNextAnchor.reason, /opposite-team visibility is not required/)

const sparseFreezePlayers = [
  player('ct-sparse', 'CT', [100, 0, 0]),
  player('t-sparse', 'T', [140, -20, 0])
]
const sparseFreeze = decideAerialPresentation(
  { map: { name: 'de_ancient', phase: 'live' }, round: { phase: 'freezetime' } },
  settings,
  sparseFreezePlayers,
  decision(),
  aerialMap,
  geometry
)
assert.equal(sparseFreeze.eligible, true)
assert.equal(sparseFreeze.anchor?.id, 't_spawn')
const sparseFreezeCt = decideAerialPresentation(
  { map: { name: 'de_ancient', phase: 'live' }, round: { phase: 'freezetime' } },
  settings,
  sparseFreezePlayers,
  decision(),
  aerialMap,
  geometry,
  { excludedAnchorIds: new Set(['t_spawn']) }
)
assert.equal(sparseFreezeCt.eligible, true)
assert.equal(sparseFreezeCt.anchor?.id, 'ct_spawn')

const geometryBlindFreeze = decideAerialPresentation(
  { map: { name: 'de_ancient', phase: 'live' }, round: { phase: 'freezetime' } },
  settings,
  [],
  decision(),
  aerialMap,
  geometry
)
assert.equal(geometryBlindFreeze.eligible, true)
assert.equal(geometryBlindFreeze.anchor?.id, 't_spawn')
const geometryBlindFreezeCt = decideAerialPresentation(
  { map: { name: 'de_ancient', phase: 'live' }, round: { phase: 'freezetime' } },
  settings,
  [],
  decision(),
  aerialMap,
  geometry,
  { excludedAnchorIds: new Set(['t_spawn']) }
)
assert.equal(geometryBlindFreezeCt.eligible, true)
assert.equal(geometryBlindFreezeCt.anchor?.id, 'ct_spawn')

const freezeWithoutSpawns = decideAerialPresentation(
  { map: { name: 'de_ancient', phase: 'live' }, round: { phase: 'freezetime' } },
  settings,
  players,
  decision(),
  aerialMap,
  geometry,
  { excludedAnchorIds: new Set(['t_spawn', 'ct_spawn']) }
)
assert.equal(freezeWithoutSpawns.eligible, false)
assert.match(freezeWithoutSpawns.reason, /freeze-time/)

const planted = decideAerialPresentation(
  { ...quietPayload, bomb: { state: 'planted' } },
  settings,
  players,
  decision(),
  aerialMap,
  geometry
)
assert.equal(planted.eligible, true)
assert.equal(planted.anchor?.id, 'a_postplant')

const defuse = decideAerialPresentation(
  { ...quietPayload, bomb: { state: 'defusing' } },
  settings,
  players,
  decision(),
  aerialMap,
  geometry
)
assert.equal(defuse.eligible, false)
assert.equal(defuse.actionBlocked, true)
assert.match(defuse.reason, /defuse/)

const combat = decideAerialPresentation(
  quietPayload,
  settings,
  players,
  decision({
    scores: [
      {
        steamId: 'ct-1',
        name: 'ct-1',
        team: 'CT',
        observerSlot: 1,
        alive: true,
        total: 10,
        nearestEnemyDistance: null,
        switchEligible: true,
        factors: [{ key: 'combat', label: 'Combat', value: 10, detail: 'fixture contact' }]
      }
    ]
  }),
  aerialMap,
  geometry
)
assert.equal(combat.eligible, false)
assert.equal(combat.actionBlocked, true)

const predictedContact = decideAerialPresentation(
  quietPayload,
  settings,
  players,
  decision({
    scores: [
      {
        steamId: 'ct-1',
        name: 'ct-1',
        team: 'CT',
        observerSlot: 1,
        alive: true,
        total: 10,
        nearestEnemyDistance: null,
        switchEligible: true,
        factors: [
          {
            key: 'mlAdvisory',
            label: 'ML advisory',
            value: 8,
            detail: 'future contact'
          }
        ]
      }
    ]
  }),
  aerialMap,
  geometry
)
assert.equal(predictedContact.eligible, false)
assert.equal(predictedContact.actionBlocked, true)

const firstPersonSwitch = decideAerialPresentation(
  quietPayload,
  settings,
  players,
  decision({ shouldSwitch: true }),
  aerialMap,
  geometry
)
assert.equal(firstPersonSwitch.eligible, false)
assert.match(firstPersonSwitch.reason, /First-person switch/)

const disabled = decideAerialPresentation(
  quietPayload,
  { ...settings, aerialPresentationEnabled: false },
  players,
  decision(),
  aerialMap,
  geometry
)
assert.equal(disabled.eligible, false)
assert.match(disabled.reason, /disabled/)

const freezeDisabled = decideAerialPresentation(
  { map: { name: 'de_ancient', phase: 'live' }, round: { phase: 'freezetime' } },
  {
    ...settings,
    aerialPresentationPhases: { ...settings.aerialPresentationPhases, freezeTime: false }
  },
  players,
  decision(),
  aerialMap,
  geometry
)
assert.equal(freezeDisabled.eligible, false)
assert.match(freezeDisabled.reason, /freeze-time/)

const productionRegistry = new AerialCameraRegistry(
  path.resolve(process.cwd(), 'resources/auto-director/aerial')
)
const importedProductionMaps = [
  'de_ancient',
  'de_anubis',
  'de_cache',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke'
]
for (const mapName of importedProductionMaps) {
  const calibrated = productionRegistry.load(mapName)
  assert.ok(calibrated, `Expected imported Aerial map ${mapName}`)
  assert.ok(calibrated.anchors.length > 0, `Expected anchors for ${mapName}`)
  assert.ok(calibrated.anchors.every((anchor) => anchor.position.every(Number.isFinite)))
}
const calibratedDust2 = productionRegistry.load('de_dust2')
assert.ok(calibratedDust2?.anchors.some((anchor) => anchor.id === 't_spawn'))
assert.ok(calibratedDust2?.anchors.some((anchor) => anchor.id === 'ct_spawn'))

const manifestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jts-aerial-'))
try {
  fs.writeFileSync(
    path.join(manifestDirectory, 'jts-aerial-anchors.json'),
    JSON.stringify({
      schemaVersion: 2,
      coordinateSystem: 'source2-hammer-units',
      source: 'cs2-netcon-getpos',
      maps: {
        de_ancient: {
          schemaVersion: 1,
          map: 'de_ancient',
          coordinateSystem: 'source2-hammer-units',
          source: 'cs2-netcon-getpos',
          anchors: {
            valid: aerialMap.anchors[1],
            malformed: {
              id: 'malformed',
              label: 'Bad',
              kind: 'mid',
              position: [0, 0],
              angles: [0, 0, 0]
            }
          }
        }
      }
    })
  )
  const registry = new AerialCameraRegistry(manifestDirectory)
  assert.equal(registry.load('de_ancient')?.anchors.length, 1)
  assert.equal(registry.getStatus().state, 'loaded')
  assert.equal(registry.load('../escape'), null)
  assert.equal(registry.getStatus().state, 'error')
} finally {
  fs.rmSync(manifestDirectory, { recursive: true, force: true })
}

console.log('Aerial presentation policy fixtures passed')
