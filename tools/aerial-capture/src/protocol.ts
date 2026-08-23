import { isDeepStrictEqual } from 'node:util'

export type Vec3 = [number, number, number]

export interface CameraPose {
  position: Vec3
  angles: Vec3
}

export interface AerialAnchor {
  name: string
  label: string
  kind: 'spawn' | 'mid' | 'site' | 'route' | 'postplant' | 'custom'
  required: boolean
  hint: string
  position?: Vec3
  angles?: Vec3
  capturedAt?: string
  source?: 'cs2-netcon-getpos'
  raw?: string
  notes?: string
}

export interface AerialManifest {
  schemaVersion: 1
  map: string
  coordinateSystem: 'source2-hammer-units'
  source: 'cs2-netcon-getpos'
  anchors: Record<string, AerialAnchor>
}

const NUMBER = '(-?\\d+(?:\\.\\d+)?)'
const GETPOS_PATTERN = new RegExp(
  `setpos(?:_exact)?\\s+${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s*;?\\s*setang(?:_exact)?\\s+${NUMBER}\\s+${NUMBER}\\s+${NUMBER}`,
  'i'
)

export const normalizeAnchorName = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
  if (!normalized || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(
      'Anchor name must start with a-z or 0-9 and contain only a-z, 0-9, underscore, or hyphen.'
    )
  }
  return normalized
}

export const parseGetposOutput = (text: string): CameraPose | null => {
  const match = text.match(GETPOS_PATTERN)
  if (!match) return null

  const values = match.slice(1).map(Number)
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) return null

  return {
    position: [values[0], values[1], values[2]],
    angles: [values[3], values[4], values[5]]
  }
}

export const createManifest = (
  map: string,
  specs: Array<Omit<AerialAnchor, 'position' | 'angles' | 'capturedAt' | 'source'>> = []
): AerialManifest => ({
  schemaVersion: 1,
  map: map.trim(),
  coordinateSystem: 'source2-hammer-units',
  source: 'cs2-netcon-getpos',
  anchors: Object.fromEntries(specs.map((spec) => [spec.name, spec]))
})

export const createAnchorSpec = (
  name: string,
  label: string,
  kind: AerialAnchor['kind'],
  required: boolean,
  hint: string
): Omit<AerialAnchor, 'position' | 'angles' | 'capturedAt' | 'source'> => ({
  name: normalizeAnchorName(name),
  label,
  kind,
  required,
  hint
})

export const upsertAnchor = (
  manifest: AerialManifest,
  name: string,
  pose: CameraPose,
  raw?: string,
  notes?: string
): AerialManifest => {
  const anchorName = normalizeAnchorName(name)
  const next: AerialManifest = {
    ...manifest,
    anchors: {
      ...manifest.anchors,
      [anchorName]: {
        name: anchorName,
        label: manifest.anchors[anchorName]?.label ?? anchorName,
        kind: manifest.anchors[anchorName]?.kind ?? 'custom',
        required: manifest.anchors[anchorName]?.required ?? false,
        hint: manifest.anchors[anchorName]?.hint ?? 'Manual observer camera anchor',
        position: pose.position,
        angles: pose.angles,
        capturedAt: new Date().toISOString(),
        source: 'cs2-netcon-getpos',
        ...(raw ? { raw } : {}),
        ...(notes ? { notes } : {})
      }
    }
  }

  if (isDeepStrictEqual(next.anchors[anchorName].position, pose.position) === false) {
    throw new Error(`Failed to store anchor ${anchorName}`)
  }

  return next
}

export const manifestToJson = (manifest: AerialManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`
