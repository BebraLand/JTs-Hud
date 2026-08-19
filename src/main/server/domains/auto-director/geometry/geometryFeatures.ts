import type { DirectorPlayer } from '../autoDirector.types'
import type { GeometryMap, Vec3 } from './geometryMap'

export interface PlayerGeometryFeatures {
  steamId: string
  visibleEnemyCount: number
  nearestVisibleEnemySteamId: string | null
  nearestVisibleEnemyDistance: number | null
  nearestEnemyHasLineOfSight: boolean
  nearestEnemyHasPeekPotential: boolean
  peekPotentialEnemyCount: number
  forwardEnemyCount: number
  forwardEnemyAlignment: number
  bestVisibleAimAlignment: number
}

const EYE_HEIGHT = 64
const CHEST_HEIGHT = 48

const pointAtHeight = (position: [number, number, number], height: number): Vec3 => [
  position[0],
  position[1],
  position[2] + height
]

const distance = (left: Vec3, right: Vec3): number =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])

const alignment = (player: DirectorPlayer, target: DirectorPlayer): number => {
  if (!player.position || !player.forward || !target.position) return 0
  const delta: Vec3 = [
    target.position[0] - player.position[0],
    target.position[1] - player.position[1],
    target.position[2] - player.position[2]
  ]
  const deltaLength = Math.hypot(...delta)
  const forwardLength = Math.hypot(...player.forward)
  if (!deltaLength || !forwardLength) return 0
  const dot =
    (delta[0] * player.forward[0] + delta[1] * player.forward[1] + delta[2] * player.forward[2]) /
    (deltaLength * forwardLength)
  return Math.max(0, Math.min(1, (dot + 1) / 2))
}

const forwardAlignment = (player: DirectorPlayer, target: DirectorPlayer): number => {
  if (!player.position || !player.forward || !target.position) return 0
  const delta: Vec3 = [
    target.position[0] - player.position[0],
    target.position[1] - player.position[1],
    target.position[2] - player.position[2]
  ]
  const deltaLength = Math.hypot(...delta)
  const forwardLength = Math.hypot(...player.forward)
  if (!deltaLength || !forwardLength) return 0
  const dot =
    (delta[0] * player.forward[0] + delta[1] * player.forward[1] + delta[2] * player.forward[2]) /
    (deltaLength * forwardLength)
  return Math.max(0, Math.min(1, dot))
}

export const hasPlayerLineOfSight = (
  geometry: GeometryMap,
  observer: DirectorPlayer,
  target: DirectorPlayer
): boolean => {
  if (!observer.position || !target.position) return false
  const eye = pointAtHeight(observer.position, EYE_HEIGHT)
  return (
    geometry.hasLineOfSight(eye, pointAtHeight(target.position, EYE_HEIGHT)) ||
    geometry.hasLineOfSight(eye, pointAtHeight(target.position, CHEST_HEIGHT))
  )
}

const hasPeekPotential = (geometry: GeometryMap, observer: DirectorPlayer, target: DirectorPlayer): boolean => {
  if (!observer.position || !target.position) return false
  const forward = observer.forward ?? [1, 0, 0]
  const length = Math.hypot(forward[0], forward[1]) || 1
  const lateral: Vec3 = [(-forward[1] / length) * 48, (forward[0] / length) * 48, 0]
  const observerOffsets: Vec3[] = [
    [lateral[0], lateral[1], 0],
    [-lateral[0], -lateral[1], 0],
    [forward[0] * 64, forward[1] * 64, 0],
    [forward[0] * 64 + lateral[0], forward[1] * 64 + lateral[1], 0]
  ]
  const targetOffsets: Vec3[] = [
    [0, 0, 0],
    [lateral[0], lateral[1], 0],
    [-lateral[0], -lateral[1], 0]
  ]
  return observerOffsets.some((observerOffset) =>
    targetOffsets.some((targetOffset) => {
      const origin: [number, number, number] = [
        observer.position![0] + observerOffset[0],
        observer.position![1] + observerOffset[1],
        observer.position![2] + EYE_HEIGHT
      ]
      const destination: [number, number, number] = [
        target.position![0] + targetOffset[0],
        target.position![1] + targetOffset[1],
        target.position![2] + CHEST_HEIGHT
      ]
      return geometry.hasLineOfSight(origin, destination)
    })
  )
}

export const computeGeometryFeatures = (
  players: DirectorPlayer[],
  geometry: GeometryMap
): Map<string, PlayerGeometryFeatures> => {
  const result = new Map<string, PlayerGeometryFeatures>()
  for (const player of players) {
    const enemies = players
      .filter(
        (candidate) =>
          candidate.alive &&
          candidate.team &&
          player.team &&
          candidate.team !== player.team &&
          candidate.position &&
          player.position
      )
      .map((enemy) => ({
        enemy,
        distance: distance(player.position!, enemy.position!),
        visible: hasPlayerLineOfSight(geometry, player, enemy),
        alignment: alignment(player, enemy)
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance || left.enemy.steamId.localeCompare(right.enemy.steamId)
      )
    const visible = enemies.filter((enemy) => enemy.visible)
    const peekable = enemies.filter(
      (enemy) => !enemy.visible && hasPeekPotential(geometry, player, enemy.enemy)
    )
    const forward = enemies.filter(
      (enemy) => enemy.distance <= 1800 && forwardAlignment(player, enemy.enemy) >= 0.65
    )
    result.set(player.steamId, {
      steamId: player.steamId,
      visibleEnemyCount: visible.length,
      nearestVisibleEnemySteamId: visible[0]?.enemy.steamId ?? null,
      nearestVisibleEnemyDistance: visible[0] ? Math.round(visible[0].distance) : null,
      nearestEnemyHasLineOfSight: enemies[0]?.visible ?? false,
      nearestEnemyHasPeekPotential: Boolean(peekable[0]),
      peekPotentialEnemyCount: peekable.length,
      forwardEnemyCount: forward.length,
      forwardEnemyAlignment:
        forward.length === 0
          ? 0
          : forward.reduce((sum, enemy) => sum + forwardAlignment(player, enemy.enemy), 0) /
            forward.length,
      bestVisibleAimAlignment: visible.reduce((best, enemy) => Math.max(best, enemy.alignment), 0)
    })
  }
  return result
}
