import fs from 'node:fs'
import path from 'node:path'
import type { Vec3 } from '../geometry/geometryMap'

const MAP_PATTERN = /^de_[a-z0-9_]+$/
const MANIFEST_SCHEMA_VERSION = 2
const MAP_MANIFEST_SCHEMA_VERSION = 1

export type AerialCameraKind = 'spawn' | 'mid' | 'route' | 'site' | 'postplant' | 'custom'

export interface AerialCameraAnchor {
  id: string
  label: string
  kind: AerialCameraKind
  position: Vec3
  angles: Vec3
  notes?: string
}

export interface AerialCameraMap {
  mapName: string
  anchors: AerialCameraAnchor[]
}

export interface AerialCameraRegistryStatus {
  mapName: string | null
  state: 'missing' | 'loaded' | 'error'
  anchorCount: number
  message: string
}

interface RawAerialManifest {
  schemaVersion?: unknown
  coordinateSystem?: unknown
  source?: unknown
  maps?: Record<string, unknown>
}

interface RawMapManifest {
  schemaVersion?: unknown
  map?: unknown
  coordinateSystem?: unknown
  source?: unknown
  anchors?: Record<string, unknown>
}

const normalizeMapName = (value: unknown): string | null => {
  const mapName = String(value ?? '')
    .trim()
    .toLowerCase()
  return MAP_PATTERN.test(mapName) ? mapName : null
}

const finiteVec3 = (value: unknown): Vec3 | null => {
  if (!Array.isArray(value) || value.length !== 3) return null
  const numbers = value.map(Number)
  return numbers.every(Number.isFinite) ? (numbers as unknown as Vec3) : null
}

const parseAnchor = (id: string, value: unknown): AerialCameraAnchor | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const anchorId = String(raw.id ?? id).trim()
  const label = String(raw.label ?? anchorId).trim()
  const position = finiteVec3(raw.position)
  const angles = finiteVec3(raw.angles)
  const kind = String(raw.kind ?? 'custom') as AerialCameraKind
  if (!/^[a-z0-9_-]{1,64}$/i.test(anchorId) || !label || !position || !angles) return null
  if (!['spawn', 'mid', 'route', 'site', 'postplant', 'custom'].includes(kind)) return null
  return {
    id: anchorId,
    label: label.slice(0, 96),
    kind,
    position,
    angles,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 500) : undefined
  }
}

const parseManifest = (input: unknown): Map<string, AerialCameraMap> => {
  if (!input || typeof input !== 'object') throw new Error('Aerial manifest must be an object')
  const manifest = input as RawAerialManifest
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported Aerial manifest schema: ${String(manifest.schemaVersion)}`)
  }
  if (manifest.coordinateSystem !== 'source2-hammer-units') {
    throw new Error('Aerial manifest must use source2-hammer-units')
  }
  if (manifest.source !== 'cs2-netcon-getpos') {
    throw new Error('Aerial manifest must be captured through CS2 NetCon getpos')
  }
  if (!manifest.maps || typeof manifest.maps !== 'object') {
    throw new Error('Aerial manifest is missing maps')
  }

  const maps = new Map<string, AerialCameraMap>()
  for (const [mapKey, rawMap] of Object.entries(manifest.maps)) {
    if (!rawMap || typeof rawMap !== 'object') continue
    const map = rawMap as RawMapManifest
    const mapName = normalizeMapName(map.map ?? mapKey)
    if (!mapName || mapName !== normalizeMapName(mapKey)) continue
    if (map.schemaVersion !== MAP_MANIFEST_SCHEMA_VERSION) continue
    if (map.coordinateSystem !== 'source2-hammer-units' || map.source !== 'cs2-netcon-getpos')
      continue
    const anchors = Object.entries(map.anchors ?? {})
      .map(([id, anchor]) => parseAnchor(id, anchor))
      .filter((anchor): anchor is AerialCameraAnchor => anchor !== null)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (anchors.length) maps.set(mapName, { mapName, anchors })
  }
  return maps
}

/** Loads user-calibrated Aerial anchors. Invalid/incomplete anchors are ignored safely. */
export class AerialCameraRegistry {
  private maps: Map<string, AerialCameraMap> | null = null
  private status: AerialCameraRegistryStatus = {
    mapName: null,
    state: 'missing',
    anchorCount: 0,
    message: 'Aerial camera manifest not loaded'
  }

  constructor(private readonly directory: string) {}

  load(mapNameInput: string): AerialCameraMap | null {
    const mapName = normalizeMapName(mapNameInput)
    if (!mapName) {
      this.status = {
        mapName: null,
        state: 'error',
        anchorCount: 0,
        message: `Invalid Aerial map name: ${String(mapNameInput)}`
      }
      return null
    }
    if (!this.maps) {
      const manifestPath = path.join(this.directory, 'jts-aerial-anchors.json')
      if (!fs.existsSync(manifestPath)) {
        this.status = {
          mapName,
          state: 'missing',
          anchorCount: 0,
          message: `Aerial manifest not found: ${manifestPath}`
        }
        return null
      }
      try {
        this.maps = parseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
      } catch (error) {
        this.status = {
          mapName,
          state: 'error',
          anchorCount: 0,
          message: error instanceof Error ? error.message : String(error)
        }
        return null
      }
    }
    const map = this.maps.get(mapName) ?? null
    this.status = map
      ? {
          mapName,
          state: 'loaded',
          anchorCount: map.anchors.length,
          message: `${map.anchors.length} calibrated Aerial anchors loaded`
        }
      : {
          mapName,
          state: 'missing',
          anchorCount: 0,
          message: `No calibrated Aerial anchors for ${mapName}`
        }
    return map
  }

  getStatus(): AerialCameraRegistryStatus {
    return { ...this.status }
  }
}
