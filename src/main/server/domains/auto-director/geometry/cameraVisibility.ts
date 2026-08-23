import type { GeometryMap, Vec3 } from './geometryMap'

export interface CameraAnchorPose {
  position: Vec3
  angles: Vec3
}

export interface CameraVisibilityPlayer {
  steamId: string
  position: Vec3 | null
  alive?: boolean
}

export interface CameraVisibilityOptions {
  horizontalFovDegrees?: number
  verticalFovDegrees?: number
  targetHeights?: number[]
}

export interface CameraVisibilityResult {
  steamId: string
  inFrustum: boolean
  lineOfSight: boolean
  visible: boolean
  distance: number | null
  alignment: number
  firstIntersectionDistance: number | null
  reason: 'visible' | 'outside-frustum' | 'occluded' | 'missing-position' | 'dead'
}

const DEFAULT_HORIZONTAL_FOV = 90
const DEFAULT_VERTICAL_FOV = 58
const DEFAULT_TARGET_HEIGHTS = [64, 48, 32]

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180

const normalize = (vector: Vec3): Vec3 => {
  const length = Math.hypot(...vector)
  return length > 0 ? [vector[0] / length, vector[1] / length, vector[2] / length] : [0, 0, 0]
}

const dot = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2]

const cross = (left: Vec3, right: Vec3): Vec3 => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0]
]

const subtract = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2]
]

const distance = (left: Vec3, right: Vec3): number => Math.hypot(...subtract(left, right))

/** Convert Source 2 setang pitch/yaw/roll to a normalized forward vector. */
export const forwardFromCameraAngles = (angles: Vec3): Vec3 => {
  const pitch = degreesToRadians(angles[0])
  const yaw = degreesToRadians(angles[1])
  return normalize([
    Math.cos(pitch) * Math.cos(yaw),
    Math.cos(pitch) * Math.sin(yaw),
    -Math.sin(pitch)
  ])
}

const cameraBasis = (forward: Vec3): { forward: Vec3; right: Vec3; up: Vec3 } => {
  const safeForward = normalize(forward)
  const right = normalize(cross(safeForward, [0, 0, 1]))
  return {
    forward: safeForward,
    right,
    up: normalize(cross(right, safeForward))
  }
}

const frustumAngles = (
  camera: CameraAnchorPose,
  target: Vec3
): { horizontal: number; vertical: number; alignment: number } => {
  const basis = cameraBasis(forwardFromCameraAngles(camera.angles))
  const delta = subtract(target, camera.position)
  const length = Math.hypot(...delta)
  if (!length) return { horizontal: Math.PI, vertical: Math.PI, alignment: 1 }
  const direction = normalize(delta)
  return {
    horizontal: Math.atan2(dot(direction, basis.right), dot(direction, basis.forward)),
    vertical: Math.atan2(dot(direction, basis.up), dot(direction, basis.forward)),
    alignment: Math.max(0, Math.min(1, dot(direction, basis.forward)))
  }
}

const hasLineOfSightToTarget = (
  geometry: GeometryMap,
  camera: CameraAnchorPose,
  targetPosition: Vec3,
  targetHeights: number[]
): { lineOfSight: boolean; firstIntersectionDistance: number | null } => {
  const distances = targetHeights.map((height) => {
    const target: Vec3 = [targetPosition[0], targetPosition[1], targetPosition[2] + height]
    return {
      visible: geometry.hasLineOfSight(camera.position, target),
      firstHit: geometry.firstIntersectionDistance(camera.position, target)
    }
  })
  return {
    lineOfSight: distances.some((entry) => entry.visible),
    firstIntersectionDistance: distances.find((entry) => entry.firstHit !== null)?.firstHit ?? null
  }
}

/**
 * Evaluate which replay/GSI player positions are actually visible from a saved
 * Aerial anchor. This is advisory geometry only; it does not select or send a
 * camera command and must remain outside the authoritative safety state machine.
 */
export const computeCameraVisibility = (
  camera: CameraAnchorPose,
  players: CameraVisibilityPlayer[],
  geometry: GeometryMap,
  options: CameraVisibilityOptions = {}
): Map<string, CameraVisibilityResult> => {
  const horizontalFov = degreesToRadians(options.horizontalFovDegrees ?? DEFAULT_HORIZONTAL_FOV) / 2
  const verticalFov = degreesToRadians(options.verticalFovDegrees ?? DEFAULT_VERTICAL_FOV) / 2
  const targetHeights = options.targetHeights ?? DEFAULT_TARGET_HEIGHTS
  const result = new Map<string, CameraVisibilityResult>()

  for (const player of players) {
    if (!player.position) {
      result.set(player.steamId, {
        steamId: player.steamId,
        inFrustum: false,
        lineOfSight: false,
        visible: false,
        distance: null,
        alignment: 0,
        firstIntersectionDistance: null,
        reason: 'missing-position'
      })
      continue
    }
    if (player.alive === false) {
      result.set(player.steamId, {
        steamId: player.steamId,
        inFrustum: false,
        lineOfSight: false,
        visible: false,
        distance: distance(camera.position, player.position),
        alignment: 0,
        firstIntersectionDistance: null,
        reason: 'dead'
      })
      continue
    }

    const target: Vec3 = [player.position[0], player.position[1], player.position[2] + 48]
    const angles = frustumAngles(camera, target)
    const inFrustum =
      angles.alignment > 0 &&
      Math.abs(angles.horizontal) <= horizontalFov &&
      Math.abs(angles.vertical) <= verticalFov
    const visibility = inFrustum
      ? hasLineOfSightToTarget(geometry, camera, player.position, targetHeights)
      : { lineOfSight: false, firstIntersectionDistance: null }

    result.set(player.steamId, {
      steamId: player.steamId,
      inFrustum,
      lineOfSight: visibility.lineOfSight,
      visible: inFrustum && visibility.lineOfSight,
      distance: distance(camera.position, player.position),
      alignment: angles.alignment,
      firstIntersectionDistance: visibility.firstIntersectionDistance,
      reason: !inFrustum ? 'outside-frustum' : visibility.lineOfSight ? 'visible' : 'occluded'
    })
  }

  return result
}
