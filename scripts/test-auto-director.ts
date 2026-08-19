import assert from 'node:assert/strict'
import { AutoDirectorEngine } from '../src/main/server/domains/auto-director/autoDirector.engine'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import type {
  AutoDirectorSettings,
  GsiLikePayload
} from '../src/main/server/domains/auto-director/autoDirector.types'
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
assert.equal(deathRecovery.shouldSwitch, true)
assert.equal(deathRecovery.candidateSteamId, 'ct')
engine.confirmSwitch('ct', 4_100)

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

console.log(
  'Auto-director fixture passed: sniper sightline, dwell, combat ranking, death, objective, manual and calm mode'
)
