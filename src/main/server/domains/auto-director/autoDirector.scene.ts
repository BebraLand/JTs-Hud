import type { DirectorPlayer } from './autoDirector.types'
import type { PlayerGeometryFeatures } from './geometry/geometryFeatures'
import type { PlayerTopologyFeatures } from './topology/topologyFeatures'

export type ScenePhase = 'forming' | 'approaching' | 'contact' | 'objective'

export interface SceneSummary {
  key: string
  members: DirectorPlayer[]
  center: [number, number, number] | null
  radius: number
  score: number
  opposingTeamCount: number
  teamCount: number
  hasOpposition: boolean
  phase: ScenePhase
  confidence: number
  movementMagnitude: number
  approachPressure: number
}

export interface PlayerSceneFeatures {
  sceneKey: string | null
  sceneScore: number
  dominantSceneScore: number
  sceneRelevance: number
  sceneMemberCount: number
  opposingSceneMemberCount: number
  enemiesInViewCone: number
  nearbyEnemyCount: number
  enemyGroupAlignment: number
  enemyGroupCoverage: number
  contactImminence: number
  routeEntryRelevance: number
  routeEntryTargetCount: number
  scenePhase: ScenePhase | null
  sceneConfidence: number
  movementMagnitude: number
  approachPressure: number
  povQuality: number
  threatSceneKey: string | null
  threatSceneTargetCount: number
  threatSceneEnemiesInViewCone: number
  threatSceneAlignment: number
  threatSceneCoverage: number
  threatSceneActionableTargetCount: number
  threatSceneActionableCoverage: number
  threatSceneVisibleCount: number
  threatScenePeekCount: number
  threatSceneExternal: boolean
  incomingGroupCount: number
  incomingGroupPressure: number
  topologyAreaId: number | null
  topologyCallout: string | null
  topologyTacticalRoles: string[]
  topologyPlantSite: 'site_a' | 'site_b' | null
  topologyRoutePortalId: string | null
  topologyRouteDistance: number | null
  topologyRoutePortalChokepoint: boolean
  topologyPortalControlScore: number
  topologyDefensiveAngleScore: number
  topologyCrossfirePotential: number
  topologyRouteConvergence: number
  topologyPeekPotential: boolean
  topologyPeekPortalCount: number
  topologyIncomingRoutePressure: number
  topologyPredictedFightMs: number | null
  topologyFightPredictionConfidence: number
  topologyVerticalSeparation: number | null
  topologyRouteAdvisoryAllowed: boolean
  isolatedNoAction: boolean
  dominantScene: boolean
}

export interface SceneAnalysis {
  scenes: SceneSummary[]
  dominantScene: SceneSummary | null
  playerFeatures: Map<string, PlayerSceneFeatures>
}

const SCENE_CLUSTER_RADIUS = 900
const THREAT_RADIUS = 2200
const VIEW_CONE_DOT = 0.65
const MOVEMENT_NORMALIZATION = 350
const EPSILON = 0.0001

const distance = (left: [number, number, number], right: [number, number, number]): number =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])

const normalizedDot = (
  origin: [number, number, number] | null,
  forward: [number, number, number] | null,
  target: [number, number, number] | null
): number => {
  if (!origin || !forward || !target) return 0
  const delta: [number, number, number] = [
    target[0] - origin[0],
    target[1] - origin[1],
    target[2] - origin[2]
  ]
  const deltaLength = Math.hypot(...delta)
  const forwardLength = Math.hypot(...forward)
  if (deltaLength < EPSILON || forwardLength < EPSILON) return 0
  return Math.max(
    -1,
    Math.min(
      1,
      (delta[0] * forward[0] + delta[1] * forward[1] + delta[2] * forward[2]) /
        (deltaLength * forwardLength)
    )
  )
}

const sceneCenter = (members: DirectorPlayer[]): [number, number, number] | null => {
  const positioned = members.filter((member) => member.position)
  if (positioned.length === 0) return null
  const sum = positioned.reduce(
    (acc, member) => {
      acc[0] += member.position![0]
      acc[1] += member.position![1]
      acc[2] += member.position![2]
      return acc
    },
    [0, 0, 0] as [number, number, number]
  )
  return [sum[0] / positioned.length, sum[1] / positioned.length, sum[2] / positioned.length]
}

const vectorLength = (value: [number, number, number]): number => Math.hypot(...value)

const normalized = (value: [number, number, number]): [number, number, number] | null => {
  const length = vectorLength(value)
  return length < EPSILON ? null : [value[0] / length, value[1] / length, value[2] / length]
}

const vectorBetween = (
  origin: [number, number, number],
  target: [number, number, number]
): [number, number, number] => [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]]

const movementFor = (
  member: DirectorPlayer,
  previousPlayers: Map<string, DirectorPlayer>
): [number, number, number] | null => {
  const previous = previousPlayers.get(member.steamId)
  if (!member.position || !previous?.position) return null
  return vectorBetween(previous.position, member.position)
}

const buildScenes = (
  players: DirectorPlayer[],
  previousPlayers: Map<string, DirectorPlayer>
): SceneSummary[] => {
  const alive = players.filter((player) => player.alive && player.position)
  const remaining = new Set(alive.map((player) => player.steamId))
  const scenes: SceneSummary[] = []

  while (remaining.size > 0) {
    const seedId = [...remaining].sort()[0]
    const queue = [alive.find((player) => player.steamId === seedId)!]
    const members: DirectorPlayer[] = []
    remaining.delete(seedId)

    while (queue.length > 0) {
      const current = queue.shift()!
      members.push(current)
      for (const candidate of alive) {
        if (!remaining.has(candidate.steamId)) continue
        if (distance(current.position!, candidate.position!) <= SCENE_CLUSTER_RADIUS) {
          remaining.delete(candidate.steamId)
          queue.push(candidate)
        }
      }
    }

    const center = sceneCenter(members)
    const radius = center
      ? Math.max(...members.map((member) => distance(center, member.position!)))
      : 0
    const teamCounts = new Map<string, number>()
    for (const member of members) {
      teamCounts.set(member.team, (teamCounts.get(member.team) ?? 0) + 1)
    }
    const teamCount = teamCounts.size
    const opposingTeamCount = teamCount > 1 ? Math.min(...teamCounts.values()) : 0
    const hasOpposition = teamCount > 1 && opposingTeamCount > 0
    const density = members.length / Math.max(1, radius / 500)
    const movements = members
      .map((member) => movementFor(member, previousPlayers))
      .filter((movement): movement is [number, number, number] => movement !== null)
    const movementMagnitude = movements.length
      ? Math.min(
          1,
          movements.reduce((sum, movement) => sum + vectorLength(movement), 0) /
            movements.length /
            MOVEMENT_NORMALIZATION
        )
      : 0
    const teamCenters = new Map<string, [number, number, number]>()
    for (const team of teamCounts.keys()) {
      const teamCenter = sceneCenter(members.filter((member) => member.team === team))
      if (teamCenter) teamCenters.set(team, teamCenter)
    }
    const approachAlignments = members
      .map((member) => {
        const movement = movementFor(member, previousPlayers)
        const opposingCenter = [...teamCenters.entries()]
          .filter(([team]) => team !== member.team)
          .map(([, center]) => center)[0]
        if (!movement || !member.position || !opposingCenter) return null
        const moveDirection = normalized(movement)
        const approachDirection = normalized(vectorBetween(member.position, opposingCenter))
        if (!moveDirection || !approachDirection) return null
        return Math.max(
          0,
          moveDirection[0] * approachDirection[0] +
            moveDirection[1] * approachDirection[1] +
            moveDirection[2] * approachDirection[2]
        )
      })
      .filter((value): value is number => value !== null)
    const approachPressure =
      hasOpposition && approachAlignments.length
        ? movementMagnitude *
          (approachAlignments.reduce((sum, value) => sum + value, 0) / approachAlignments.length)
        : 0
    const opposingDistances = members.flatMap((member) =>
      members
        .filter((candidate) => candidate.team !== member.team && candidate.position)
        .map((candidate) => distance(member.position!, candidate.position!))
    )
    const closestOpposingDistance = opposingDistances.length
      ? Math.min(...opposingDistances)
      : Number.POSITIVE_INFINITY
    const contact =
      hasOpposition &&
      (closestOpposingDistance <= 700 ||
        members.some((member) => {
          const previous = previousPlayers.get(member.steamId)
          return Boolean(
            previous &&
            (member.roundDamage > previous.roundDamage || member.roundKills > previous.roundKills)
          )
        }))
    const objective = hasOpposition && members.some((member) => member.hasBomb)
    const phase: ScenePhase = objective
      ? 'objective'
      : contact
        ? 'contact'
        : approachPressure >= 0.12
          ? 'approaching'
          : 'forming'
    const confidence = Math.max(
      0,
      Math.min(
        1,
        0.2 +
          Math.min(0.35, members.length / 20) +
          (hasOpposition ? 0.3 : 0) +
          Math.min(0.15, density / 80)
      )
    )
    const score =
      members.length * 2.4 +
      (hasOpposition ? opposingTeamCount * 5.5 : 0) +
      Math.min(12, Math.max(0, density)) +
      (members.length >= 4 ? 4 : 0) +
      (phase === 'objective' ? 8 : phase === 'contact' ? 6 : phase === 'approaching' ? 3 : 0)

    scenes.push({
      key: members
        .map((member) => member.steamId)
        .sort()
        .join(','),
      members,
      center,
      radius,
      score,
      opposingTeamCount,
      teamCount,
      hasOpposition,
      phase,
      confidence,
      movementMagnitude,
      approachPressure
    })
  }

  return scenes.sort(
    (left, right) =>
      right.score - left.score ||
      right.members.length - left.members.length ||
      left.key.localeCompare(right.key)
  )
}

export const analyzeScenes = (
  players: DirectorPlayer[],
  previousPlayers: Map<string, DirectorPlayer> = new Map(),
  geometryFeatures: ReadonlyMap<string, PlayerGeometryFeatures> = new Map(),
  topologyFeatures: ReadonlyMap<string, PlayerTopologyFeatures> = new Map()
): SceneAnalysis => {
  const scenes = buildScenes(players, previousPlayers)
  const dominantScene = scenes[0] ?? null
  const playerFeatures = new Map<string, PlayerSceneFeatures>()

  for (const player of players) {
    const scene = scenes.find((candidate) =>
      candidate.members.some((member) => member.steamId === player.steamId)
    )
    const enemies = players.filter(
      (candidate) =>
        candidate.alive &&
        candidate.team &&
        player.team &&
        candidate.team !== player.team &&
        player.position &&
        candidate.position &&
        distance(player.position, candidate.position) <= THREAT_RADIUS
    )
    const alignedEnemies = enemies.filter(
      (enemy) => normalizedDot(player.position, player.forward, enemy.position) >= VIEW_CONE_DOT
    )
    const enemyGroupAlignment =
      enemies.length === 0
        ? 0
        : enemies.reduce(
            (sum, enemy) =>
              sum + Math.max(0, normalizedDot(player.position, player.forward, enemy.position)),
            0
          ) / enemies.length
    const enemyGroupCoverage = enemies.length === 0 ? 0 : alignedEnemies.length / enemies.length
    const closestEnemyDistance = enemies.reduce(
      (closest, enemy) => Math.min(closest, distance(player.position!, enemy.position!)),
      Number.POSITIVE_INFINITY
    )
    const distanceContactImminence =
      enemies.length === 0
        ? 0
        : Math.max(0, Math.min(1, 1 - closestEnemyDistance / THREAT_RADIUS)) *
          (0.35 + enemyGroupCoverage * 0.45 + (scene?.approachPressure ?? 0) * 0.2)
    const sceneMemberCount = scene?.members.length ?? 0
    const opposingSceneMemberCount = scene
      ? scene.members.filter((member) => member.team && member.team !== player.team).length
      : 0
    const isolatedNoActionCandidate =
      player.alive &&
      sceneMemberCount <= 2 &&
      enemies.filter((enemy) => distance(player.position!, enemy.position!) <= 1400).length === 0 &&
      !player.hasBomb
    const sceneScore = scene?.score ?? 0
    const dominantSceneScore = dominantScene?.score ?? 0
    const localSceneEnemies = scene
      ? scene.members.filter(
          (candidate) => candidate.alive && candidate.team && candidate.team !== player.team
        )
      : enemies
    const dominantThreatTargets = dominantScene
      ? dominantScene.members.filter(
          (candidate) =>
            candidate.alive &&
            candidate.team &&
            candidate.team !== player.team &&
            candidate.position &&
            player.position &&
            distance(player.position, candidate.position) <= THREAT_RADIUS * 1.35
        )
      : []
    const threatSceneExternal = Boolean(
      dominantScene &&
      dominantThreatTargets.length >= 2 &&
      !dominantScene.members.some((member) => member.steamId === player.steamId)
    )
    const threatTargets =
      dominantThreatTargets.length >= 2 ? dominantThreatTargets : localSceneEnemies
    const sceneEnemyAlignments = threatTargets.map((enemy) =>
      Math.max(0, normalizedDot(player.position, player.forward, enemy.position))
    )
    const sceneEnemyCoverage = threatTargets.length
      ? sceneEnemyAlignments.filter((value) => value >= VIEW_CONE_DOT).length /
        sceneEnemyAlignments.length
      : 0
    const povQuality = threatTargets.length
      ? Math.max(
          0,
          Math.min(
            1,
            (sceneEnemyAlignments.reduce((sum, value) => sum + value, 0) /
              sceneEnemyAlignments.length) *
              0.45 +
              sceneEnemyCoverage * 0.35 +
              (scene?.phase === 'contact' || scene?.phase === 'approaching' ? 0.2 : 0)
          )
        )
      : 0
    const threatSceneAlignment = threatTargets.length
      ? sceneEnemyAlignments.reduce((sum, value) => sum + value, 0) / threatTargets.length
      : 0
    const threatSceneEnemiesInViewCone = sceneEnemyAlignments.filter(
      (value) => value >= VIEW_CONE_DOT
    ).length
    const playerGeometry = geometryFeatures.get(player.steamId)
    const playerTopology = topologyFeatures.get(player.steamId)
    const geometryAware = Boolean(playerGeometry)
    const threatTargetIds = new Set(threatTargets.map((target) => target.steamId))
    const visibleThreatIds = new Set(
      (playerGeometry?.visibleEnemySteamIds ?? []).filter((steamId) => threatTargetIds.has(steamId))
    )
    const peekThreatIds = new Set(
      (playerGeometry?.peekPotentialEnemySteamIds ?? []).filter((steamId) =>
        threatTargetIds.has(steamId)
      )
    )
    const actionableThreatIds = new Set([...visibleThreatIds, ...peekThreatIds])
    const threatSceneVisibleCount = geometryAware
      ? visibleThreatIds.size
      : threatSceneEnemiesInViewCone
    const threatScenePeekCount = geometryAware ? peekThreatIds.size : 0
    const threatSceneActionableTargetCount = geometryAware
      ? actionableThreatIds.size
      : threatSceneEnemiesInViewCone
    const threatSceneActionableCoverage = threatTargets.length
      ? threatSceneActionableTargetCount / threatTargets.length
      : 0
    const incomingPressures = threatTargets.map((enemy) => {
      const movement = movementFor(enemy, previousPlayers)
      if (!movement || !enemy.position || !player.position || vectorLength(movement) < 16) return 0
      const moveDirection = normalized(movement)
      const towardPlayer = normalized(vectorBetween(enemy.position, player.position))
      if (!moveDirection || !towardPlayer) return 0
      return (
        Math.max(
          0,
          moveDirection[0] * towardPlayer[0] +
            moveDirection[1] * towardPlayer[1] +
            moveDirection[2] * towardPlayer[2]
        ) * Math.min(1, vectorLength(movement) / 120)
      )
    })
    const incomingGroupCount = incomingPressures.filter((value) => value >= 0.45).length
    const incomingAverage = incomingPressures.length
      ? incomingPressures.reduce((sum, value) => sum + value, 0) / incomingPressures.length
      : 0
    const facingPressure = Math.max(0, Math.min(1, (threatSceneAlignment - 0.35) / 0.65))
    const incomingGroupPressure = Math.max(
      0,
      Math.min(
        1,
        incomingAverage * Math.min(1, threatTargets.length / 3) * (0.35 + facingPressure * 0.65)
      )
    )
    const contactEvidence = geometryAware
      ? Math.max(
          threatSceneActionableTargetCount > 0 ? 0.35 + threatSceneActionableCoverage * 0.65 : 0,
          incomingGroupPressure
        )
      : 1
    const contactImminence = distanceContactImminence * contactEvidence
    const routeEntryEvidence = geometryAware
      ? Math.max(
          threatSceneActionableCoverage,
          incomingGroupPressure,
          incomingGroupCount >= 2 ? incomingGroupPressure * 0.8 : 0
        )
      : Math.max(sceneEnemyCoverage, incomingGroupPressure)
    const receiverDistanceSignal =
      closestEnemyDistance === Number.POSITIVE_INFINITY
        ? 0
        : Math.max(0, Math.min(1, 1 - closestEnemyDistance / (THREAT_RADIUS * 1.25)))
    const receiverAlignment = Math.max(0, Math.min(1, (threatSceneAlignment - 0.45) / 0.55))
    const routeEntryRelevance =
      dominantThreatTargets.length < 3
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              Math.min(1, dominantThreatTargets.length / 5) *
                (routeEntryEvidence * 0.55 +
                  receiverAlignment * 0.25 +
                  receiverDistanceSignal * 0.2)
            )
          )
    const topologyRouteEntryRelevance = playerTopology?.routeEntryRelevance ?? 0
    const combinedRouteEntryTargetCount = Math.max(
      dominantThreatTargets.length,
      playerTopology?.routeTargetCount ?? 0
    )
    const topologyIncomingPressure = playerTopology?.incomingRoutePressure ?? 0
    const topologyPortalControl = playerTopology?.portalControlScore ?? 0
    const topologyPortalControlEvidence = playerTopology
      ? Math.max(0, Math.min(1, (topologyPortalControl - 0.25) / 0.5))
      : 1
    const topologyMeaningfulRoute = Boolean(
      playerTopology &&
      playerTopology.routeTargetCount >= 2 &&
      ((playerTopology.peekPotential && topologyPortalControl >= 0.25) ||
        (playerTopology.incomingRoutePressure >= 0.35 && topologyPortalControl >= 0.5))
    )
    // A topology route is only broadcast-relevant when it has local corroboration.
    // A remote player can otherwise appear to own the whole enemy route graph even
    // while having no LOS, no peek, and no opposing player in the local scene.
    const routeSceneCorroborated = Boolean(
      !geometryAware || threatSceneActionableTargetCount > 0 || opposingSceneMemberCount > 0
    )
    const topologyRouteAdvisoryAllowed = topologyMeaningfulRoute && routeSceneCorroborated
    const routeSceneEvidenceAllowed =
      routeSceneCorroborated &&
      (threatSceneActionableTargetCount > 0 || !threatSceneExternal || topologyRouteAdvisoryAllowed)
    const effectiveRouteEntryRelevance =
      geometryAware && !routeSceneEvidenceAllowed
        ? 0
        : Math.max(routeEntryRelevance, topologyRouteEntryRelevance)
    const combinedRouteEntryRelevance = effectiveRouteEntryRelevance
    const combinedIncomingGroupPressure = routeSceneCorroborated
      ? playerTopology
        ? Math.max(
            incomingGroupPressure * topologyPortalControlEvidence,
            topologyIncomingPressure * topologyPortalControlEvidence
          )
        : incomingGroupPressure
      : 0
    const effectiveIncomingGroupPressure = routeSceneEvidenceAllowed
      ? combinedIncomingGroupPressure
      : 0
    const emptyThreatAngle = Boolean(
      geometryAware &&
      dominantThreatTargets.length >= 3 &&
      threatSceneEnemiesInViewCone >= 3 &&
      threatSceneActionableTargetCount === 0 &&
      effectiveIncomingGroupPressure < 0.35 &&
      combinedRouteEntryRelevance < 0.55 &&
      !topologyRouteAdvisoryAllowed
    )
    const remoteNoActionThreat = Boolean(
      geometryAware &&
      dominantThreatTargets.length >= 2 &&
      threatSceneActionableTargetCount === 0 &&
      !routeSceneCorroborated
    )
    const isolatedNoAction =
      (isolatedNoActionCandidate || emptyThreatAngle || remoteNoActionThreat) &&
      !topologyRouteAdvisoryAllowed &&
      (!geometryAware ||
        (threatSceneActionableTargetCount === 0 && effectiveIncomingGroupPressure < 0.35))
    const hasMeaningfulThreatView =
      dominantThreatTargets.length >= 2 &&
      (geometryAware
        ? threatSceneActionableTargetCount > 0 ||
          (effectiveIncomingGroupPressure >= 0.35 &&
            sceneEnemyCoverage >= 0.35 &&
            routeSceneEvidenceAllowed) ||
          topologyRouteAdvisoryAllowed
        : threatSceneEnemiesInViewCone > 0 && sceneEnemyCoverage >= 0.35)
    const povCoverage = geometryAware ? threatSceneActionableCoverage : sceneEnemyCoverage

    playerFeatures.set(player.steamId, {
      sceneKey: scene?.key ?? null,
      sceneScore,
      dominantSceneScore,
      sceneRelevance:
        dominantSceneScore <= EPSILON
          ? 0
          : Math.max(0, Math.min(1, sceneScore / dominantSceneScore)),
      sceneMemberCount,
      opposingSceneMemberCount,
      enemiesInViewCone: alignedEnemies.length,
      nearbyEnemyCount: enemies.length,
      enemyGroupAlignment,
      enemyGroupCoverage,
      contactImminence,
      routeEntryRelevance: combinedRouteEntryRelevance,
      routeEntryTargetCount: combinedRouteEntryTargetCount,
      scenePhase: scene?.phase ?? null,
      sceneConfidence: scene?.confidence ?? 0,
      movementMagnitude: scene?.movementMagnitude ?? 0,
      approachPressure: scene?.approachPressure ?? 0,
      povQuality: Math.max(
        povQuality + effectiveIncomingGroupPressure * 0.2,
        povCoverage,
        effectiveIncomingGroupPressure * 0.65,
        topologyRouteAdvisoryAllowed ? 0.35 + combinedRouteEntryRelevance * 0.45 : 0
      ),
      threatSceneKey: hasMeaningfulThreatView ? (dominantScene?.key ?? null) : null,
      threatSceneTargetCount: dominantThreatTargets.length,
      threatSceneEnemiesInViewCone,
      threatSceneAlignment,
      threatSceneCoverage: sceneEnemyCoverage,
      threatSceneActionableTargetCount,
      threatSceneActionableCoverage,
      threatSceneVisibleCount,
      threatScenePeekCount,
      threatSceneExternal: threatSceneExternal && hasMeaningfulThreatView,
      incomingGroupCount,
      incomingGroupPressure: effectiveIncomingGroupPressure,
      topologyAreaId: playerTopology?.areaId ?? null,
      topologyCallout: playerTopology?.callout ?? null,
      topologyTacticalRoles: playerTopology?.tacticalRoles ?? [],
      topologyPlantSite: playerTopology?.plantSite ?? null,
      topologyRoutePortalId: playerTopology?.routePortalId ?? null,
      topologyRouteDistance: playerTopology?.nearestEnemyRouteDistance ?? null,
      topologyRoutePortalChokepoint: playerTopology?.routePortalChokepoint ?? false,
      topologyPortalControlScore: playerTopology?.portalControlScore ?? 0,
      topologyDefensiveAngleScore: playerTopology?.defensiveAngleScore ?? 0,
      topologyCrossfirePotential: playerTopology?.crossfirePotential ?? 0,
      topologyRouteConvergence: playerTopology?.routeConvergence ?? 0,
      topologyPeekPotential: playerTopology?.peekPotential ?? false,
      topologyPeekPortalCount: playerTopology?.peekPortalCount ?? 0,
      topologyIncomingRoutePressure: topologyIncomingPressure,
      topologyPredictedFightMs: playerTopology?.predictedFightMs ?? null,
      topologyFightPredictionConfidence: playerTopology?.fightPredictionConfidence ?? 0,
      topologyVerticalSeparation: playerTopology?.verticalSeparation ?? null,
      topologyRouteAdvisoryAllowed,
      isolatedNoAction: isolatedNoAction && !hasMeaningfulThreatView,
      dominantScene: Boolean(scene && dominantScene && scene.key === dominantScene.key)
    })
  }

  return { scenes, dominantScene, playerFeatures }
}
