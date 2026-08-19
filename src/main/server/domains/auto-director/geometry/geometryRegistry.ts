import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { GeometryMap, type GeometryArtifact } from './geometryMap'

export type GeometryRegistryStatus = {
  mapName: string | null
  state: 'missing' | 'loaded' | 'error'
  triangleCount: number
  sourceSha256: string | null
  message: string
}

export class GeometryRegistry {
  private readonly cache = new Map<string, GeometryMap | null>()
  private status: GeometryRegistryStatus = {
    mapName: null,
    state: 'missing',
    triangleCount: 0,
    sourceSha256: null,
    message: 'No map requested'
  }

  constructor(private readonly artifactDirectory: string) {}

  load(mapName: string): GeometryMap | null {
    const normalized = mapName.toLowerCase()
    if (!/^de_[a-z0-9_]+$/.test(normalized)) {
      this.status = {
        mapName: normalized || null,
        state: 'error',
        triangleCount: 0,
        sourceSha256: null,
        message: `Invalid GSI map name: ${mapName || '(empty)'}`
      }
      return null
    }
    const cached = this.cache.get(normalized)
    if (cached !== undefined) {
      this.setStatus(normalized, cached)
      return cached
    }

    const artifactPath = path.join(this.artifactDirectory, `${normalized}.jgeo.json.gz`)
    if (!fs.existsSync(artifactPath)) {
      this.cache.set(normalized, null)
      this.status = {
        mapName: normalized,
        state: 'missing',
        triangleCount: 0,
        sourceSha256: null,
        message: `No geometry artifact for ${normalized}`
      }
      return null
    }

    try {
      const encoded = gunzipSync(fs.readFileSync(artifactPath)).toString('utf8')
      const artifact = JSON.parse(encoded) as GeometryArtifact
      if (artifact.mapName.toLowerCase() !== normalized) {
        throw new Error(
          `Artifact map ${artifact.mapName} does not match requested map ${normalized}`
        )
      }
      const geometry = new GeometryMap(artifact)
      this.cache.set(normalized, geometry)
      this.setStatus(normalized, geometry)
      return geometry
    } catch (error) {
      this.cache.set(normalized, null)
      this.status = {
        mapName: normalized,
        state: 'error',
        triangleCount: 0,
        sourceSha256: null,
        message: error instanceof Error ? error.message : String(error)
      }
      return null
    }
  }

  getStatus(): GeometryRegistryStatus {
    return { ...this.status }
  }

  private setStatus(mapName: string, geometry: GeometryMap | null): void {
    this.status = geometry
      ? {
          mapName,
          state: 'loaded',
          triangleCount: geometry.triangleCount,
          sourceSha256: geometry.sourceSha256,
          message: `${geometry.triangleCount.toLocaleString()} triangles loaded`
        }
      : {
          mapName,
          state: 'missing',
          triangleCount: 0,
          sourceSha256: null,
          message: `No geometry artifact for ${mapName}`
        }
  }
}
