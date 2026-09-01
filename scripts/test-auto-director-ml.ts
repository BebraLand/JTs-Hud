import assert from 'node:assert/strict'
import path from 'node:path'
import {
  AutoDirectorEngine,
  normalizePlayers
} from '../src/main/server/domains/auto-director/autoDirector.engine'
import type { ScoreAdvisory } from '../src/main/server/domains/auto-director/autoDirector.engine'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import {
  autoDirectorMlAdvisory,
  LightGbmRanker,
  loadLightGbmRanker
} from '../src/main/server/domains/auto-director/autoDirector.ml'
import {
  AUTO_DIRECTOR_ML_FEATURES,
  buildAutoDirectorMlFeatures
} from '../src/main/server/domains/auto-director/autoDirector.mlFeatures'
import { AutoDirectorTemporalTracker } from '../src/main/server/domains/auto-director/autoDirector.temporal'
import type { GsiLikePayload } from '../src/main/server/domains/auto-director/autoDirector.types'

const modelPath = path.resolve('resources/auto-director/models/auto-director-lightgbm.json')
const ranker = loadLightGbmRanker(modelPath)
assert.equal(ranker.featureNames.length, 46)

const player = (name: string, team: 'CT' | 'T', slot: number, position: string) => ({
  name,
  team,
  observer_slot: slot,
  position,
  forward: team === 'CT' ? '1, 0, 0' : '-1, 0, 0',
  state: { health: 100, armor: 100, flashed: 0, round_kills: 0, round_totaldmg: 0 },
  match_stats: { kills: 0 },
  weapons: {
    weapon_0: { name: 'weapon_ak47', type: 'Rifle', state: 'active', ammo_clip: 30 }
  }
})

const payload: GsiLikePayload = {
  map: { name: 'de_mirage', round: 4, phase: 'live' },
  round: { phase: 'live' },
  allplayers: {
    ct: player('Anchor', 'CT', 1, '0, 0, 0'),
    t: player('Entry', 'T', 6, '1000, 0, 0')
  }
}
const settings = { ...DEFAULT_AUTO_DIRECTOR_SETTINGS, enabled: true }
const engine = new AutoDirectorEngine()
const players = normalizePlayers(payload)
const decision = engine.evaluate(payload, settings, 10_000)
const candidate = decision.scores.find((score) => score.steamId === 'ct')!
const candidatePlayer = players.find((item) => item.steamId === candidate.steamId)!
const allFeatures = buildAutoDirectorMlFeatures(
  candidatePlayer,
  candidate,
  players,
  1_000,
  null,
  false
)
assert.equal(allFeatures[AUTO_DIRECTOR_ML_FEATURES.indexOf('weapon_rifle')], 1)
const advisoryValue = ranker.predict(
  buildAutoDirectorMlFeatures(
    candidatePlayer,
    candidate,
    players,
    1_000,
    null,
    false,
    null,
    ranker.featureNames
  )
)
assert.ok(Number.isFinite(advisoryValue))

const temporal = new AutoDirectorTemporalTracker()
temporal.update(players, 1_000)
const movedPlayers = players.map((item) =>
  item.steamId === 'ct' ? { ...item, position: [100, 0, 0] as [number, number, number] } : item
)
const movement = temporal.update(movedPlayers, 1_500).get('ct')!
assert.equal(Math.round(movement.speed500), 200)
assert.equal(movement.historyMs, 500)

const predictive = new LightGbmRanker({
  schemaVersion: 2,
  kind: 'lightgbm-multihorizon-binary',
  featureNames: ['signal'],
  models: [500, 1_000, 2_000, 3_000].map((horizonMs) => ({
    horizonMs,
    model: { tree_info: [{ tree_structure: { leaf_value: 2.197224577 } }] }
  }))
})
const predictiveAdvisoryResult = autoDirectorMlAdvisory(predictive, [1])
assert.ok(predictiveAdvisoryResult.value > 15)
assert.match(predictiveAdvisoryResult.detail, /0\.5s 90%/)

const advised = new AutoDirectorEngine().evaluate(payload, settings, 10_000, (item, score, all) => [
  {
    key: 'mlAdvisory' as const,
    value:
      Math.tanh(
        ranker.predict(
          buildAutoDirectorMlFeatures(
            item,
            score,
            all,
            1_000,
            null,
            false,
            null,
            ranker.featureNames
          )
        )
      ) * 8,
    detail: 'test advisory'
  }
])
assert.ok(
  advised.scores.some((score) => score.factors.some((factor) => factor.key === 'mlAdvisory'))
)

const predictiveSwitchEngine = new AutoDirectorEngine()
predictiveSwitchEngine.setCurrent('ct', 10_000)
const predictiveAdvisory: ScoreAdvisory = (item) => [
  {
    key: 'mlAdvisory',
    value: item.steamId === 't' ? 18 : 0,
    detail: 'synthetic future contact'
  }
]
predictiveSwitchEngine.evaluate(payload, settings, 11_100, predictiveAdvisory)
const predictiveSwitch = predictiveSwitchEngine.evaluate(payload, settings, 11_225, predictiveAdvisory)
assert.equal(predictiveSwitch.shouldSwitch, true)
assert.equal(predictiveSwitch.candidateSteamId, 't')
assert.match(predictiveSwitch.reason, /pre-contact prediction/)

const disabled = new AutoDirectorEngine().evaluate(
  payload,
  { ...settings, mlAdvisoryEnabled: false },
  10_000
)
assert.ok(
  disabled.scores.every((score) => !score.factors.some((factor) => factor.key === 'mlAdvisory'))
)

console.log(
  'Auto-director ML fixture passed: model loading, feature shape, advisory opt-in and safe disable'
)
