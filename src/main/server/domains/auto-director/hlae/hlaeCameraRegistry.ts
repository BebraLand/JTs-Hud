import fs from 'node:fs'
import path from 'node:path'
import type { Vec3 } from '../geometry/geometryMap'

const MAP_PATTERN = /^de_[a-z0-9_]+$/
const POINT_TAG_PATTERN = /<p\b[^>]*\/?\s*>/gi
const ATTRIBUTE_PATTERN = /\b([a-z]+)="(-?\d+(?:\.\d+)?)/gi

export type HlaeCameraKind = 'spawn' | 'mid' | 'route' | 'site' | 'postplant' | 'custom'

export interface HlaeCameraPoint {
  time: number
  position: Vec3
  angles: Vec3
  fov: number
}

export interface HlaeCameraPath {
  id: string
  label: string
  kind: HlaeCameraKind
  fileName: string
  sourcePath: string
  startTime: number
  endTime: number
  durationSeconds: number
  points: HlaeCameraPoint[]
}

export interface HlaeCameraMap {
  mapName: string
  paths: HlaeCameraPath[]
}

export interface HlaeCameraRegistryStatus {
  mapName: string | null
  state: 'missing' | 'loaded' | 'error'
  pathCount: number
  message: string
  paths: Array<Pick<HlaeCameraPath, 'id' | 'label' | 'kind' | 'durationSeconds'>>
}

const normalizeMapName = (value: unknown): string | null => {
  const mapName = String(value ?? '')
    .trim()
    .toLowerCase()
  return MAP_PATTERN.test(mapName) ? mapName : null
}

const inferKind = (value: string): HlaeCameraKind => {
  const name = value.toLowerCase()
  if (name.includes('spawn')) return 'spawn'
  if (name.includes('mid')) return 'mid'
  if (name.includes('site')) return 'site'
  if (name.includes('post')) return 'postplant'
  if (name.includes('long') || name.includes('short') || name.includes('main')) return 'route'
  return 'custom'
}

const prettifyLabel = (value: string): string =>
  value
    .replace(/\.xml$/i, '')
    .replace(/^[a-z0-9]+[_-]/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

const parsePoint = (tag: string): HlaeCameraPoint | null => {
  const attributes = new Map<string, number>()
  for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
    attributes.set(match[1].toLowerCase(), Number(match[2]))
  }
  const values = ['t', 'x', 'y', 'z', 'rx', 'ry', 'rz'].map((key) => attributes.get(key))
  if (values.some((value) => !Number.isFinite(value))) return null
  return {
    time: values[0]!,
    position: [values[1]!, values[2]!, values[3]!],
    // HLAE Source 2 campaths store heading in rz. Keep the app-wide
    // pitch/yaw/roll convention used by Camera Debug: [rx, rz, ry].
    angles: [values[4]!, values[6]!, values[5]!],
    fov: Number.isFinite(attributes.get('fov')) ? attributes.get('fov')! : 90
  }
}

const parsePath = (directory: string, fileName: string): HlaeCameraPath | null => {
  const sourcePath = path.join(directory, fileName)
  const content = fs.readFileSync(sourcePath, 'utf8')
  const points = [...content.matchAll(POINT_TAG_PATTERN)]
    .map((match) => parsePoint(match[0]))
    .filter((point): point is HlaeCameraPoint => point !== null)
    .sort((left, right) => left.time - right.time)
  if (points.length < 2) return null
  const startTime = points[0].time
  const endTime = points[points.length - 1].time
  const id = fileName.replace(/\.xml$/i, '').toLowerCase()
  return {
    id,
    label: prettifyLabel(fileName),
    kind: inferKind(fileName),
    fileName,
    sourcePath,
    startTime,
    endTime,
    durationSeconds: Math.max(0.1, endTime - startTime),
    points
  }
}

const lerp = (left: number, right: number, amount: number): number => left + (right - left) * amount

const lerpAngle = (left: number, right: number, amount: number): number => {
  const delta = ((right - left + 540) % 360) - 180
  return left + delta * amount
}

export const getHlaeCameraPose = (
  pathEntry: HlaeCameraPath,
  elapsedSeconds: number,
  durationSeconds = pathEntry.durationSeconds
): { position: Vec3; angles: Vec3; fov: number; progress: number } => {
  const progress = Math.min(1, Math.max(0, elapsedSeconds / Math.max(0.1, durationSeconds)))
  const sourceTime = pathEntry.startTime + progress * pathEntry.durationSeconds
  const nextIndex = pathEntry.points.findIndex((point) => point.time >= sourceTime)
  if (nextIndex <= 0) {
    const point = pathEntry.points[0]
    return { position: point.position, angles: point.angles, fov: point.fov, progress }
  }
  if (nextIndex < 0) {
    const point = pathEntry.points[pathEntry.points.length - 1]
    return { position: point.position, angles: point.angles, fov: point.fov, progress }
  }
  const left = pathEntry.points[nextIndex - 1]
  const right = pathEntry.points[nextIndex]
  const amount = (sourceTime - left.time) / Math.max(0.001, right.time - left.time)
  return {
    position: [
      lerp(left.position[0], right.position[0], amount),
      lerp(left.position[1], right.position[1], amount),
      lerp(left.position[2], right.position[2], amount)
    ],
    angles: [
      lerp(left.angles[0], right.angles[0], amount),
      lerpAngle(left.angles[1], right.angles[1], amount),
      lerp(left.angles[2], right.angles[2], amount)
    ],
    fov: lerp(left.fov, right.fov, amount),
    progress
  }
}

const parseMap = (mapName: string, directory: string): HlaeCameraMap => {
  const paths = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xml'))
    .map((entry) => {
      try {
        return parsePath(directory, entry.name)
      } catch {
        return null
      }
    })
    .filter((value): value is HlaeCameraPath => value !== null)
    .sort((left, right) => left.id.localeCompare(right.id))
  return { mapName, paths }
}

export class HlaeCameraRegistry {
  private maps: Map<string, HlaeCameraMap> | null = null
  private cursors = new Map<string, number>()
  private status: HlaeCameraRegistryStatus = {
    mapName: null,
    state: 'missing',
    pathCount: 0,
    message: 'HLAE camera paths not loaded',
    paths: []
  }

  constructor(private readonly directory: string) {}

  load(mapNameInput: string): HlaeCameraMap | null {
    const mapName = normalizeMapName(mapNameInput)
    if (!mapName) {
      this.status = {
        mapName: null,
        state: 'error',
        pathCount: 0,
        message: `Invalid HLAE map name: ${String(mapNameInput)}`,
        paths: []
      }
      return null
    }
    if (!this.maps) {
      this.maps = new Map()
      try {
        for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
          if (!entry.isDirectory() || !normalizeMapName(entry.name)) continue
          const mapDirectory = path.join(this.directory, entry.name)
          this.maps.set(entry.name.toLowerCase(), parseMap(entry.name.toLowerCase(), mapDirectory))
        }
      } catch (error) {
        this.status = {
          mapName,
          state: 'error',
          pathCount: 0,
          message: error instanceof Error ? error.message : String(error),
          paths: []
        }
        return null
      }
    }
    const map = this.maps.get(mapName) ?? null
    this.status = {
      mapName,
      state: map?.paths.length ? 'loaded' : 'missing',
      pathCount: map?.paths.length ?? 0,
      message: map?.paths.length
        ? `${map.paths.length} HLAE campath(s) loaded`
        : `No HLAE campaths for ${mapName}`,
      paths: (map?.paths ?? []).map(({ id, label, kind, durationSeconds }) => ({
        id,
        label,
        kind,
        durationSeconds
      }))
    }
    return map
  }

  next(mapName: string): HlaeCameraPath | null {
    const map = this.load(mapName)
    if (!map?.paths.length) return null
    const cursor = this.cursors.get(map.mapName) ?? 0
    const pathEntry = map.paths[cursor % map.paths.length]
    this.cursors.set(map.mapName, cursor + 1)
    return pathEntry
  }

  getStatus(): HlaeCameraRegistryStatus {
    return { ...this.status, paths: this.status.paths.map((pathEntry) => ({ ...pathEntry })) }
  }
}
