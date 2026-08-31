import assert from 'node:assert/strict'
import { planBroadcastStory } from '../src/main/server/domains/auto-director/autoDirector.story'
import type { PlayerScore } from '../src/main/server/domains/auto-director/autoDirector.types'

const score = (steamId: string, overrides: Partial<PlayerScore> = {}): PlayerScore => ({
  steamId,
  name: steamId,
  team: steamId === 'entry' ? 'T' : 'CT',
  observerSlot: 1,
  alive: true,
  total: 50,
  factors: [],
  nearestEnemyDistance: 600,
  sceneKey: 'mid',
  sceneMemberCount: 5,
  opposingSceneMemberCount: 2,
  scenePhase: 'approaching',
  sceneConfidence: 0.9,
  contactImminence: 0.5,
  incomingGroupPressure: 0.6,
  routeEntryRelevance: 0.7,
  routeEntryTargetCount: 3,
  povQuality: 0.8,
  threatSceneTargetCount: 2,
  threatSceneCoverage: 0.8,
  topologyCrossfirePotential: 0.4,
  topologyFightPredictionConfidence: 0.7,
  isolatedNoAction: false,
  switchEligible: true,
  ...overrides
})

const plan = planBroadcastStory(
  [score('entry'), score('support', { total: 35, routeEntryRelevance: 0.2 })],
  {
    key: 'mid',
    members: [],
    center: null,
    radius: 0,
    score: 30,
    opposingTeamCount: 1,
    teamCount: 2,
    hasOpposition: true,
    phase: 'approaching',
    confidence: 0.9,
    movementMagnitude: 0.5,
    approachPressure: 0.6
  }
)

assert.ok(plan)
assert.equal(plan.targetSteamId, 'entry')
assert.equal(plan.phase, 'pre-peek')
assert.ok(plan.earlyEventProbability >= 0.3)
assert.ok(plan.confidence >= 0.7)
assert.equal(plan.fallbackSteamId, 'support')
console.log('Broadcast story planner fixture passed')
