import type { Vec3 } from '../geometry/geometryMap'

export type TopologyRouteClass =
  | 'site_a'
  | 'site_b'
  | 'spawn'
  | 'mid'
  | 'long'
  | 'short'
  | 'lane'
  | 'tunnel'
  | 'elevated'
  | 'area'

export type TopologyPlantSite = 'site_a' | 'site_b'

export interface TopologyAreaArtifact {
  id: number
  center: Vec3
  bounds: readonly [number, number, number, number, number, number]
  neighbors: number[]
  callout: string | null
  calloutConfidence: number
  routeClasses: TopologyRouteClass[]
  tacticalRoles?: string[]
}

export interface TopologyPortalArtifact {
  id: string
  from: number
  to: number
  center: Vec3
  width: number
  orientation: 'horizontal' | 'vertical'
  normal: readonly [number, number]
  vertical: boolean
  chokepoint?: boolean
}

export const plantSiteForArea = (area: TopologyAreaArtifact): TopologyPlantSite | null =>
  area.routeClasses.includes('site_a')
    ? 'site_a'
    : area.routeClasses.includes('site_b')
      ? 'site_b'
      : null

export const tacticalRolesForArea = (area: TopologyAreaArtifact): string[] =>
  Array.from(
    new Set([
      ...area.routeClasses,
      ...(area.tacticalRoles ?? []),
      ...(plantSiteForArea(area) ? ['plant_zone'] : [])
    ])
  )

export interface TopologyArtifact {
  schemaVersion: 1
  mapName: string
  coordinateSystem: 'source2-hammer-units'
  source: {
    navigationSha256: string
    calloutSha256: string
    navigationBuildId?: string
    sourceFormat?: string
  }
  bounds: readonly [number, number, number, number, number, number]
  areas: TopologyAreaArtifact[]
  portals: TopologyPortalArtifact[]
}

export interface TopologyPath {
  distance: number
  areaIds: number[]
  portalIds: string[]
}

type HeapNode = { id: number; distance: number }

const distance3d = (left: Vec3, right: Vec3): number =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])

const pushHeap = (heap: HeapNode[], value: HeapNode): void => {
  heap.push(value)
  let index = heap.length - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (heap[parent].distance <= value.distance) break
    heap[index] = heap[parent]
    index = parent
  }
  heap[index] = value
}

const popHeap = (heap: HeapNode[]): HeapNode | undefined => {
  if (heap.length === 0) return undefined
  const first = heap[0]
  const last = heap.pop()!
  if (heap.length > 0) {
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= heap.length) break
      const child = right < heap.length && heap[right].distance < heap[left].distance ? right : left
      if (heap[child].distance >= last.distance) break
      heap[index] = heap[child]
      index = child
    }
    heap[index] = last
  }
  return first
}

export class TopologyMap {
  readonly mapName: string
  readonly source: TopologyArtifact['source']
  readonly areaCount: number
  readonly portalCount: number
  private readonly areas = new Map<number, TopologyAreaArtifact>()
  private readonly portals = new Map<string, TopologyPortalArtifact>()
  private readonly portalsByArea = new Map<number, TopologyPortalArtifact[]>()

  constructor(artifact: TopologyArtifact) {
    if (artifact.schemaVersion !== 1) throw new Error('Unsupported topology schema version')
    if (!/^de_[a-z0-9_]+$/i.test(artifact.mapName)) throw new Error('Invalid topology map name')
    if (artifact.coordinateSystem !== 'source2-hammer-units') {
      throw new Error('Topology must use Source 2 Hammer coordinates')
    }
    if (!/^[a-f0-9]{64}$/i.test(artifact.source.navigationSha256)) {
      throw new Error('Topology navigation source SHA-256 is required')
    }
    if (!/^[a-f0-9]{64}$/i.test(artifact.source.calloutSha256)) {
      throw new Error('Topology callout source SHA-256 is required')
    }
    if (!artifact.areas.length) throw new Error('Topology must contain areas')

    this.mapName = artifact.mapName.toLowerCase()
    this.source = artifact.source
    for (const area of artifact.areas) {
      if (!Number.isInteger(area.id) || !area.neighbors.every(Number.isInteger)) {
        throw new Error('Topology area ids must be integers')
      }
      if (!area.center.every(Number.isFinite) || !area.bounds.every(Number.isFinite)) {
        throw new Error('Topology area contains non-finite coordinates')
      }
      this.areas.set(area.id, area)
    }
    for (const portal of artifact.portals) {
      if (!this.areas.has(portal.from) || !this.areas.has(portal.to)) continue
      if (!Number.isFinite(portal.width) || portal.width <= 0) continue
      this.portals.set(portal.id, portal)
      for (const areaId of [portal.from, portal.to]) {
        const entries = this.portalsByArea.get(areaId) ?? []
        entries.push(portal)
        this.portalsByArea.set(areaId, entries)
      }
    }
    this.areaCount = this.areas.size
    this.portalCount = this.portals.size
  }

  getArea(areaId: number | null): TopologyAreaArtifact | null {
    return areaId === null ? null : (this.areas.get(areaId) ?? null)
  }

  getPortal(portalId: string | null): TopologyPortalArtifact | null {
    return portalId ? (this.portals.get(portalId) ?? null) : null
  }

  getPortalsForArea(areaId: number): TopologyPortalArtifact[] {
    return this.portalsByArea.get(areaId) ?? []
  }

  getAreaTacticalRoles(areaId: number | null): string[] {
    const area = this.getArea(areaId)
    return area ? tacticalRolesForArea(area) : []
  }

  getAreaPlantSite(areaId: number | null): TopologyPlantSite | null {
    const area = this.getArea(areaId)
    return area ? plantSiteForArea(area) : null
  }

  isChokepoint(portal: TopologyPortalArtifact | null): boolean {
    if (!portal) return false
    if (portal.chokepoint === true) return true
    const connectedAreas = new Set([portal.from, portal.to])
    const localPortals = [...this.portals.values()].filter((candidate) =>
      [candidate.from, candidate.to].some((areaId) => connectedAreas.has(areaId))
    )
    return portal.width <= 192 || localPortals.length <= 3
  }

  findNearestArea(position: Vec3): TopologyAreaArtifact | null {
    let best: TopologyAreaArtifact | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const area of this.areas.values()) {
      const [minX, minY, maxX, maxY, minZ, maxZ] = area.bounds
      const verticalGap =
        position[2] < minZ ? minZ - position[2] : position[2] > maxZ ? position[2] - maxZ : 0
      if (verticalGap > 192) continue
      const dx =
        position[0] < minX ? minX - position[0] : position[0] > maxX ? position[0] - maxX : 0
      const dy =
        position[1] < minY ? minY - position[1] : position[1] > maxY ? position[1] - maxY : 0
      const score = dx * dx + dy * dy + verticalGap * verticalGap * 2.25
      if (score < bestScore) {
        best = area
        bestScore = score
      }
    }
    if (best) return best
    for (const area of this.areas.values()) {
      const score = distance3d(position, area.center)
      if (score < bestScore) {
        best = area
        bestScore = score
      }
    }
    return best
  }

  findNearestEnemyPath(startAreaId: number | null, targetAreaIds: number[]): TopologyPath | null {
    if (startAreaId === null || !this.areas.has(startAreaId) || targetAreaIds.length === 0)
      return null
    const targets = new Set(targetAreaIds.filter((id) => this.areas.has(id)))
    if (!targets.size) return null
    const distances = new Map<number, number>([[startAreaId, 0]])
    const previous = new Map<number, { areaId: number; portalId: string | null }>()
    const heap: HeapNode[] = []
    pushHeap(heap, { id: startAreaId, distance: 0 })
    while (heap.length) {
      const current = popHeap(heap)!
      if (current.distance !== distances.get(current.id)) continue
      if (targets.has(current.id)) {
        const areaIds = [current.id]
        const portalIds: string[] = []
        let cursor = current.id
        while (previous.has(cursor)) {
          const step = previous.get(cursor)!
          areaIds.push(step.areaId)
          if (step.portalId) portalIds.push(step.portalId)
          cursor = step.areaId
        }
        areaIds.reverse()
        portalIds.reverse()
        return { distance: current.distance, areaIds, portalIds }
      }
      const area = this.areas.get(current.id)!
      for (const neighborId of area.neighbors) {
        const neighbor = this.areas.get(neighborId)
        if (!neighbor) continue
        const portal = this.getPortalsForArea(current.id).find(
          (candidate) => candidate.from === neighborId || candidate.to === neighborId
        )
        const weight = distance3d(area.center, neighbor.center) + (portal?.vertical ? 64 : 0)
        const nextDistance = current.distance + Math.max(32, weight)
        if (nextDistance >= (distances.get(neighborId) ?? Number.POSITIVE_INFINITY)) continue
        distances.set(neighborId, nextDistance)
        previous.set(neighborId, { areaId: current.id, portalId: portal?.id ?? null })
        pushHeap(heap, { id: neighborId, distance: nextDistance })
      }
    }
    return null
  }
}
