import assert from 'node:assert/strict'
import { AutoDirectorEngine } from '../src/main/server/domains/auto-director/autoDirector.engine'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import type {
  AutoDirectorSettings,
  GsiLikePayload
} from '../src/main/server/domains/auto-director/autoDirector.types'
import type { PlayerGeometryFeatures } from '../src/main/server/domains/auto-director/geometry/geometryFeatures'
import type { PlayerTopologyFeatures } from '../src/main/server/domains/auto-director/topology/topologyFeatures'
import { normalizeObserverSlot } from '../src/main/server/integrations/observerSlot'

assert.deepEqual(
  Array.from({ length: 10 }, (_, slot) => normalizeObserverSlot(slot)),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
)
assert.equal(normalizeObserverSlot(10), -1)
assert.equal(normalizeObserverSlot(undefined), -1)

const settings: AutoDirectorSettings = {
  ...DEFAULT_AUTO_DIRECTOR_SETTINGS,
  enabled: true,
  mode: 'balanced'
}

const player = (
  name: string,
  team: 'CT' | 'T',
  slot: number,
  position: string,
  forward: string,
  overrides: Record<string, any> = {}
) => ({
  name,
  team,
  observer_slot: slot,
  position,
  forward,
  state: {
    health: 100,
    armor: 100,
    flashed: 0,
    round_kills: 0,
    round_totaldmg: 0,
    ...(overrides.state ?? {})
  },
  match_stats: { kills: 0, ...(overrides.match_stats ?? {}) },
  weapons: {
    weapon_0: {
      name: 'weapon_ak47',
      type: 'Rifle',
      state: 'active',
      ammo_clip: 30,
      ...(overrides.weapon ?? {})
    },
    ...(overrides.weapons ?? {})
  }
})

const snapshot = (overrides: Partial<GsiLikePayload> = {}): GsiLikePayload => ({
  map: { round: 4, phase: 'live', team_ct: { score: 2 }, team_t: { score: 1 } },
  round: { phase: 'live' },
  phase_countdowns: { phase: 'live', phase_ends_in: '80.0' },
  allplayers: {
    ct: player('Anchor', 'CT', 1, '0, 0, 0', '1, 0, 0'),
    t: player('Entry', 'T', 6, '1000, 0, 0', '-1, 0, 0')
  },
  ...overrides
})

const geometryFeature = (
  steamId: string,
  options: Partial<PlayerGeometryFeatures> = {}
): PlayerGeometryFeatures => ({
  steamId,
  visibleEnemyCount: 0,
  nearestVisibleEnemySteamId: null,
  nearestVisibleEnemyDistance: null,
  nearestEnemyHasLineOfSight: false,
  nearestEnemyHasPeekPotential: false,
  peekPotentialEnemyCount: 0,
  visibleEnemySteamIds: [],
  peekPotentialEnemySteamIds: [],
  forwardEnemySteamIds: [],
  forwardEnemyCount: 0,
  forwardEnemyAlignment: 0,
  bestVisibleAimAlignment: 0,
  ...options
})

const invalidSlotDecision = new AutoDirectorEngine().evaluate(
  snapshot({
    allplayers: {
      invalid: player('Invalid slot', 'CT', 10, '0, 0, 0', '1, 0, 0')
    }
  }),
  settings,
  500
)
assert.equal(invalidSlotDecision.scores[0]?.switchEligible, false)
assert.equal(invalidSlotDecision.candidateSteamId, null)

const sniperSightline = new AutoDirectorEngine().evaluate(
  snapshot({
    allplayers: {
      sniper: player('AWPer', 'CT', 1, '0, 0, 0', '1, 0, 0', {
        weapon: { name: 'weapon_awp', type: 'SniperRifle', ammo_clip: 10 }
      }),
      rifle: player('Rifler', 'CT', 2, '0, 100, 0', '1, 0, 0'),
      target: player('Target', 'T', 6, '1200, 0, 0', '-1, 0, 0')
    }
  }),
  settings,
  750
)
const sniperScore = sniperSightline.scores.find((score) => score.steamId === 'sniper')!
const rifleScore = sniperSightline.scores.find((score) => score.steamId === 'rifle')!
const sniperSetup = sniperScore.factors.find((factor) => factor.key === 'weaponPressure')
assert.equal(sniperSetup?.value, 14)
assert.match(sniperSetup?.detail ?? '', /sniper sightline proxy/i)
assert.ok(sniperScore.total > rifleScore.total)

const utilityOnlyEngine = new AutoDirectorEngine()
const utilityOnlyPayload = snapshot({
  allplayers: {
    magixx: player('magixx', 'CT', 5, '0, 0, 0', '1, 0, 0', {
      weapon: { name: 'weapon_smokegrenade', type: 'Grenade', ammo_clip: 1 }
    }),
    aAnchor: player('A anchor', 'CT', 1, '900, 0, 0', '1, 0, 0'),
    aT1: player('A T 1', 'T', 6, '1200, 0, 0', '-1, 0, 0'),
    aT2: player('A T 2', 'T', 7, '1200, 250, 0', '-1, 0, 0'),
    aT3: player('A T 3', 'T', 8, '1200, -250, 0', '-1, 0, 0'),
    aT4: player('A T 4', 'T', 9, '1200, 500, 0', '-1, 0, 0'),
    aT5: player('A T 5', 'T', 0, '1200, -500, 0', '-1, 0, 0')
  }
})
const utilityOnlyGeometry = new Map<string, PlayerGeometryFeatures>([
  ['magixx', geometryFeature('magixx')],
  ['aAnchor', geometryFeature('aAnchor')],
  ...['aT1', 'aT2', 'aT3', 'aT4', 'aT5'].map(
    (steamId) => [steamId, geometryFeature(steamId)] as const
  )
])
utilityOnlyEngine.evaluate(utilityOnlyPayload, settings, 1_000, undefined, utilityOnlyGeometry)
const utilityAfterThrow = utilityOnlyEngine.evaluate(
  snapshot({
    allplayers: {
      magixx: player('magixx', 'CT', 5, '0, 0, 0', '1, 0, 0', {
        weapon: { name: 'weapon_smokegrenade', type: 'Grenade', ammo_clip: 0 }
      }),
      aAnchor: player('A anchor', 'CT', 1, '900, 0, 0', '1, 0, 0'),
      aT1: player('A T 1', 'T', 6, '1200, 0, 0', '-1, 0, 0'),
      aT2: player('A T 2', 'T', 7, '1200, 250, 0', '-1, 0, 0'),
      aT3: player('A T 3', 'T', 8, '1200, -250, 0', '-1, 0, 0'),
      aT4: player('A T 4', 'T', 9, '1200, 500, 0', '-1, 0, 0'),
      aT5: player('A T 5', 'T', 0, '1200, -500, 0', '-1, 0, 0')
    }
  }),
  settings,
  1_125,
  undefined,
  utilityOnlyGeometry
)
const utilityOnlyScore = utilityAfterThrow.scores.find((score) => score.steamId === 'magixx')!
assert.equal(
  utilityOnlyScore.factors.some((factor) => factor.key === 'combat'),
  false
)
assert.equal(
  utilityOnlyScore.factors.some((factor) => factor.key === 'grenade'),
  false
)
assert.equal(
  utilityOnlyScore.factors.some((factor) => factor.key === 'routeEntry'),
  false
)
assert.notEqual(utilityAfterThrow.candidateSteamId, 'magixx')

const orientationCheck = new AutoDirectorEngine().evaluate(
  snapshot({
    allplayers: {
      nearbyLookingAway: player('Nearby looking away', 'CT', 1, '0, 0, 0', '-1, 0, 0'),
      focused: player('Focused defender', 'CT', 2, '0, 500, 0', '1, -0.2, 0'),
      target: player('Push target', 'T', 6, '800, 0, 0', '-1, 0, 0')
    }
  }),
  settings,
  800
)
const lookingAwayScore = orientationCheck.scores.find(
  (score) => score.steamId === 'nearbyLookingAway'
)!
assert.equal(
  lookingAwayScore.factors.some((factor) => factor.key === 'orientationPenalty'),
  true
)

const dominantSceneCheck = new AutoDirectorEngine().evaluate(
  snapshot({
    allplayers: {
      isolatedA: player('Isolated A', 'CT', 1, '0, 0, 0', '1, 0, 0'),
      bCt1: player('B Anchor', 'CT', 2, '5000, 0, 0', '1, 0, 0'),
      bCt2: player('B Support 1', 'CT', 3, '5000, 350, 0', '1, -0.2, 0'),
      bCt3: player('B Support 2', 'CT', 4, '5000, -350, 0', '1, 0.2, 0'),
      bCt4: player('B Support 3', 'CT', 5, '5000, 600, 0', '1, -0.3, 0'),
      bT1: player('B Entry', 'T', 6, '5600, 0, 0', '-1, 0, 0'),
      bT2: player('B T 2', 'T', 7, '5600, 300, 0', '-1, 0, 0'),
      bT3: player('B T 3', 'T', 8, '5600, -300, 0', '-1, 0, 0'),
      bT4: player('B T 4', 'T', 9, '5600, 550, 0', '-1, 0, 0'),
      bT5: player('B T 5', 'T', 0, '5600, -550, 0', '-1, 0, 0')
    }
  }),
  settings,
  900
)
const isolatedAScore = dominantSceneCheck.scores.find((score) => score.steamId === 'isolatedA')!
assert.equal(isolatedAScore.isolatedNoAction, true)
assert.equal(
  isolatedAScore.factors.some((factor) => factor.key === 'isolationPenalty'),
  true
)
assert.notEqual(dominantSceneCheck.candidateSteamId, 'isolatedA')
assert.ok(
  dominantSceneCheck.scores.find((score) => score.steamId === 'bCt1')!.sceneMemberCount! >= 9
)
const dominantSceneScore = dominantSceneCheck.scores.find((score) => score.steamId === 'bCt1')!
assert.equal(dominantSceneScore.scenePhase, 'contact')
assert.ok((dominantSceneScore.sceneConfidence ?? 0) >= 0.55)
assert.ok((dominantSceneScore.povQuality ?? 0) > 0)
assert.ok(dominantSceneScore.factors.some((factor) => factor.key === 'scenePovQuality'))
assert.equal(DEFAULT_AUTO_DIRECTOR_SETTINGS.sceneAdvisoryEnabled, true)

const externalThreatViewCheck = new AutoDirectorEngine().evaluate(
  snapshot({
    allplayers: {
      extCt1: player('External CT 1', 'CT', 1, '0, 0, 0', '1, 0, 0'),
      extCt2: player('External CT 2', 'CT', 2, '0, 350, 0', '1, -0.1, 0'),
      extCt3: player('External CT 3', 'CT', 3, '0, -350, 0', '1, 0.1, 0'),
      extCt4: player('External CT 4', 'CT', 4, '0, 600, 0', '-1, 0, 0'),
      loneA: player('Lone A CT', 'CT', 5, '5000, 0, 0', '-1, 0, 0'),
      threatT1: player('Threat T 1', 'T', 6, '1800, 0, 0', '-1, 0, 0'),
      threatT2: player('Threat T 2', 'T', 7, '1800, 300, 0', '-1, 0, 0'),
      threatT3: player('Threat T 3', 'T', 8, '1800, -300, 0', '-1, 0, 0'),
      threatT4: player('Threat T 4', 'T', 9, '1800, 500, 0', '-1, 0, 0'),
      threatT5: player('Threat T 5', 'T', 0, '1800, -500, 0', '-1, 0, 0')
    }
  }),
  settings,
  950
)
const externalCtScore = externalThreatViewCheck.scores.find((score) => score.steamId === 'extCt1')!
const turnedAwayCtScore = externalThreatViewCheck.scores.find(
  (score) => score.steamId === 'extCt4'
)!
const threatTScore = externalThreatViewCheck.scores.find((score) => score.steamId === 'threatT1')!
assert.equal(externalCtScore.threatSceneExternal, true)
assert.ok((externalCtScore.threatSceneTargetCount ?? 0) >= 5)
assert.ok((externalCtScore.threatSceneEnemiesInViewCone ?? 0) >= 4)
assert.ok((externalCtScore.threatSceneCoverage ?? 0) >= 0.8)
assert.equal(externalCtScore.isolatedNoAction, false)
assert.ok(externalCtScore.factors.some((factor) => factor.key === 'scenePovQuality'))
assert.equal(turnedAwayCtScore.threatSceneExternal, false)
assert.equal(
  turnedAwayCtScore.factors.some(
    (factor) => factor.key === 'scenePovQuality' && factor.detail.startsWith('Threat POV')
  ),
  false
)
const loneAScore = externalThreatViewCheck.scores.find((score) => score.steamId === 'loneA')!
assert.equal(loneAScore.isolatedNoAction, true)
assert.equal(
  threatTScore.factors.some((factor) => factor.key === 'sceneRelevance'),
  false
)
assert.equal(externalThreatViewCheck.candidateSteamId, 'extCt1')

const sceneThreatSweepGaps = [1200, 1600, 2200, 2600]
const sceneThreatSweepAngles = [0, 15, 30]
for (const gap of sceneThreatSweepGaps) {
  for (const headingError of sceneThreatSweepAngles) {
    const radians = (headingError * Math.PI) / 180
    const ctForward = `${Math.cos(radians)}, ${Math.sin(radians)}, 0`
    const tForward = `${-Math.cos(radians)}, ${Math.sin(radians)}, 0`
    const sweepDecision = new AutoDirectorEngine().evaluate(
      snapshot({
        allplayers: {
          sweepCt1: player('Sweep CT 1', 'CT', 1, '0, -750, 0', ctForward),
          sweepCt2: player('Sweep CT 2', 'CT', 2, '0, -250, 0', ctForward),
          sweepCt3: player('Sweep CT 3', 'CT', 3, '0, 250, 0', ctForward),
          sweepCt4: player('Sweep CT 4', 'CT', 4, '0, 750, 0', ctForward),
          sweepA: player('Sweep A CT', 'CT', 5, '7000, 0, 0', '-1, 0, 0'),
          sweepT1: player('Sweep T 1', 'T', 6, `${gap}, -200, 0`, tForward),
          sweepT2: player('Sweep T 2', 'T', 7, `${gap}, -100, 0`, tForward),
          sweepT3: player('Sweep T 3', 'T', 8, `${gap}, 100, 0`, tForward),
          sweepT4: player('Sweep T 4', 'T', 9, `${gap}, 200, 0`, tForward),
          sweepT5: player('Sweep T 5', 'T', 0, `${gap}, 0, 0`, tForward)
        }
      }),
      settings,
      2_000 + gap + headingError
    )
    const sweepCtViews = sweepDecision.scores.filter(
      (score) =>
        score.team === 'CT' && score.threatSceneExternal && (score.threatSceneCoverage ?? 0) >= 0.35
    )
    assert.ok(
      sweepCtViews.length >= 1,
      `expected an external CT threat view at gap=${gap}, angle=${headingError}`
    )
    assert.equal(
      sweepDecision.scores[0]?.team,
      'CT',
      `expected CT broadcast POV at gap=${gap}, angle=${headingError}`
    )
    assert.notEqual(sweepDecision.scores[0]?.steamId, 'sweepA')
  }
}

const movingSceneEngine = new AutoDirectorEngine()
movingSceneEngine.evaluate(
  snapshot({
    allplayers: {
      movingCt1: player('Moving CT 1', 'CT', 1, '4800, 0, 0', '1, 0, 0'),
      movingCt2: player('Moving CT 2', 'CT', 2, '4900, 250, 0', '1, 0, 0'),
      movingT1: player('Moving T 1', 'T', 6, '6500, 0, 0', '-1, 0, 0'),
      movingT2: player('Moving T 2', 'T', 7, '6600, 250, 0', '-1, 0, 0')
    }
  }),
  settings,
  1_000
)
const approachingSceneCheck = movingSceneEngine.evaluate(
  snapshot({
    allplayers: {
      movingCt1: player('Moving CT 1', 'CT', 1, '5000, 0, 0', '1, 0, 0'),
      movingCt2: player('Moving CT 2', 'CT', 2, '5100, 250, 0', '1, 0, 0'),
      movingT1: player('Moving T 1', 'T', 6, '5900, 0, 0', '-1, 0, 0'),
      movingT2: player('Moving T 2', 'T', 7, '6000, 250, 0', '-1, 0, 0')
    }
  }),
  settings,
  1_125
)
const approachingScore = approachingSceneCheck.scores.find(
  (score) => score.steamId === 'movingCt1'
)!
assert.equal(approachingScore.scenePhase, 'approaching')
assert.ok((approachingScore.approachPressure ?? 0) > 0.12)
assert.ok((approachingScore.movementMagnitude ?? 0) > 0)

const sceneDisabledCheck = new AutoDirectorEngine().evaluate(
  snapshot({
    allplayers: {
      isolatedA: player('Isolated A', 'CT', 1, '0, 0, 0', '1, 0, 0'),
      bCt1: player('B Anchor', 'CT', 2, '5000, 0, 0', '1, 0, 0'),
      bCt2: player('B Support 1', 'CT', 3, '5000, 350, 0', '1, -0.2, 0'),
      bCt3: player('B Support 2', 'CT', 4, '5000, -350, 0', '1, 0.2, 0'),
      bCt4: player('B Support 3', 'CT', 5, '5000, 600, 0', '1, -0.3, 0'),
      bT1: player('B Entry', 'T', 6, '5600, 0, 0', '-1, 0, 0'),
      bT2: player('B T 2', 'T', 7, '5600, 300, 0', '-1, 0, 0'),
      bT3: player('B T 3', 'T', 8, '5600, -300, 0', '-1, 0, 0'),
      bT4: player('B T 4', 'T', 9, '5600, 550, 0', '-1, 0, 0'),
      bT5: player('B T 5', 'T', 0, '5600, -550, 0', '-1, 0, 0')
    }
  }),
  { ...settings, sceneAdvisoryEnabled: false },
  900
)
const sceneDisabledIsolatedScore = sceneDisabledCheck.scores.find(
  (score) => score.steamId === 'isolatedA'
)!
assert.equal(
  sceneDisabledIsolatedScore.factors.some((factor) =>
    ['sceneRelevance', 'groupCoverage', 'contactImminence', 'isolationPenalty'].includes(factor.key)
  ),
  false
)
assert.equal(sceneDisabledIsolatedScore.sceneKey, null)
assert.equal(sceneDisabledIsolatedScore.sceneMemberCount, 0)
assert.equal(sceneDisabledIsolatedScore.scenePhase, null)
assert.equal(sceneDisabledIsolatedScore.sceneConfidence, 0)

const engine = new AutoDirectorEngine()
const initialPayload = snapshot()
const initial = engine.evaluate(initialPayload, settings, 1_000)
assert.equal(initial.shouldSwitch, true)
assert.equal(initial.candidateSteamId, 'ct')
engine.confirmSwitch('ct', 1_000)

const contactPayload = snapshot({
  allplayers: {
    ct: player('Anchor', 'CT', 1, '0, 0, 0', '1, 0, 0'),
    t: player('Entry', 'T', 6, '1000, 0, 0', '-1, 0, 0', {
      state: { round_totaldmg: 48 },
      weapon: { ammo_clip: 29 }
    })
  }
})
const dwellBlocked = engine.evaluate(contactPayload, settings, 2_000)
assert.equal(dwellBlocked.candidateSteamId, 't')
assert.equal(dwellBlocked.shouldSwitch, false)
assert.equal(dwellBlocked.lockKind, 'minimum-dwell')

const renewedContactPayload = snapshot({
  allplayers: {
    ct: player('Anchor', 'CT', 1, '0, 0, 0', '1, 0, 0'),
    t: player('Entry', 'T', 6, '1000, 0, 0', '-1, 0, 0', {
      state: { round_totaldmg: 96 },
      weapon: { ammo_clip: 28 }
    })
  }
})
const switched = engine.evaluate(renewedContactPayload, settings, 4_000)
assert.equal(switched.candidateSteamId, 't')
assert.equal(switched.shouldSwitch, true)
engine.confirmSwitch('t', 4_000)

const deadCurrentPayload = snapshot({
  allplayers: {
    ct: player('Anchor', 'CT', 1, '0, 0, 0', '1, 0, 0'),
    t: player('Entry', 'T', 6, '1000, 0, 0', '-1, 0, 0', { state: { health: 0 } })
  }
})
const deathRecovery = engine.evaluate(deadCurrentPayload, settings, 4_100)
assert.equal(deathRecovery.shouldSwitch, false)
assert.equal(deathRecovery.lockKind, 'post-death')
const deathRecoveryAfterHold = engine.evaluate(deadCurrentPayload, settings, 5_200)
assert.equal(deathRecoveryAfterHold.shouldSwitch, true)
assert.equal(deathRecoveryAfterHold.candidateSteamId, 'ct')
engine.confirmSwitch('ct', 5_200)

const deathHoldEngine = new AutoDirectorEngine()
const aliveBeforeDeath = snapshot({
  allplayers: {
    ct: player('Anchor', 'CT', 1, '0, 0, 0', '1, 0, 0'),
    t: player('Entry', 'T', 6, '1000, 0, 0', '-1, 0, 0')
  }
})
deathHoldEngine.evaluate(aliveBeforeDeath, settings, 5_000)
deathHoldEngine.confirmSwitch('t', 5_000)
const deathHold = deathHoldEngine.evaluate(deadCurrentPayload, settings, 5_500)
assert.equal(deathHold.shouldSwitch, false)
assert.equal(deathHold.lockKind, 'post-death')
assert.equal(deathHold.lockUntil, 6_500)
const deathAfterHold = deathHoldEngine.evaluate(deadCurrentPayload, settings, 6_600)
assert.equal(deathAfterHold.shouldSwitch, true)
assert.equal(deathAfterHold.candidateSteamId, 'ct')

const overrideEngine = new AutoDirectorEngine()
overrideEngine.evaluate(initialPayload, { ...settings, minimumDwellOverrideMs: 5_000 }, 7_000)
overrideEngine.confirmSwitch('ct', 7_000)
const overrideLock = overrideEngine.evaluate(
  contactPayload,
  { ...settings, minimumDwellOverrideMs: 5_000 },
  10_000
)
assert.equal(overrideLock.shouldSwitch, false)
assert.equal(overrideLock.lockKind, 'minimum-dwell')
assert.equal(overrideLock.lockUntil, 12_000)

const objectivePayload = snapshot({
  bomb: { state: 'planting', player: 't' },
  allplayers: {
    ct: player('Anchor', 'CT', 1, '0, 0, 0', '1, 0, 0'),
    t: player('Entry', 'T', 6, '1000, 0, 0', '-1, 0, 0', {
      weapons: { weapon_c4: { name: 'weapon_c4', type: 'C4', state: 'holstered' } }
    })
  }
})
const objectiveLock = engine.evaluate(objectivePayload, settings, 4_200)
assert.equal(objectiveLock.shouldSwitch, true)
assert.equal(objectiveLock.candidateSteamId, 't')
assert.equal(objectiveLock.lockKind, 'objective')

const objectiveBeatsScore = engine.evaluate(
  objectivePayload,
  {
    ...settings,
    customWeights: { ...settings.customWeights, objective: 0, continuity: 200 }
  },
  4_300
)
assert.equal(objectiveBeatsScore.candidateSteamId, 't')
assert.equal(objectiveBeatsScore.lockKind, 'objective')

const defuseContestEngine = new AutoDirectorEngine()
const defuseContest = defuseContestEngine.evaluate(
  snapshot({
    bomb: { state: 'defusing', player: 'ctDefuser', position: '1200, 0, 0' },
    allplayers: {
      ctDefuser: player('Defusing CT', 'CT', 1, '1200, 0, 0', '-1, 0, 0'),
      ctSupport: player('Supporting CT', 'CT', 2, '5000, 0, 0', '1, 0, 0'),
      tDefender: player('Bomb defender', 'T', 6, '1450, 0, 0', '-1, 0, 0')
    }
  }),
  settings,
  4_500
)
const defuserScore = defuseContest.scores.find((score) => score.steamId === 'ctDefuser')!
assert.equal(
  defuserScore.factors.some((factor) => factor.key === 'objective'),
  false
)
assert.equal(defuseContest.candidateSteamId, 'tDefender')
assert.notEqual(defuseContest.lockKind, 'objective')
assert.doesNotMatch(defuseContest.reason, /Hard objective lock|Holding defusing objective/i)

const freezeTime = engine.evaluate(
  snapshot({ round: { phase: 'freezetime' }, phase_countdowns: { phase: 'freezetime' } }),
  settings,
  4_400
)
assert.equal(freezeTime.shouldSwitch, false)
assert.match(freezeTime.reason, /Waiting for live round/)

const manual = engine.evaluate(initialPayload, { ...settings, manualOverrideSteamId: 't' }, 5_000)
assert.equal(manual.candidateSteamId, 't')
assert.equal(manual.lockKind, 'manual')

const calmEngine = new AutoDirectorEngine()
const calmSettings = { ...settings, mode: 'calm' as const }
const calmInitial = calmEngine.evaluate(initialPayload, calmSettings, 10_000)
calmEngine.confirmSwitch(calmInitial.candidateSteamId!, 10_000)
const calmContact = calmEngine.evaluate(contactPayload, calmSettings, 12_000)
assert.equal(calmContact.shouldSwitch, false)
assert.equal(calmContact.lockKind, 'minimum-dwell')

const emptyShortEngine = new AutoDirectorEngine()
const emptyShortPayload = snapshot({
  allplayers: {
    afro: player('afro', 'CT', 3, '0, 0, 0', '1, 0, 0'),
    rainwaker: player('Rainwaker', 'CT', 5, '1200, 0, 0', '1, 0, 0'),
    b1: player('B entry 1', 'T', 6, '2400, 0, 0', '-1, 0, 0'),
    b2: player('B entry 2', 'T', 7, '2400, 220, 0', '-1, 0, 0'),
    b3: player('B entry 3', 'T', 8, '2400, -220, 0', '-1, 0, 0'),
    b4: player('B entry 4', 'T', 9, '2400, 440, 0', '-1, 0, 0'),
    b5: player('B entry 5', 'T', 0, '2400, -440, 0', '-1, 0, 0')
  }
})
const emptyShortGeometry = new Map<string, PlayerGeometryFeatures>([
  [
    'afro',
    geometryFeature('afro', {
      forwardEnemyCount: 5,
      forwardEnemySteamIds: ['b1', 'b2', 'b3', 'b4', 'b5']
    })
  ],
  [
    'rainwaker',
    geometryFeature('rainwaker', {
      visibleEnemyCount: 1,
      nearestVisibleEnemySteamId: 'b1',
      nearestVisibleEnemyDistance: 1200,
      nearestEnemyHasLineOfSight: true,
      visibleEnemySteamIds: ['b1'],
      forwardEnemyCount: 5,
      forwardEnemySteamIds: ['b1', 'b2', 'b3', 'b4', 'b5']
    })
  ],
  ...['b1', 'b2', 'b3', 'b4', 'b5'].map((steamId) => [steamId, geometryFeature(steamId)] as const)
])
emptyShortEngine.confirmSwitch('afro', 20_000)
const emptyShortFirst = emptyShortEngine.evaluate(
  emptyShortPayload,
  settings,
  24_000,
  undefined,
  emptyShortGeometry
)
const emptyAfroFirst = emptyShortFirst.scores.find((score) => score.steamId === 'afro')!
assert.equal(emptyAfroFirst.isolatedNoAction, true)
assert.equal(
  emptyAfroFirst.factors.some(
    (factor) =>
      factor.key === 'isolationPenalty' &&
      factor.value === -24 &&
      factor.detail.includes('Empty threat angle')
  ),
  true
)
const emptyShortSecond = emptyShortEngine.evaluate(
  emptyShortPayload,
  settings,
  24_125,
  undefined,
  emptyShortGeometry
)
assert.equal(emptyShortSecond.candidateSteamId, 'rainwaker')
assert.equal(emptyShortSecond.shouldSwitch, true)
assert.match(emptyShortSecond.reason, /actionable group route/i)

const occlusionEngine = new AutoDirectorEngine()
const occlusionGeometry = new Map<string, PlayerGeometryFeatures>([
  ['shortCt', geometryFeature('shortCt')],
  [
    'longAnchor',
    geometryFeature('longAnchor', {
      visibleEnemyCount: 1,
      nearestVisibleEnemySteamId: 'pushT1',
      nearestVisibleEnemyDistance: 2500,
      nearestEnemyHasLineOfSight: true,
      visibleEnemySteamIds: ['pushT1']
    })
  ]
])
const occludedNearbyPayload = snapshot({
  allplayers: {
    shortCt: player('Short defender', 'CT', 1, '0, 0, 0', '0, 1, 0'),
    shortT1: player('Short T 1', 'T', 6, '700, 0, 0', '-1, 0, 0'),
    shortT2: player('Short T 2', 'T', 7, '700, 250, 0', '-1, 0, 0'),
    longAnchor: player('Long anchor', 'CT', 2, '0, -1100, 0', '1, 0, 0'),
    sceneCt: player('Scene CT', 'CT', 3, '2450, -1100, 0', '-1, 0, 0'),
    pushT1: player('Push T 1', 'T', 8, '2700, -1100, 0', '-1, 0, 0'),
    pushT2: player('Push T 2', 'T', 9, '2700, -800, 0', '-1, 0, 0'),
    pushT3: player('Push T 3', 'T', 0, '2700, -1400, 0', '-1, 0, 0'),
    pushT4: player('Push T 4', 'T', 4, '2700, -500, 0', '-1, 0, 0')
  }
})
occlusionEngine.evaluate(occludedNearbyPayload, settings, 20_000, undefined, occlusionGeometry)
const incomingPayload = snapshot({
  allplayers: {
    shortCt: player('Short defender', 'CT', 1, '0, 0, 0', '0, 1, 0'),
    shortT1: player('Short T 1', 'T', 6, '700, 0, 0', '-1, 0, 0'),
    shortT2: player('Short T 2', 'T', 7, '700, 250, 0', '-1, 0, 0'),
    longAnchor: player('Long anchor', 'CT', 2, '0, -1100, 0', '1, 0, 0'),
    sceneCt: player('Scene CT', 'CT', 3, '2450, -1100, 0', '-1, 0, 0'),
    pushT1: player('Push T 1', 'T', 8, '2500, -1100, 0', '-1, 0, 0'),
    pushT2: player('Push T 2', 'T', 9, '2500, -800, 0', '-1, 0, 0'),
    pushT3: player('Push T 3', 'T', 0, '2500, -1400, 0', '-1, 0, 0'),
    pushT4: player('Push T 4', 'T', 4, '2500, -500, 0', '-1, 0, 0')
  }
})
const occlusionDecision = occlusionEngine.evaluate(
  incomingPayload,
  settings,
  20_125,
  undefined,
  occlusionGeometry
)
const shortScore = occlusionDecision.scores.find((score) => score.steamId === 'shortCt')!
const longScore = occlusionDecision.scores.find((score) => score.steamId === 'longAnchor')!
assert.equal(
  shortScore.factors.some((factor) => factor.key === 'groupCoverage'),
  false
)
assert.equal(
  shortScore.factors.some((factor) => factor.key === 'incomingGroupPressure'),
  false
)
assert.ok((shortScore.factors.find((factor) => factor.key === 'proximity')?.value ?? 0) < 3)
assert.ok((longScore.incomingGroupPressure ?? 0) >= 0.35)
assert.ok(
  (longScore.factors.find((factor) => factor.key === 'incomingGroupPressure')?.value ?? 0) >
    (shortScore.factors.find((factor) => factor.key === 'incomingGroupPressure')?.value ?? 0)
)

const routeTransitionEngine = new AutoDirectorEngine()
const routeTargets = ['routeT1', 'routeT2', 'routeT3', 'routeT4', 'routeT5']
const routePayload = snapshot({
  allplayers: {
    shortCt: player('Short defender', 'CT', 1, '0, 0, 0', '0, 1, 0'),
    bAnchor: player('B entry anchor', 'CT', 2, '1200, 0, 0', '1, 0, 0'),
    routeT1: player('Route T 1', 'T', 6, '1900, 0, 0', '-1, 0, 0'),
    routeT2: player('Route T 2', 'T', 7, '1900, 250, 0', '-1, 0, 0'),
    routeT3: player('Route T 3', 'T', 8, '1900, -250, 0', '-1, 0, 0'),
    routeT4: player('Route T 4', 'T', 9, '1900, 500, 0', '-1, 0, 0'),
    routeT5: player('Route T 5', 'T', 0, '1900, -500, 0', '-1, 0, 0')
  }
})
const routeGeometry = new Map<string, PlayerGeometryFeatures>([
  ['shortCt', geometryFeature('shortCt')],
  [
    'bAnchor',
    geometryFeature('bAnchor', {
      visibleEnemyCount: 5,
      nearestVisibleEnemySteamId: 'routeT1',
      nearestVisibleEnemyDistance: 700,
      nearestEnemyHasLineOfSight: true,
      visibleEnemySteamIds: routeTargets,
      forwardEnemySteamIds: routeTargets,
      forwardEnemyCount: 5,
      forwardEnemyAlignment: 1,
      bestVisibleAimAlignment: 1
    })
  ],
  ...routeTargets.map((steamId) => [steamId, geometryFeature(steamId)] as const)
])
routeTransitionEngine.evaluate(routePayload, settings, 1_000, undefined, routeGeometry)
routeTransitionEngine.confirmSwitch('shortCt', 1_000)
const routeTransitionDecision = routeTransitionEngine.evaluate(
  routePayload,
  settings,
  4_000,
  undefined,
  routeGeometry
)
const routeAnchorScore = routeTransitionDecision.scores.find(
  (score) => score.steamId === 'bAnchor'
)!
assert.ok((routeAnchorScore.routeEntryRelevance ?? 0) >= 0.55)
assert.ok(routeAnchorScore.factors.some((factor) => factor.key === 'routeEntry'))
assert.equal(routeTransitionDecision.candidateSteamId, 'bAnchor')
assert.equal(routeTransitionDecision.shouldSwitch, true)
assert.match(routeTransitionDecision.reason, /(?:group-entry route|actionable group route)/i)

const peekRouteGeometry = new Map(routeGeometry)
peekRouteGeometry.set(
  'bAnchor',
  geometryFeature('bAnchor', {
    nearestEnemyHasPeekPotential: true,
    peekPotentialEnemyCount: routeTargets.length,
    peekPotentialEnemySteamIds: routeTargets,
    forwardEnemySteamIds: routeTargets,
    forwardEnemyCount: routeTargets.length,
    forwardEnemyAlignment: 1
  })
)
const peekRouteDecision = new AutoDirectorEngine().evaluate(
  routePayload,
  settings,
  4_000,
  undefined,
  peekRouteGeometry
)
const peekRouteScore = peekRouteDecision.scores.find((score) => score.steamId === 'bAnchor')!
assert.ok((peekRouteScore.threatScenePeekCount ?? 0) >= routeTargets.length)
assert.ok((peekRouteScore.threatSceneActionableTargetCount ?? 0) >= routeTargets.length)
assert.ok((peekRouteScore.routeEntryRelevance ?? 0) > 0.08)
assert.equal(peekRouteScore.topologyRouteAdvisoryAllowed, false)
assert.ok(peekRouteScore.factors.some((factor) => factor.key === 'routeEntry'))

const routeTopologyFeature = (
  steamId: string,
  overrides: Partial<PlayerTopologyFeatures> = {}
): PlayerTopologyFeatures => ({
  steamId,
  areaId: 872,
  callout: null,
  routeClasses: [],
  tacticalRoles: [],
  plantSite: null,
  nearestEnemyRouteDistance: 2400,
  nearestEnemyRouteHops: 12,
  routePortalId: 'short:entry',
  routePortalWidth: 128,
  routePortalChokepoint: true,
  portalControlScore: 0.33,
  defensiveAngleScore: 0.28,
  crossfirePotential: 0,
  routeTargetCount: 5,
  routeConvergence: 1,
  routeEntryRelevance: 0.65,
  incomingRouteCount: 5,
  incomingRoutePressure: 1,
  predictedFightMs: 400,
  fightPredictionConfidence: 0.7,
  peekPotential: false,
  peekPortalCount: 0,
  verticalSeparation: 16,
  topologyConfidence: 1,
  ...overrides
})

const portalControlEngine = new AutoDirectorEngine()
const portalControlTopology = new Map<string, PlayerTopologyFeatures>([
  ['shortCt', routeTopologyFeature('shortCt')],
  [
    'bAnchor',
    routeTopologyFeature('bAnchor', {
      areaId: 2200,
      routePortalId: 'b:entry',
      portalControlScore: 0.93,
      defensiveAngleScore: 0.91,
      predictedFightMs: 2200,
      fightPredictionConfidence: 0.79
    })
  ]
])
const portalControlFirst = portalControlEngine.evaluate(
  routePayload,
  settings,
  1_000,
  undefined,
  routeGeometry,
  portalControlTopology
)
portalControlEngine.confirmSwitch('shortCt', 1_000)
const portalControlDecision = portalControlEngine.evaluate(
  routePayload,
  settings,
  4_000,
  undefined,
  routeGeometry,
  portalControlTopology
)
const shortPortalScore = portalControlDecision.scores.find((score) => score.steamId === 'shortCt')!
const bPortalScore = portalControlDecision.scores.find((score) => score.steamId === 'bAnchor')!
assert.equal(
  shortPortalScore.factors.some((factor) => factor.key === 'routeEntry'),
  false
)
assert.equal(
  shortPortalScore.factors.some((factor) => factor.key === 'incomingGroupPressure'),
  false
)
assert.ok(shortPortalScore.factors.some((factor) => factor.key === 'isolationPenalty'))
assert.ok(bPortalScore.factors.some((factor) => factor.key === 'routeEntry'))
assert.equal(portalControlDecision.candidateSteamId, 'bAnchor')
assert.equal(portalControlDecision.shouldSwitch, true)
void portalControlFirst

const remoteUtilityEngine = new AutoDirectorEngine()
const remoteUtilityPayload = snapshot({
  allplayers: {
    lux: player('lux', 'CT', 1, '0, 0, 0', '1, 0, 0', {
      weapon: { name: 'weapon_smokegrenade', type: 'Grenade', ammo_clip: 1 }
    }),
    fightAnchor: player('Fight anchor', 'CT', 2, '1200, 0, 0', '1, 0, 0'),
    ...routeTargets.reduce(
      (players, steamId, index) => ({
        ...players,
        [steamId]: player(
          `Fight target ${index + 1}`,
          'T',
          6 + index,
          `1900, ${index * 180 - 360}, 0`,
          '-1, 0, 0'
        )
      }),
      {}
    )
  }
})
const remoteUtilityGeometry = new Map<string, PlayerGeometryFeatures>([
  ['lux', geometryFeature('lux', { forwardEnemyCount: 5, forwardEnemySteamIds: routeTargets })],
  [
    'fightAnchor',
    geometryFeature('fightAnchor', {
      visibleEnemyCount: 2,
      nearestVisibleEnemySteamId: 'routeT1',
      nearestVisibleEnemyDistance: 700,
      nearestEnemyHasLineOfSight: true,
      visibleEnemySteamIds: ['routeT1', 'routeT2'],
      forwardEnemyCount: 5,
      forwardEnemySteamIds: routeTargets,
      forwardEnemyAlignment: 1,
      bestVisibleAimAlignment: 1
    })
  ],
  ...routeTargets.map((steamId) => [steamId, geometryFeature(steamId)] as const)
])
const remoteUtilityTopology = new Map<string, PlayerTopologyFeatures>([
  [
    'lux',
    routeTopologyFeature('lux', {
      areaId: 2024,
      routePortalId: 'a:entry',
      portalControlScore: 0.93,
      routeEntryRelevance: 0.65,
      incomingRoutePressure: 1,
      predictedFightMs: 700,
      fightPredictionConfidence: 0.78
    })
  ],
  [
    'fightAnchor',
    routeTopologyFeature('fightAnchor', {
      areaId: 2200,
      routePortalId: 'b:entry',
      portalControlScore: 0.93,
      predictedFightMs: 500,
      fightPredictionConfidence: 0.8
    })
  ]
])
remoteUtilityEngine.confirmSwitch('lux', 1_000)
const remoteUtilityDecision = remoteUtilityEngine.evaluate(
  remoteUtilityPayload,
  settings,
  4_000,
  undefined,
  remoteUtilityGeometry,
  remoteUtilityTopology
)
const remoteLuxScore = remoteUtilityDecision.scores.find((score) => score.steamId === 'lux')!
assert.equal(remoteLuxScore.isolatedNoAction, true)
assert.equal(remoteLuxScore.incomingGroupPressure, 0)
assert.equal(
  remoteLuxScore.factors.some((factor) => factor.key === 'grenade'),
  false
)
assert.equal(
  remoteLuxScore.factors.some((factor) => factor.key === 'routeEntry'),
  false
)
assert.equal(
  remoteLuxScore.factors.some((factor) => factor.key === 'portalControl'),
  false
)
assert.equal(
  remoteLuxScore.factors.some((factor) => factor.key === 'fightPrediction'),
  false
)
assert.equal(
  remoteLuxScore.factors.some((factor) => factor.key === 'crossfire'),
  false
)
assert.notEqual(remoteUtilityDecision.candidateSteamId, 'lux')
assert.equal(remoteUtilityDecision.candidateSteamId, 'fightAnchor')

const remoteNoTopologyEngine = new AutoDirectorEngine()
remoteNoTopologyEngine.evaluate(
  remoteUtilityPayload,
  settings,
  1_000,
  undefined,
  remoteUtilityGeometry
)
const remoteUtilityMovedPayload = structuredClone(remoteUtilityPayload)
for (const [index, steamId] of routeTargets.entries()) {
  const target = remoteUtilityMovedPayload.allplayers?.[steamId]
  if (target) target.position = `1800, ${index * 180 - 360}, 0`
}
const remoteNoTopologyDecision = remoteNoTopologyEngine.evaluate(
  remoteUtilityMovedPayload,
  settings,
  1_125,
  undefined,
  remoteUtilityGeometry
)
const remoteNoTopologyLuxScore = remoteNoTopologyDecision.scores.find(
  (score) => score.steamId === 'lux'
)!
assert.equal(remoteNoTopologyLuxScore.isolatedNoAction, true)
assert.equal(remoteNoTopologyLuxScore.incomingGroupPressure, 0)
assert.equal(
  remoteNoTopologyLuxScore.factors.some(
    (factor) => factor.key === 'incomingGroupPressure' || factor.key === 'routeEntry'
  ),
  false
)
assert.notEqual(remoteNoTopologyDecision.candidateSteamId, 'lux')

const externalNoActionEngine = new AutoDirectorEngine()
const externalNoActionInitialPayload = structuredClone(remoteUtilityPayload)
externalNoActionInitialPayload.allplayers!.localWallEnemy = player(
  'Local wall enemy',
  'T',
  5,
  '0, 800, 0',
  '-1, 0, 0'
)
const externalNoActionMovedPayload = structuredClone(externalNoActionInitialPayload)
for (const [index, steamId] of routeTargets.entries()) {
  const target = externalNoActionMovedPayload.allplayers?.[steamId]
  if (target) target.position = `1800, ${index * 180 - 360}, 0`
}
const externalNoActionGeometry = new Map(remoteUtilityGeometry)
externalNoActionGeometry.set('localWallEnemy', geometryFeature('localWallEnemy'))
externalNoActionEngine.evaluate(
  externalNoActionInitialPayload,
  settings,
  1_000,
  undefined,
  externalNoActionGeometry
)
const externalNoActionDecision = externalNoActionEngine.evaluate(
  externalNoActionMovedPayload,
  settings,
  1_125,
  undefined,
  externalNoActionGeometry
)
const externalNoActionLuxScore = externalNoActionDecision.scores.find(
  (score) => score.steamId === 'lux'
)!
assert.equal(externalNoActionLuxScore.isolatedNoAction, true)
assert.equal(externalNoActionLuxScore.incomingGroupPressure, 0)
assert.equal(externalNoActionLuxScore.routeEntryRelevance, 0)
assert.notEqual(externalNoActionDecision.candidateSteamId, 'lux')

const staleCombatEngine = new AutoDirectorEngine()
staleCombatEngine.confirmSwitch('lux', 0)
staleCombatEngine.evaluate(remoteUtilityPayload, settings, 6_000, undefined, remoteUtilityGeometry)
const staleCombatPayload = structuredClone(remoteUtilityMovedPayload)
staleCombatPayload.allplayers!.lux.state.health = 70
staleCombatPayload.allplayers!.lux.state.round_totaldmg = 30
const staleCombatDecision = staleCombatEngine.evaluate(
  staleCombatPayload,
  settings,
  6_125,
  undefined,
  remoteUtilityGeometry
)
const staleCombatLuxScore = staleCombatDecision.scores.find((score) => score.steamId === 'lux')!
assert.equal(staleCombatLuxScore.isolatedNoAction, true)
assert.ok(staleCombatLuxScore.factors.some((factor) => factor.key === 'combat'))
assert.equal(staleCombatDecision.currentName, 'lux')
assert.equal(staleCombatDecision.shouldSwitch, true)
assert.notEqual(staleCombatDecision.lockKind, 'combat')
assert.notEqual(staleCombatDecision.candidateSteamId, 'lux')

console.log(
  'Auto-director fixture passed: ranking, scene relevance, route-entry transition, occlusion gating, incoming group pressure, locks and fallback'
)
