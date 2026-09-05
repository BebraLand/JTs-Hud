import assert from 'node:assert/strict'
import {
  detectHlaeRawAction,
  getHlaeSafety,
  isHlaeFreezePathInProgress
} from '../src/main/server/domains/auto-director/hlae/presentationSafety'
import type { DirectorPlayer } from '../src/main/server/domains/auto-director/autoDirector.types'

const player = (overrides: Partial<DirectorPlayer> = {}): DirectorPlayer => ({
  steamId: '1',
  name: 'player',
  team: 'T',
  observerSlot: 1,
  health: 100,
  armor: 100,
  alive: true,
  flashed: 0,
  position: [0, 0, 0],
  forward: [1, 0, 0],
  weapon: 'ak47',
  weaponType: 'Rifle',
  ammoClip: 30,
  kills: 0,
  roundKills: 0,
  roundDamage: 0,
  hasBomb: false,
  ...overrides
})

const current = player({ health: 90, roundDamage: 10 })
const previous = player()
const rawAction = detectHlaeRawAction(
  [current],
  new Map([[previous.steamId, previous]]),
  { bomb: { state: 'none' } },
  'none'
)
assert.equal(rawAction.detected, true)
assert.deepEqual(rawAction.reasons.sort(), ['damage'])

const quiet = getHlaeSafety({
  phase: 'quiet-live',
  now: 10_000,
  roundLiveStartedAt: 1,
  lastActionAt: 9_500,
  scores: [],
  rawActionDetected: true,
  povLockActive: false
})
assert.equal(quiet.allowed, false)
assert.equal(quiet.actionBlocked, true)

const postPlant = getHlaeSafety({
  phase: 'post-plant',
  now: 20_000,
  roundLiveStartedAt: 1,
  lastActionAt: 1,
  scores: [],
  rawActionDetected: false,
  povLockActive: false
})
assert.equal(postPlant.allowed, false)
assert.equal(isHlaeFreezePathInProgress('freeze-time', 'quiet-live', 5_000, 8_000), true)
assert.equal(isHlaeFreezePathInProgress('freeze-time', 'quiet-live', 8_000, 8_000), false)
assert.equal(isHlaeFreezePathInProgress('post-round', 'freeze-time', 5_000, 8_000), false)

console.log('HLAE safety checks passed')
