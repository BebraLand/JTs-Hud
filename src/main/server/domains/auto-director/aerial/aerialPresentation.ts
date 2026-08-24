import type {
  AutoDirectorDecision,
  AutoDirectorSettings,
  DirectorPlayer,
  GsiLikePayload
} from '../autoDirector.types'
import { computeCameraVisibility, type CameraVisibilityResult } from '../geometry/cameraVisibility'
import type { GeometryMap } from '../geometry/geometryMap'
import type { AerialCameraAnchor, AerialCameraMap } from './aerialCameraRegistry'

export type AerialPresentationPhase = 'freeze-time' | 'post-round' | 'quiet-live' | 'post-plant'

export interface AerialPresentationDecision {
  eligible: boolean
  reason: string
  phase: AerialPresentationPhase | null
  anchor: AerialCameraAnchor | null
  visibleSteamIds: string[]
  visibleCtCount: number
  visibleTCount: number
  actionBlocked: boolean
}

const ACTION_FACTOR_KEYS = new Set(['combat', 'damage', 'recentKill', 'objective'])

const emptyDecision = (reason: string, actionBlocked = false): AerialPresentationDecision => ({
  eligible: false,
  reason,
  phase: null,
  anchor: null,
  visibleSteamIds: [],
  visibleCtCount: 0,
  visibleTCount: 0,
  actionBlocked
})

const phaseForPayload = (payload: GsiLikePayload): AerialPresentationPhase | null => {
  const roundPhase = String(
    payload.round?.phase ?? payload.phase_countdowns?.phase ?? ''
  ).toLowerCase()
  const mapPhase = String(payload.map?.phase ?? '').toLowerCase()
  const bombState = String(payload.bomb?.state ?? '').toLowerCase()
  if (roundPhase === 'freezetime' || roundPhase === 'freeze' || mapPhase === 'warmup') {
    return 'freeze-time'
  }
  if (roundPhase === 'over' || roundPhase === 'intermission' || mapPhase === 'gameover') {
    return 'post-round'
  }
  if (bombState === 'planted') return 'post-plant'
  if (roundPhase === 'live' && mapPhase === 'live') return 'quiet-live'
  return null
}

const anchorAffinity = (anchor: AerialCameraAnchor, phase: AerialPresentationPhase): number => {
  if (phase === 'freeze-time') return anchor.kind === 'spawn' ? 60 : anchor.kind === 'mid' ? 20 : 0
  if (phase === 'post-plant')
    return anchor.kind === 'postplant' ? 60 : anchor.kind === 'site' ? 45 : 0
  if (phase === 'quiet-live') {
    return anchor.kind === 'mid'
      ? 38
      : anchor.kind === 'route'
        ? 32
        : anchor.kind === 'site'
          ? 18
          : 0
  }
  return anchor.kind === 'site' ? 24 : anchor.kind === 'mid' ? 20 : anchor.kind === 'route' ? 12 : 0
}

const visibleCounts = (
  visibility: Map<string, CameraVisibilityResult>,
  playersById: Map<string, DirectorPlayer>
): { steamIds: string[]; ct: number; t: number } => {
  const steamIds: string[] = []
  let ct = 0
  let t = 0
  for (const [steamId, entry] of visibility) {
    if (!entry.visible) continue
    steamIds.push(steamId)
    if (playersById.get(steamId)?.team === 'CT') ct += 1
    if (playersById.get(steamId)?.team === 'T') t += 1
  }
  return { steamIds: steamIds.sort(), ct, t }
}

/**
 * Selects a stable calibrated shot only when it tells a clearer story than a
 * player POV. It never overrides a player switch, an objective/combat lock, or
 * a manual operator decision; the service owns timing/cooldown and transport.
 */
export const decideAerialPresentation = (
  payload: GsiLikePayload,
  settings: AutoDirectorSettings,
  players: DirectorPlayer[],
  directorDecision: AutoDirectorDecision,
  map: AerialCameraMap | null,
  geometry: GeometryMap | null
): AerialPresentationDecision => {
  if (!settings.aerialPresentationEnabled) return emptyDecision('Aerial presentation disabled')
  if (!settings.enabled || settings.paused) return emptyDecision('Director is disabled or paused')
  if (settings.manualOverrideSteamId) return emptyDecision('Manual observer override is active')
  if (!map) return emptyDecision('No calibrated Aerial anchors for this map')
  if (!geometry) return emptyDecision('Geometry is unavailable for Aerial visibility')
  const bombState = String(payload.bomb?.state ?? '').toLowerCase()
  if (bombState.includes('planting') || bombState.includes('defus')) {
    return emptyDecision('Active plant or defuse has priority over Aerial presentation', true)
  }
  if (directorDecision.shouldSwitch) return emptyDecision('First-person switch has priority')
  if (directorDecision.lockKind !== 'none') {
    return emptyDecision(`First-person ${directorDecision.lockKind} lock has priority`, true)
  }

  const phase = phaseForPayload(payload)
  if (!phase) return emptyDecision('Round phase is not presentation-safe')
  const actionBlocked = directorDecision.scores.some((score) =>
    score.factors.some((factor) => ACTION_FACTOR_KEYS.has(factor.key))
  )
  if (actionBlocked)
    return emptyDecision('Immediate combat, kill, damage or objective action has priority', true)

  const alivePlayers = players.filter((player) => player.alive && player.position)
  const playersById = new Map(alivePlayers.map((player) => [player.steamId, player]))
  let selected: {
    anchor: AerialCameraAnchor
    visibility: { steamIds: string[]; ct: number; t: number }
    score: number
  } | null = null

  for (const anchor of map.anchors) {
    const affinity = anchorAffinity(anchor, phase)
    if (affinity <= 0) continue
    const visibility = visibleCounts(
      computeCameraVisibility(
        { position: anchor.position, angles: anchor.angles },
        alivePlayers.map((player) => ({
          steamId: player.steamId,
          position: player.position,
          alive: player.alive
        })),
        geometry
      ),
      playersById
    )
    const totalVisible = visibility.steamIds.length
    const crossTeam = visibility.ct > 0 && visibility.t > 0
    const eligible =
      phase === 'freeze-time'
        ? totalVisible >= 3
        : phase === 'post-round'
          ? totalVisible >= 2
          : phase === 'post-plant'
            ? totalVisible >= 2 && crossTeam
            : totalVisible >= 3 && crossTeam
    if (!eligible) continue
    const score = affinity + totalVisible * 8 + (crossTeam ? 12 : 0)
    if (
      !selected ||
      score > selected.score ||
      (score === selected.score && anchor.id < selected.anchor.id)
    ) {
      selected = { anchor, visibility, score }
    }
  }

  if (!selected) {
    return emptyDecision(`No ${phase} anchor has enough geometry-visible living players`)
  }
  const totalVisible = selected.visibility.steamIds.length
  return {
    eligible: true,
    phase,
    anchor: selected.anchor,
    visibleSteamIds: selected.visibility.steamIds,
    visibleCtCount: selected.visibility.ct,
    visibleTCount: selected.visibility.t,
    actionBlocked: false,
    reason: `${phase}: ${selected.anchor.label}; ${totalVisible} geometry-visible (${selected.visibility.ct} CT, ${selected.visibility.t} T)`
  }
}
