import type { DirectorPlayer } from '../autoDirector.types'
import type { GeometryMap, Vec3 } from '../geometry/geometryMap'
import {
  TopologyMap,
  type TopologyAreaArtifact,
  type TopologyPath,
  type TopologyPortalArtifact
} from './topologyMap'

export interface PlayerTopologyFeatures {
  steamId: string
  areaId: number | null
  callout: string | null
  routeClasses: string[]
  tacticalRoles: string[]
  plantSite: 'site_a' | 'site_b' | null
  nearestEnemyRouteDistance: number | null
  nearestEnemyRouteHops: number
  routePortalId: string | null
  routePortalWidth: number | null
  routePortalChokepoint: boolean
  portalControlScore: number
  defensiveAngleScore: number
  crossfirePotential: number
  routeTargetCount: number
  routeConvergence: number
  routeEntryRelevance: number
  incomingRouteCount: number
  incomingRoutePressure: number
  predictedFightMs: number | null
  fightPredictionConfidence: number
  peekPotential: boolean
  peekPortalCount: number
  verticalSeparation: number | null
  topologyConfidence: number
}

const EYE_HEIGHT = 64
const CHEST_HEIGHT = 48
const MIN_MOVEMENT = 20
const SAMPLE_INTERVAL_MS = 100

const pointAtHeight = (position: Vec3, height: number): Vec3 => [
  position[0],
  position[1],
  position[2] + height
]

const routeDistanceFor = (
  topology: TopologyMap,
  startAreaId: number | null,
  targetAreaId: number | null
): TopologyPath | null =>
  targetAreaId === null ? null : topology.findNearestEnemyPath(startAreaId, [targetAreaId])

const pathForPortal = (
  topology: TopologyMap,
  path: TopologyPath | null
): TopologyPortalArtifact | null =>
  path?.portalIds[0] ? topology.getPortal(path.portalIds[0]) : null

const portalSamples = (portal: TopologyPortalArtifact): Vec3[] => {
  const tangent: Vec3 =
    portal.orientation === 'horizontal'
      ? [0, Math.min(96, portal.width * 0.35), 0]
      : [Math.min(96, portal.width * 0.35), 0, 0]
  const center: Vec3 = [portal.center[0], portal.center[1], portal.center[2] + CHEST_HEIGHT]
  return [
    center,
    [center[0] + tangent[0], center[1] + tangent[1], center[2]],
    [center[0] - tangent[0], center[1] - tangent[1], center[2]]
  ]
}

const portalPeekable = (
  geometry: GeometryMap | null,
  player: DirectorPlayer,
  enemy: DirectorPlayer,
  portal: TopologyPortalArtifact | null
): boolean => {
  if (!portal || !player.position || !enemy.position) return false
  if (!geometry) return portal.width <= 192 && !portal.vertical
  return portalSamples(portal).some(
    (sample) =>
      geometry.hasLineOfSight(pointAtHeight(player.position!, EYE_HEIGHT), sample) &&
      geometry.hasLineOfSight(pointAtHeight(enemy.position!, EYE_HEIGHT), sample)
  )
}

const mapArea = (topology: TopologyMap, player: DirectorPlayer): TopologyAreaArtifact | null =>
  player.position ? topology.findNearestArea(player.position) : null

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const portalControlScore = (
  geometry: GeometryMap | null,
  player: DirectorPlayer,
  portal: TopologyPortalArtifact | null
): number => {
  if (!portal || !player.position) return 0
  const distance = Math.hypot(
    player.position[0] - portal.center[0],
    player.position[1] - portal.center[1],
    player.position[2] - portal.center[2]
  )
  const proximity = clamp01(1 - distance / 768)
  const towardPortal = player.forward
    ? [
        portal.center[0] - player.position[0],
        portal.center[1] - player.position[1],
        portal.center[2] - player.position[2]
      ] as Vec3
    : null
  const facing =
    towardPortal && player.forward
      ? clamp01(
          (towardPortal[0] * player.forward[0] +
            towardPortal[1] * player.forward[1] +
            towardPortal[2] * player.forward[2]) /
            ((Math.hypot(...towardPortal) || 1) * (Math.hypot(...player.forward) || 1))
        )
      : 0
  const seesPortal = Boolean(
    geometry &&
      geometry.hasLineOfSight(
        pointAtHeight(player.position, EYE_HEIGHT),
        pointAtHeight(portal.center, CHEST_HEIGHT)
      )
  )
  return clamp01(proximity * 0.45 + facing * 0.25 + (seesPortal ? 0.3 : 0))
}

export const computeTopologyFeatures = (
  players: DirectorPlayer[],
  topology: TopologyMap,
  geometry: GeometryMap | null,
  previousPlayers: ReadonlyMap<string, DirectorPlayer> = new Map()
): Map<string, PlayerTopologyFeatures> => {
  const alive = players.filter((player) => player.alive && player.position && player.team)
  const areas = new Map(alive.map((player) => [player.steamId, mapArea(topology, player)]))
  const result = new Map<string, PlayerTopologyFeatures>()

  for (const player of players) {
    const area = areas.get(player.steamId) ?? null
    const enemies = alive.filter((candidate) => candidate.team !== player.team)
    const enemyPaths = enemies
      .map((enemy) => {
        const enemyArea = areas.get(enemy.steamId)
        const path = routeDistanceFor(topology, area?.id ?? null, enemyArea?.id ?? null)
        return { enemy, enemyArea, path }
      })
      .filter(
        (
          entry
        ): entry is {
          enemy: DirectorPlayer
          enemyArea: TopologyAreaArtifact
          path: TopologyPath
        } => Boolean(entry.enemyArea && entry.path)
      )
      .sort(
        (left, right) =>
          left.path.distance - right.path.distance ||
          left.enemy.steamId.localeCompare(right.enemy.steamId)
      )

    const nearest = enemyPaths[0] ?? null
    const groupedRoutes = new Map<string, typeof enemyPaths>()
    for (const entry of enemyPaths) {
      const key = entry.path.portalIds.slice(0, 2).join('>')
      const group = groupedRoutes.get(key) ?? []
      group.push(entry)
      groupedRoutes.set(key, group)
    }
    const routeGroup =
      [...groupedRoutes.values()].sort(
        (left, right) =>
          right.length - left.length ||
          left[0].path.distance - right[0].path.distance ||
          left[0].enemy.steamId.localeCompare(right[0].enemy.steamId)
      )[0] ?? []
    const routeTargetCount = routeGroup.length
    const routeConvergence = enemyPaths.length ? routeTargetCount / enemyPaths.length : 0
    const routePortal = pathForPortal(topology, routeGroup[0]?.path ?? nearest?.path ?? null)
    const peekEntries = routeGroup
      .slice(0, 5)
      .filter((entry) => portalPeekable(geometry, player, entry.enemy, routePortal))
    const peekPotential = peekEntries.length > 0

    const incomingEntries = routeGroup.filter((entry) => {
      const previous = previousPlayers.get(entry.enemy.steamId)
      const previousArea = previous?.position ? topology.findNearestArea(previous.position) : null
      if (!previousArea || !player.position || !area) return false
      const previousPath = routeDistanceFor(topology, previousArea.id, area.id)
      return Boolean(previousPath && previousPath.distance > entry.path.distance + MIN_MOVEMENT)
    })
    const incomingRoutePressure = routeGroup.length
      ? Math.max(0, Math.min(1, incomingEntries.length / routeGroup.length))
      : 0
    const routeClosingPerSample = incomingEntries
      .map((entry) => {
        const previous = previousPlayers.get(entry.enemy.steamId)
        const previousArea = previous?.position ? topology.findNearestArea(previous.position) : null
        if (!previousArea || !area) return 0
        const previousPath = routeDistanceFor(topology, previousArea.id, area.id)
        return previousPath ? Math.max(0, previousPath.distance - entry.path.distance) : 0
      })
      .filter((value) => value > 0)
    const fastestClosing = routeClosingPerSample.length ? Math.max(...routeClosingPerSample) : 0
    const predictedFightMs =
      nearest && fastestClosing > MIN_MOVEMENT
        ? Math.max(
            250,
            Math.min(5000, (nearest.path.distance / fastestClosing) * SAMPLE_INTERVAL_MS)
          )
        : null
    const routePortalChokepoint = topology.isChokepoint(routePortal)
    const portalControl = portalControlScore(geometry, player, routePortal)
    const defensiveAngle = clamp01(
      portalControl *
        (0.45 +
          (routePortal ? Math.max(0, Math.min(1, 1 - routePortal.width / 512)) * 0.55 : 0))
    )
    const fightPredictionConfidence = clamp01(
      routeConvergence * 0.3 +
        incomingRoutePressure * 0.25 +
        (peekPotential ? 0.2 : 0) +
        (routePortalChokepoint ? 0.15 : 0) +
        portalControl * 0.1
    )
    const topologyConfidence = topology.areaCount > 0 && area ? 1 : 0
    const routeEvidence =
      routeTargetCount > 0
        ? routeConvergence * 0.45 + (peekPotential ? 0.35 : 0) + incomingRoutePressure * 0.2
        : 0
    const routeEntryRelevance = Math.max(
      0,
      Math.min(1, routeEvidence * Math.min(1, routeTargetCount / 3))
    )
    const verticalSeparation =
      nearest?.enemy.position && player.position
        ? Math.abs(nearest.enemy.position[2] - player.position[2])
        : null

    result.set(player.steamId, {
      steamId: player.steamId,
      areaId: area?.id ?? null,
      callout: area?.callout ?? null,
      routeClasses: area?.routeClasses ?? [],
      tacticalRoles: area ? topology.getAreaTacticalRoles(area.id) : [],
      plantSite: area ? topology.getAreaPlantSite(area.id) : null,
      nearestEnemyRouteDistance: nearest?.path.distance ?? null,
      nearestEnemyRouteHops: nearest?.path.areaIds.length ? nearest.path.areaIds.length - 1 : 0,
      routePortalId: routePortal?.id ?? null,
      routePortalWidth: routePortal?.width ?? null,
      routePortalChokepoint,
      portalControlScore: portalControl,
      defensiveAngleScore: defensiveAngle,
      crossfirePotential: 0,
      routeTargetCount,
      routeConvergence,
      routeEntryRelevance,
      incomingRouteCount: incomingEntries.length,
      incomingRoutePressure,
      predictedFightMs,
      fightPredictionConfidence,
      peekPotential,
      peekPortalCount: peekEntries.length,
      verticalSeparation,
      topologyConfidence
    })
  }

  for (const player of players) {
    const current = result.get(player.steamId)
    const playerPosition = player.position
    if (!current || !playerPosition) continue
    const crossfirePartners = players.filter((partner) => {
      if (!partner.alive || partner.steamId === player.steamId || partner.team !== player.team) {
        return false
      }
      const partnerFeatures = result.get(partner.steamId)
      if (!partnerFeatures || partnerFeatures.routePortalId !== current.routePortalId) return false
      const partnerPosition = partner.position
      const separation = partnerPosition
        ? Math.hypot(
            partnerPosition[0] - playerPosition[0],
            partnerPosition[1] - playerPosition[1],
            partnerPosition[2] - playerPosition[2]
          )
        : Number.POSITIVE_INFINITY
      return separation >= 128 && separation <= 1600 && partnerFeatures.portalControlScore >= 0.35
    })
    result.set(player.steamId, {
      ...current,
      crossfirePotential: Math.max(0, Math.min(1, crossfirePartners.length / 2))
    })
  }
  return result
}
