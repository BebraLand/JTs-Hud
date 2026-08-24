import type { AerialCameraAnchor } from './aerial/aerialCameraRegistry'
import type {
  CameraDebugAnchor,
  CameraDebugPlayer,
  CameraDebugStatus,
  DirectorPlayer,
  PlayerScore
} from './autoDirector.types'
import type { PlayerGeometryFeatures } from './geometry/geometryFeatures'
import { computeCameraVisibility } from './geometry/cameraVisibility'
import type { GeometryMap } from './geometry/geometryMap'

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const finiteScore = (value: number | undefined): number =>
  Number.isFinite(value) ? Number(value) : 0

const toTuple = (value: readonly [number, number, number] | null): [number, number, number] | null =>
  value ? [value[0], value[1], value[2]] : null

const playerCameraScore = (player: PlayerScore, geometry: PlayerGeometryFeatures | null): number => {
  if (!player.alive) return 0
  const action = clamp(player.total, -50, 80)
  const visiblePressure = Math.min(18, (geometry?.visibleEnemyCount ?? 0) * 6)
  const groupPressure = Math.min(12, (geometry?.forwardEnemySteamIds.length ?? 0) * 3)
  const sceneValue = Math.min(12, finiteScore(player.sceneRelevance) * 0.12)
  const calmNarrative = player.isolatedNoAction ? -8 : player.movementMagnitude ? 4 : 0
  return Math.round(clamp(50 + action * 0.35 + visiblePressure + groupPressure + sceneValue + calmNarrative, 0, 100) * 10) / 10
}

const scoreReasons = (
  visibleCount: number,
  actionTargetCount: number,
  inFrustumCount: number,
  occludedCount: number,
  actionCoverage: number,
  geometryAvailable: boolean
): string[] => {
  if (!geometryAvailable) return ['Geometry unavailable, visibility score is not trusted']
  const reasons: string[] = []
  if (visibleCount) reasons.push(`${visibleCount} players in clear camera view`)
  if (actionTargetCount) reasons.push(`${actionTargetCount} action-relevant targets covered`)
  if (inFrustumCount > visibleCount) reasons.push(`${inFrustumCount - visibleCount} players in frustum but occluded`)
  if (occludedCount > 0 && inFrustumCount === visibleCount) reasons.push(`${occludedCount} occluded players`)
  if (actionCoverage > 0) reasons.push(`${Math.round(actionCoverage)} action coverage`)
  if (!reasons.length) reasons.push('No living players currently covered')
  return reasons
}

const anchorDebug = (
  anchor: AerialCameraAnchor,
  players: DirectorPlayer[],
  scores: Map<string, PlayerScore>,
  geometry: GeometryMap | null
): CameraDebugAnchor => {
  const alivePlayers = players.filter((player) => player.alive && player.position)
  const visibility = geometry
    ? computeCameraVisibility(anchor, players, geometry)
    : new Map()
  const inFrustumSteamIds = alivePlayers
    .filter((player) => visibility.get(player.steamId)?.inFrustum)
    .map((player) => player.steamId)
  const visibleSteamIds = alivePlayers
    .filter((player) => visibility.get(player.steamId)?.visible)
    .map((player) => player.steamId)
  const occludedSteamIds = inFrustumSteamIds.filter((steamId) => !visibleSteamIds.includes(steamId))
  const visibleSet = new Set(visibleSteamIds)
  const actionTargetCount = alivePlayers.filter(
    (player) => visibleSet.has(player.steamId) && (scores.get(player.steamId)?.total ?? 0) > 10
  ).length
  const actionCoverage = visibleSteamIds.reduce(
    (sum, steamId) => sum + clamp(scores.get(steamId)?.total ?? 0, 0, 100),
    0
  )
  const teamCount = new Set(
    alivePlayers.filter((player) => visibleSet.has(player.steamId)).map((player) => player.team)
  ).size
  const cameraScore = geometry
    ? Math.round(
        clamp(
          visibleSteamIds.length * 10 +
            actionTargetCount * 8 +
            actionCoverage * 0.22 +
            teamCount * 4 +
            inFrustumSteamIds.length * 2 -
            occludedSteamIds.length * 1.5,
          0,
          100
        ) * 10
      ) / 10
    : 0
  const reasons = scoreReasons(
    visibleSteamIds.length,
    actionTargetCount,
    inFrustumSteamIds.length,
    occludedSteamIds.length,
    actionCoverage,
    geometry !== null
  )
  return {
    id: anchor.id,
    label: anchor.label,
    kind: anchor.kind,
    position: [...anchor.position],
    angles: [...anchor.angles],
    cameraScore,
    inFrustumSteamIds,
    visibleSteamIds,
    occludedSteamIds,
    reason: reasons[0],
    reasons
  }
}

export const emptyCameraDebugStatus = (): CameraDebugStatus => ({
  mapName: null,
  updatedAt: null,
  geometryAvailable: false,
  geometryMessage: 'Waiting for GSI map data',
  players: [],
  anchors: [],
  currentPlayerSteamId: null,
  candidatePlayerSteamId: null,
  activeAnchorId: null,
  summary: 'Waiting for GSI state'
})

export const computeCameraDebugStatus = ({
  mapName,
  at,
  players,
  scores,
  geometryFeatures,
  geometry,
  anchors,
  currentPlayerSteamId,
  candidatePlayerSteamId,
  activeAnchorId,
  geometryMessage
}: {
  mapName: string | null
  at: number
  players: DirectorPlayer[]
  scores: PlayerScore[]
  geometryFeatures: Map<string, PlayerGeometryFeatures> | null
  geometry: GeometryMap | null
  anchors: AerialCameraAnchor[]
  currentPlayerSteamId: string | null
  candidatePlayerSteamId: string | null
  activeAnchorId: string | null
  geometryMessage: string
}): CameraDebugStatus => {
  const scoreById = new Map(scores.map((score) => [score.steamId, score]))
  const debugPlayers: CameraDebugPlayer[] = players
    .map((player) => {
      const score = scoreById.get(player.steamId)
      const features = geometryFeatures?.get(player.steamId) ?? null
      return {
        steamId: player.steamId,
        name: player.name,
        team: player.team,
        observerSlot: player.observerSlot,
        health: player.health,
        alive: player.alive,
        position: toTuple(player.position),
        forward: toTuple(player.forward),
        priorityScore: Math.round(finiteScore(score?.total) * 10) / 10,
        cameraScore: playerCameraScore(score ?? {
          steamId: player.steamId,
          name: player.name,
          team: player.team,
          observerSlot: player.observerSlot,
          alive: player.alive,
          total: 0,
          factors: [],
          nearestEnemyDistance: null,
          switchEligible: false
        }, features),
        visibleEnemySteamIds: features?.visibleEnemySteamIds ?? [],
        nearestEnemySteamId: features?.nearestEnemySteamId ?? null,
        nearestEnemyVisible: features?.nearestEnemyHasLineOfSight ?? false,
        peekPotentialEnemySteamIds: features?.peekPotentialEnemySteamIds ?? [],
        forwardEnemySteamIds: features?.forwardEnemySteamIds ?? []
      }
    })
    .sort((left, right) => Number(right.alive) - Number(left.alive) || right.cameraScore - left.cameraScore)
  const debugAnchors = anchors
    .map((anchor) => anchorDebug(anchor, players, scoreById, geometry))
    .sort((left, right) => right.cameraScore - left.cameraScore || left.label.localeCompare(right.label))
  const bestAnchor = debugAnchors[0]
  const visibleCount = bestAnchor?.visibleSteamIds.length ?? 0
  return {
    mapName,
    updatedAt: at,
    geometryAvailable: geometry !== null,
    geometryMessage,
    players: debugPlayers,
    anchors: debugAnchors,
    currentPlayerSteamId,
    candidatePlayerSteamId,
    activeAnchorId,
    summary: geometry
      ? `${debugPlayers.filter((player) => player.alive).length} alive · ${debugAnchors.length} cameras · best coverage ${visibleCount}`
      : 'Static geometry unavailable, player positions remain live'
  }
}
