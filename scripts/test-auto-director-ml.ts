import assert from 'node:assert/strict'
import path from 'node:path'
import {
  AutoDirectorEngine,
  normalizePlayers
} from '../src/main/server/domains/auto-director/autoDirector.engine'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import { loadLightGbmRanker } from '../src/main/server/domains/auto-director/autoDirector.ml'
import { buildAutoDirectorMlFeatures } from '../src/main/server/domains/auto-director/autoDirector.mlFeatures'
import type { GsiLikePayload } from '../src/main/server/domains/auto-director/autoDirector.types'

const modelPath = path.resolve('resources/auto-director/models/auto-director-lightgbm.json')
const ranker = loadLightGbmRanker(modelPath)
assert.equal(ranker.featureNames.length, 44)

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
const advisoryValue = ranker.predict(
  buildAutoDirectorMlFeatures(candidatePlayer, candidate, players, 1_000, null, false)
)
assert.ok(Number.isFinite(advisoryValue))

const advised = new AutoDirectorEngine().evaluate(
  payload,
  settings,
  10_000,
  (item, score, all) => [
    {
      key: 'mlAdvisory',
      value:
        Math.tanh(ranker.predict(buildAutoDirectorMlFeatures(item, score, all, 1_000, null, false))) *
        8,
      detail: 'test advisory'
    }
  ]
)
assert.ok(
  advised.scores.some((score) => score.factors.some((factor) => factor.key === 'mlAdvisory'))
)

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
