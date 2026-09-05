import type {
  DirectorPlayer,
  GsiLikePayload,
  PlayerScore,
  ScoreFactorKey
} from '../autoDirector.types'

export const HLAE_MIDROUND_CALM_MS = 5000

const HARD_ACTION_FACTORS = new Set<ScoreFactorKey>([
  'objective',
  'combat',
  'damage',
  'recentKill',
  'retake',
  'grenade'
])

const PREDICTIVE_ACTION_FACTORS = new Set<ScoreFactorKey>([
  'entry',
  'routeEntry',
  'contactImminence',
  'incomingGroupPressure',
  'fightPrediction'
])

export interface HlaeRawAction {
  detected: boolean
  reasons: string[]
}

export interface HlaeSafetyState {
  allowed: boolean
  actionBlocked: boolean
  calmForMs: number
  reason: string
}

const finite = (value: number | null): boolean => value !== null && Number.isFinite(value)

export const hasHlaeAction = (scores: PlayerScore[]): boolean =>
  scores.some((score) =>
    score.factors.some(
      (factor) =>
        (HARD_ACTION_FACTORS.has(factor.key) && factor.value > 0) ||
        (PREDICTIVE_ACTION_FACTORS.has(factor.key) && factor.value >= 3)
    )
  )

export const detectHlaeRawAction = (
  players: DirectorPlayer[],
  previousPlayers: ReadonlyMap<string, DirectorPlayer>,
  payload: GsiLikePayload,
  previousBombState: string | null
): HlaeRawAction => {
  const reasons = new Set<string>()
  for (const player of players) {
    const previous = previousPlayers.get(player.steamId)
    if (!previous) continue
    if (previous.alive && !player.alive) reasons.add('player death')
    if (player.alive && previous.health > player.health) reasons.add('damage')
    if (player.roundDamage > previous.roundDamage) reasons.add('damage')
    if (player.kills > previous.kills || player.roundKills > previous.roundKills) {
      reasons.add('kill')
    }
    if (
      player.ammoClip !== null &&
      previous.ammoClip !== null &&
      player.weapon === previous.weapon &&
      player.ammoClip < previous.ammoClip
    ) {
      reasons.add('shot')
    }
  }

  const bombState = String(payload.bomb?.state ?? '').toLowerCase()
  if (bombState === 'planting' || bombState === 'defusing') reasons.add(bombState)
  if (
    previousBombState !== null &&
    bombState !== previousBombState &&
    ['planted', 'defused', 'exploded'].includes(bombState)
  ) {
    reasons.add(`bomb ${bombState}`)
  }

  return { detected: reasons.size > 0, reasons: [...reasons] }
}

export const getHlaeSafety = ({
  phase,
  now,
  roundLiveStartedAt,
  lastActionAt,
  scores,
  rawActionDetected,
  povLockActive
}: {
  phase: 'freeze-time' | 'post-round' | 'quiet-live' | 'post-plant' | null
  now: number
  roundLiveStartedAt: number
  lastActionAt: number
  scores: PlayerScore[]
  rawActionDetected: boolean
  povLockActive: boolean
}): HlaeSafetyState => {
  if (phase === 'post-plant') {
    return {
      allowed: false,
      actionBlocked: true,
      calmForMs: 0,
      reason: 'Post-plant is reserved for player POV'
    }
  }
  if (phase !== 'quiet-live') {
    return { allowed: true, actionBlocked: false, calmForMs: 0, reason: 'Phase-specific cinematic' }
  }
  const actionBlocked = rawActionDetected || hasHlaeAction(scores)
  const calmForMs = roundLiveStartedAt > 0 ? now - Math.max(roundLiveStartedAt, lastActionAt) : 0
  if (povLockActive) {
    return { allowed: false, actionBlocked: true, calmForMs, reason: 'Player POV has priority' }
  }
  if (actionBlocked) {
    return { allowed: false, actionBlocked: true, calmForMs, reason: 'Recent action has priority' }
  }
  if (calmForMs < HLAE_MIDROUND_CALM_MS) {
    return {
      allowed: false,
      actionBlocked: false,
      calmForMs,
      reason: `Waiting for ${HLAE_MIDROUND_CALM_MS / 1000}s of calm`
    }
  }
  return { allowed: true, actionBlocked: false, calmForMs, reason: 'Confirmed calm window' }
}

export const getHlaePhaseRemainingMs = (payload: GsiLikePayload): number | null => {
  const seconds = Number(payload.phase_countdowns?.phase_ends_in)
  return finite(seconds) && seconds >= 0 ? seconds * 1000 : null
}
