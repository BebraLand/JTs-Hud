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
  presentationAngles: AerialCameraAnchor['angles'] | null
  visibleSteamIds: string[]
  visibleCtCount: number
  visibleTCount: number
  actionBlocked: boolean
}

export interface AerialPresentationOptions {
  excludedAnchorIds?: ReadonlySet<string>
}

const ACTION_FACTOR_KEYS = new Set(['combat', 'damage', 'recentKill', 'objective'])

const emptyDecision = (reason: string, actionBlocked = false): AerialPresentationDecision => ({
  eligible: false,
  reason,
  phase: null,
  anchor: null,
  presentationAngles: null,
  visibleSteamIds: [],
  visibleCtCount: 0,
  visibleTCount: 0,
  actionBlocked
})

export const getAerialPresentationPhase = (
  payload: GsiLikePayload
): AerialPresentationPhase | null => {
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
  if (phase === 'freeze-time') return anchor.kind === 'spawn' ? 60 : 0
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

const spawnTeamForAnchor = (anchor: AerialCameraAnchor): 'CT' | 'T' | null =>
  anchor.kind !== 'spawn'
    ? null
    : anchor.id.startsWith('ct_')
      ? 'CT'
      : anchor.id.startsWith('t_')
        ? 'T'
        : null

const phaseEnabled = (
  phase: AerialPresentationPhase,
  settings: AutoDirectorSettings
): boolean => {
  const phases = settings.aerialPresentationPhases
  if (phase === 'freeze-time') return phases.freezeTime
  if (phase === 'post-round') return phases.roundEnd
  return phases.midRound
}

const teamFramingAngles = (
  anchor: AerialCameraAnchor,
  team: 'CT' | 'T',
  players: DirectorPlayer[]
): AerialCameraAnchor['angles'] => {
  const teamPlayers = players.filter((player) => player.team === team && player.position)
  if (!teamPlayers.length) return anchor.angles
  const target: [number, number, number] = [
    teamPlayers.reduce((sum, player) => sum + player.position![0], 0) / teamPlayers.length,
    teamPlayers.reduce((sum, player) => sum + player.position![1], 0) / teamPlayers.length,
    teamPlayers.reduce((sum, player) => sum + player.position![2], 0) / teamPlayers.length + 48
  ]
  const delta: [number, number, number] = [
    target[0] - anchor.position[0],
    target[1] - anchor.position[1],
    target[2] - anchor.position[2]
  ]
  const horizontalDistance = Math.hypot(delta[0], delta[1])
  if (horizontalDistance <= 1e-6) return anchor.angles
  return [
    (-Math.atan2(delta[2], horizontalDistance) * 180) / Math.PI,
    (Math.atan2(delta[1], delta[0]) * 180) / Math.PI,
    0
  ]
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
  geometry: GeometryMap | null,
  options: AerialPresentationOptions = {}
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

  const phase = getAerialPresentationPhase(payload)
  if (!phase) return emptyDecision('Round phase is not presentation-safe')
  if (!phaseEnabled(phase, settings)) {
    return emptyDecision(`Aerial presentation disabled for ${phase}`)
  }
  const actionBlocked = directorDecision.scores.some((score) =>
    score.factors.some((factor) => ACTION_FACTOR_KEYS.has(factor.key))
  )
  if (actionBlocked)
    return emptyDecision('Immediate combat, kill, damage or objective action has priority', true)

  const alivePlayers = players.filter((player) => player.alive && player.position)
  const playersById = new Map(alivePlayers.map((player) => [player.steamId, player]))
  let selected: {
    anchor: AerialCameraAnchor
    presentationAngles: AerialCameraAnchor['angles']
    visibility: { steamIds: string[]; ct: number; t: number }
    score: number
  } | null = null

  // Freeze-time is a broadcast package, not a geometry competition: every
  // round must present both calibrated spawns in a deterministic T -> CT
  // sequence. Static LOS can be conservative around spawn walls and must not
  // make one side disappear from the show.
  const completedSpawnIds = options.excludedAnchorIds ?? new Set<string>()
  const requiredSpawnTeam =
    phase === 'freeze-time'
      ? completedSpawnIds.has('t_spawn')
        ? completedSpawnIds.has('ct_spawn')
          ? null
          : 'CT'
        : 'T'
      : null

  for (const anchor of map.anchors) {
    if (options.excludedAnchorIds?.has(anchor.id)) continue
    const affinity = anchorAffinity(anchor, phase)
    if (affinity <= 0) continue
    const spawnTeam = phase === 'freeze-time' ? spawnTeamForAnchor(anchor) : null
    if (phase === 'freeze-time' && spawnTeam !== requiredSpawnTeam) continue
    const presentationAngles = spawnTeam
      ? teamFramingAngles(anchor, spawnTeam, alivePlayers)
      : anchor.angles
    const visibility = visibleCounts(
      computeCameraVisibility(
        { position: anchor.position, angles: presentationAngles },
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
        ? spawnTeam !== null
        : phase === 'post-round'
          ? totalVisible >= 2
          : phase === 'post-plant'
            ? totalVisible >= 2 && crossTeam
            : totalVisible >= 3 && crossTeam
    if (!eligible) continue
    const freezeOrderBonus = phase === 'freeze-time' ? 1000 : 0
    const score = affinity + totalVisible * 8 + (crossTeam ? 12 : 0) + freezeOrderBonus
    if (
      !selected ||
      score > selected.score ||
      (score === selected.score && anchor.id < selected.anchor.id)
    ) {
      selected = { anchor, presentationAngles, visibility, score }
    }
  }

  if (!selected) {
    return emptyDecision(
      phase === 'freeze-time'
        ? 'No calibrated freeze-time spawn anchor is available'
        : `No ${phase} anchor has enough geometry-visible living players`
    )
  }
  const totalVisible = selected.visibility.steamIds.length
  const selectedSpawnSide =
    selected.anchor.kind === 'spawn'
      ? selected.anchor.id.startsWith('ct_')
        ? 'CT'
        : selected.anchor.id.startsWith('t_')
          ? 'T'
          : null
      : null
  const spawnVisibilityNote = selectedSpawnSide
    ? `; ${selectedSpawnSide} spawn shot, opposite-team visibility is not required`
    : ''
  return {
    eligible: true,
    phase,
    anchor: selected.anchor,
    presentationAngles: selected.presentationAngles,
    visibleSteamIds: selected.visibility.steamIds,
    visibleCtCount: selected.visibility.ct,
    visibleTCount: selected.visibility.t,
    actionBlocked: false,
    reason: `${phase}: ${selected.anchor.label}; ${totalVisible} geometry-visible (${selected.visibility.ct} CT, ${selected.visibility.t} T)${spawnVisibilityNote}`
  }
}
