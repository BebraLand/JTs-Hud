import type { PlayerScore } from './autoDirector.types'
import type { SceneSummary } from './autoDirector.scene'

export type BroadcastStoryPhase =
  | 'setup'
  | 'approach'
  | 'pre-peek'
  | 'committed-fight'
  | 'trade-window'
  | 'retreat-rotate'
  | 'post-plant-clutch'

export interface BroadcastStoryPlan {
  key: string
  targetSteamId: string
  fallbackSteamId: string | null
  phase: BroadcastStoryPhase
  earlyEventProbability: number
  tradeProbability: number
  povQuality: number
  utility: number
  confidence: number
  reserveMs: number
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value))

const phaseFor = (score: PlayerScore): BroadcastStoryPhase => {
  if (score.scenePhase === 'objective') return 'post-plant-clutch'
  if (score.scenePhase === 'contact' || (score.contactImminence ?? 0) >= 0.7) {
    return (score.threatSceneTargetCount ?? 0) >= 2 ? 'trade-window' : 'committed-fight'
  }
  if (
    score.scenePhase === 'approaching' &&
    ((score.routeEntryRelevance ?? 0) >= 0.25 || (score.topologyPeekPotential ?? false))
  ) {
    return 'pre-peek'
  }
  if (score.scenePhase === 'approaching') return 'approach'
  if ((score.routeEntryRelevance ?? 0) >= 0.25) return 'retreat-rotate'
  return 'setup'
}

/**
 * Selects a future broadcast story from evidence already computed by the engine.
 * ponytail: deterministic heuristic; replace with calibrated sequence model only
 * after a held-out uplift is demonstrated.
 */
export const planBroadcastStory = (
  scores: readonly PlayerScore[],
  trackedScene: SceneSummary | null
): BroadcastStoryPlan | null => {
  if (!trackedScene?.hasOpposition) return null
  const eligible = scores.filter(
    (score) =>
      score.alive &&
      score.switchEligible &&
      score.sceneKey === trackedScene.key &&
      !score.isolatedNoAction
  )
  if (!eligible.length) return null
  const ranked = eligible
    .map((score) => {
      const earlyEventProbability = clamp(
        (score.contactImminence ?? 0) * 0.32 +
          (score.incomingGroupPressure ?? 0) * 0.24 +
          (score.routeEntryRelevance ?? 0) * 0.18 +
          (score.topologyFightPredictionConfidence ?? 0) * 0.14 +
          (score.sceneConfidence ?? 0) * 0.12
      )
      const tradeProbability = clamp(
        Math.min(1, Math.max(0, ((score.threatSceneTargetCount ?? 0) - 1) / 4)) *
          (score.threatSceneCoverage ?? 0) *
          0.65 +
          (score.topologyCrossfirePotential ?? 0) * 0.35
      )
      const povQuality = clamp(score.povQuality ?? 0)
      const phase = phaseFor(score)
      const utility =
        earlyEventProbability * 70 +
        povQuality * 15 +
        tradeProbability * 10 +
        clamp(score.sceneConfidence ?? 0) * 5
      return { score, earlyEventProbability, tradeProbability, povQuality, phase, utility }
    })
    .sort((left, right) => right.utility - left.utility)
  const best = ranked[0]
  if (!best || best.earlyEventProbability < 0.3 || best.utility < 24) return null
  const fallback = ranked.find((entry) => entry.score.team !== best.score.team) ?? ranked[1]
  return {
    key: `${trackedScene.key}:${best.score.steamId}`,
    targetSteamId: best.score.steamId,
    fallbackSteamId: fallback?.score.steamId ?? null,
    phase: best.phase,
    earlyEventProbability: Math.round(best.earlyEventProbability * 1000) / 1000,
    tradeProbability: Math.round(best.tradeProbability * 1000) / 1000,
    povQuality: Math.round(best.povQuality * 1000) / 1000,
    utility: Math.round(best.utility * 10) / 10,
    confidence: Math.round(
      clamp(best.earlyEventProbability * 0.65 + (best.score.sceneConfidence ?? 0) * 0.35) * 1000
    ) / 1000,
    reserveMs: best.phase === 'pre-peek' || best.phase === 'approach' ? 1400 : 900
  }
}
