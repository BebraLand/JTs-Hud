import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { TopologyMap, type TopologyArtifact } from './topologyMap'

export type TopologyRegistryStatus = {
  mapName: string | null
  state: 'missing' | 'loaded' | 'error'
  areaCount: number
  portalCount: number
  message: string
}

export class TopologyRegistry {
  private readonly cache = new Map<string, TopologyMap | null>()
  private status: TopologyRegistryStatus = {
    mapName: null,
    state: 'missing',
    areaCount: 0,
    portalCount: 0,
    message: 'No map requested'
  }

  constructor(private readonly artifactDirectory: string) {}

  load(mapName: string): TopologyMap | null {
    const normalized = mapName.toLowerCase()
    if (!/^de_[a-z0-9_]+$/.test(normalized)) {
      this.status = {
        mapName: normalized || null,
        state: 'error',
        areaCount: 0,
        portalCount: 0,
        message: `Invalid GSI map name: ${mapName || '(empty)'}`
      }
      return null
    }
    const cached = this.cache.get(normalized)
    if (cached !== undefined) {
      this.setStatus(normalized, cached)
      return cached
    }

    const artifactPath = path.join(this.artifactDirectory, `${normalized}.jtopo.json.gz`)
    if (!fs.existsSync(artifactPath)) {
      this.cache.set(normalized, null)
      this.status = {
        mapName: normalized,
        state: 'missing',
        areaCount: 0,
        portalCount: 0,
        message: `No topology artifact for ${normalized}`
      }
      return null
    }

    try {
      const artifact = JSON.parse(
        gunzipSync(fs.readFileSync(artifactPath)).toString('utf8')
      ) as TopologyArtifact
      if (artifact.mapName.toLowerCase() !== normalized) {
        throw new Error(
          `Artifact map ${artifact.mapName} does not match requested map ${normalized}`
        )
      }
      const topology = new TopologyMap(artifact)
      this.cache.set(normalized, topology)
      this.setStatus(normalized, topology)
      return topology
    } catch (error) {
      this.cache.set(normalized, null)
      this.status = {
        mapName: normalized,
        state: 'error',
        areaCount: 0,
        portalCount: 0,
        message: error instanceof Error ? error.message : String(error)
      }
      return null
    }
  }

  getStatus(): TopologyRegistryStatus {
    return { ...this.status }
  }

  private setStatus(mapName: string, topology: TopologyMap | null): void {
    this.status = topology
      ? {
          mapName,
          state: 'loaded',
          areaCount: topology.areaCount,
          portalCount: topology.portalCount,
          message: `${topology.areaCount.toLocaleString()} areas; ${topology.portalCount.toLocaleString()} portals loaded`
        }
      : {
          mapName,
          state: 'missing',
          areaCount: 0,
          portalCount: 0,
          message: `No topology artifact for ${mapName}`
        }
  }
}
