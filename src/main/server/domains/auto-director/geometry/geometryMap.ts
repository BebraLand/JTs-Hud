export type Vec3 = readonly [number, number, number]

export interface GeometryArtifact {
  schemaVersion: 1
  mapName: string
  sourceSha256: string
  coordinateSystem: 'source2-hammer-units'
  sourceTriangleCount?: number
  triangles: number[]
}

type FlatBvh = {
  bounds: Float32Array
  left: Int32Array
  right: Int32Array
  start: Uint32Array
  count: Uint32Array
  triangleIndices: Uint32Array
}

const LEAF_TRIANGLES = 8
const INTERSECTION_EPSILON = 0.5

const component = (
  triangles: Float32Array,
  triangle: number,
  vertex: number,
  axis: number
): number => triangles[triangle * 9 + vertex * 3 + axis]

const buildBvh = (triangles: Float32Array, triangleCount: number): FlatBvh => {
  const triangleIndices = Uint32Array.from({ length: triangleCount }, (_, triangle) => triangle)
  const nodeBounds: number[] = []
  const nodeLeft: number[] = []
  const nodeRight: number[] = []
  const nodeStart: number[] = []
  const nodeCount: number[] = []

  const buildRange = (start: number, end: number): number => {
    const node = nodeLeft.length
    nodeLeft.push(-1)
    nodeRight.push(-1)
    nodeStart.push(0)
    nodeCount.push(0)

    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    const centroidMin = [Infinity, Infinity, Infinity]
    const centroidMax = [-Infinity, -Infinity, -Infinity]
    for (let offset = start; offset < end; offset += 1) {
      const triangle = triangleIndices[offset]
      for (let axis = 0; axis < 3; axis += 1) {
        let centroid = 0
        for (let vertex = 0; vertex < 3; vertex += 1) {
          const value = component(triangles, triangle, vertex, axis)
          min[axis] = Math.min(min[axis], value)
          max[axis] = Math.max(max[axis], value)
          centroid += value
        }
        centroid /= 3
        centroidMin[axis] = Math.min(centroidMin[axis], centroid)
        centroidMax[axis] = Math.max(centroidMax[axis], centroid)
      }
    }
    nodeBounds.push(min[0], min[1], min[2], max[0], max[1], max[2])

    const count = end - start
    if (count <= LEAF_TRIANGLES) {
      nodeStart[node] = start
      nodeCount[node] = count
      return node
    }

    const extents = centroidMax.map((value, axis) => value - centroidMin[axis])
    const splitAxis = extents.indexOf(Math.max(...extents))
    triangleIndices.subarray(start, end).sort((left, right) => {
      let leftCentroid = 0
      let rightCentroid = 0
      for (let vertex = 0; vertex < 3; vertex += 1) {
        leftCentroid += component(triangles, left, vertex, splitAxis)
        rightCentroid += component(triangles, right, vertex, splitAxis)
      }
      return leftCentroid - rightCentroid || left - right
    })
    const middle = Math.floor((start + end) / 2)
    nodeLeft[node] = buildRange(start, middle)
    nodeRight[node] = buildRange(middle, end)
    return node
  }

  buildRange(0, triangleCount)
  return {
    bounds: Float32Array.from(nodeBounds),
    left: Int32Array.from(nodeLeft),
    right: Int32Array.from(nodeRight),
    start: Uint32Array.from(nodeStart),
    count: Uint32Array.from(nodeCount),
    triangleIndices
  }
}

const segmentIntersectsBounds = (
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  bvh: FlatBvh,
  node: number
): boolean => {
  let near = 0
  let far = maxDistance
  for (let axis = 0; axis < 3; axis += 1) {
    const min = bvh.bounds[node * 6 + axis]
    const max = bvh.bounds[node * 6 + 3 + axis]
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < min || origin[axis] > max) return false
      continue
    }
    const inverse = 1 / direction[axis]
    let first = (min - origin[axis]) * inverse
    let second = (max - origin[axis]) * inverse
    if (first > second) [first, second] = [second, first]
    near = Math.max(near, first)
    far = Math.min(far, second)
    if (near > far) return false
  }
  return far >= 0 && near <= maxDistance
}

const rayTriangleDistance = (
  triangles: Float32Array,
  triangle: number,
  origin: Vec3,
  direction: Vec3
): number | null => {
  const ax = component(triangles, triangle, 0, 0)
  const ay = component(triangles, triangle, 0, 1)
  const az = component(triangles, triangle, 0, 2)
  const edge1: Vec3 = [
    component(triangles, triangle, 1, 0) - ax,
    component(triangles, triangle, 1, 1) - ay,
    component(triangles, triangle, 1, 2) - az
  ]
  const edge2: Vec3 = [
    component(triangles, triangle, 2, 0) - ax,
    component(triangles, triangle, 2, 1) - ay,
    component(triangles, triangle, 2, 2) - az
  ]
  const p: Vec3 = [
    direction[1] * edge2[2] - direction[2] * edge2[1],
    direction[2] * edge2[0] - direction[0] * edge2[2],
    direction[0] * edge2[1] - direction[1] * edge2[0]
  ]
  const determinant = edge1[0] * p[0] + edge1[1] * p[1] + edge1[2] * p[2]
  if (Math.abs(determinant) < 1e-9) return null

  const inverse = 1 / determinant
  const translated: Vec3 = [origin[0] - ax, origin[1] - ay, origin[2] - az]
  const u = (translated[0] * p[0] + translated[1] * p[1] + translated[2] * p[2]) * inverse
  if (u < 0 || u > 1) return null

  const q: Vec3 = [
    translated[1] * edge1[2] - translated[2] * edge1[1],
    translated[2] * edge1[0] - translated[0] * edge1[2],
    translated[0] * edge1[1] - translated[1] * edge1[0]
  ]
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inverse
  if (v < 0 || u + v > 1) return null

  const hit = (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse
  return hit >= 0 ? hit : null
}

export class GeometryMap {
  readonly mapName: string
  readonly sourceSha256: string
  readonly triangleCount: number
  private readonly triangles: Float32Array
  private readonly bvh: FlatBvh

  constructor(artifact: GeometryArtifact) {
    if (artifact.schemaVersion !== 1) throw new Error('Unsupported geometry schema version')
    if (!/^de_[a-z0-9_]+$/i.test(artifact.mapName)) throw new Error('Invalid geometry map name')
    if (!/^[a-f0-9]{64}$/i.test(artifact.sourceSha256)) {
      throw new Error('Geometry source SHA-256 is required')
    }
    if (artifact.coordinateSystem !== 'source2-hammer-units') {
      throw new Error('Geometry must use Source 2 Hammer coordinates')
    }
    if (!artifact.triangles.length || artifact.triangles.length % 9 !== 0) {
      throw new Error('Geometry triangles must contain complete XYZ triangle coordinates')
    }
    if (!artifact.triangles.every(Number.isFinite))
      throw new Error('Geometry contains non-finite values')

    this.mapName = artifact.mapName
    this.sourceSha256 = artifact.sourceSha256.toLowerCase()
    this.triangles = Float32Array.from(artifact.triangles)
    this.triangleCount = this.triangles.length / 9
    this.bvh = buildBvh(this.triangles, this.triangleCount)
  }

  firstIntersectionDistance(from: Vec3, to: Vec3): number | null {
    const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
    const maxDistance = Math.hypot(delta[0], delta[1], delta[2])
    if (maxDistance <= INTERSECTION_EPSILON) return null
    const direction: Vec3 = [delta[0] / maxDistance, delta[1] / maxDistance, delta[2] / maxDistance]
    let nearest = maxDistance
    let found = false
    const pending = [0]
    while (pending.length) {
      const node = pending.pop()!
      if (!segmentIntersectsBounds(from, direction, nearest, this.bvh, node)) continue
      if (this.bvh.count[node] > 0) {
        const end = this.bvh.start[node] + this.bvh.count[node]
        for (let offset = this.bvh.start[node]; offset < end; offset += 1) {
          const triangle = this.bvh.triangleIndices[offset]
          const hit = rayTriangleDistance(this.triangles, triangle, from, direction)
          if (hit !== null && hit > INTERSECTION_EPSILON && hit < nearest) {
            nearest = hit
            found = true
          }
        }
      } else {
        if (this.bvh.left[node] >= 0) pending.push(this.bvh.left[node])
        if (this.bvh.right[node] >= 0) pending.push(this.bvh.right[node])
      }
    }
    return found ? nearest : null
  }

  hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const targetDistance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const hit = this.firstIntersectionDistance(from, to)
    return hit === null || hit >= targetDistance - INTERSECTION_EPSILON
  }
}
