import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { normalizePlayers } from '../src/main/server/domains/auto-director/autoDirector.engine'
import type { GsiLikePayload } from '../src/main/server/domains/auto-director/autoDirector.types'
import {
  computeGeometryFeatures,
  hasPlayerLineOfSight
} from '../src/main/server/domains/auto-director/geometry/geometryFeatures'
import {
  GeometryMap,
  type GeometryArtifact
} from '../src/main/server/domains/auto-director/geometry/geometryMap'

type TimelineFrame = {
  tick: number
  atMs: number
  payload: GsiLikePayload
}

type Kill = {
  tick: number
  atMs: number
  attackerSteamId: string | null
  victimSteamId: string | null
}

type Timeline = {
  metadata: {
    map: string
    sourceSha256: string
    sampleTicks: number
    tickRate: number
  }
  frames: TimelineFrame[]
  kills: Kill[]
}

const [timelinePath, artifactPath, comparisonArtifactPath] = process.argv.slice(2)
if (!timelinePath || !artifactPath) {
  throw new Error(
    'Usage: npm run geometry:evaluate -- <timeline.json> <map.jgeo.json.gz> [comparison.jgeo.json.gz]'
  )
}

const timelineBytes = fs.readFileSync(timelinePath)
const timeline = JSON.parse(
  (timelinePath.endsWith('.gz') ? gunzipSync(timelineBytes) : timelineBytes).toString('utf8')
) as Timeline
const artifact = JSON.parse(
  gunzipSync(fs.readFileSync(artifactPath)).toString('utf8')
) as GeometryArtifact
const geometry = new GeometryMap(artifact)
const comparisonGeometry = comparisonArtifactPath
  ? new GeometryMap(
      JSON.parse(
        gunzipSync(fs.readFileSync(comparisonArtifactPath)).toString('utf8')
      ) as GeometryArtifact
    )
  : null
if (timeline.metadata.map !== geometry.mapName) {
  throw new Error(`Timeline map ${timeline.metadata.map} does not match ${geometry.mapName}`)
}
if (comparisonGeometry && comparisonGeometry.mapName !== geometry.mapName) {
  throw new Error(`Comparison map ${comparisonGeometry.mapName} does not match ${geometry.mapName}`)
}

const frameAtOrBefore = (tick: number): TimelineFrame | null => {
  let low = 0
  let high = timeline.frames.length - 1
  let result: TimelineFrame | null = null
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const frame = timeline.frames[middle]
    if (frame.tick <= tick) {
      result = frame
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}

const offsetsMs = [0, 250, 500, 1000, 2000]
const visibleAtOffset = new Map(offsetsMs.map((offset) => [offset, { visible: 0, eligible: 0 }]))
const endpointProfiles = {
  standing: { visible: 0, eligible: 0 },
  crouchCompatible: { visible: 0, eligible: 0 }
}
const killRayDisagreement = new Map(
  offsetsMs.map((offset) => [
    offset,
    { eligible: 0, disagree: 0, primaryVisibleOnly: 0, comparisonVisibleOnly: 0 }
  ])
)
const blockedKillSamples: object[] = []
for (const kill of timeline.kills) {
  if (!kill.attackerSteamId || !kill.victimSteamId) continue
  for (const offsetMs of offsetsMs) {
    const tickOffset = Math.round((offsetMs / 1000) * timeline.metadata.tickRate)
    const frame = frameAtOrBefore(kill.tick - tickOffset)
    if (!frame) continue
    const players = normalizePlayers(frame.payload)
    const attacker = players.find((player) => player.steamId === kill.attackerSteamId)
    const victim = players.find((player) => player.steamId === kill.victimSteamId)
    if (!attacker?.position || !victim?.position) continue
    const metric = visibleAtOffset.get(offsetMs)!
    metric.eligible += 1
    const visible = hasPlayerLineOfSight(geometry, attacker, victim)
    if (visible) metric.visible += 1
    if (comparisonGeometry) {
      const comparisonVisible = hasPlayerLineOfSight(comparisonGeometry, attacker, victim)
      const disagreement = killRayDisagreement.get(offsetMs)!
      disagreement.eligible += 1
      if (visible !== comparisonVisible) {
        disagreement.disagree += 1
        if (visible) disagreement.primaryVisibleOnly += 1
        else disagreement.comparisonVisibleOnly += 1
      }
    }
    if (offsetMs === 0) {
      const point = (height: number) =>
        [victim.position![0], victim.position![1], victim.position![2] + height] as const
      const origin = (height: number) =>
        [attacker.position![0], attacker.position![1], attacker.position![2] + height] as const
      endpointProfiles.standing.eligible += 1
      endpointProfiles.crouchCompatible.eligible += 1
      if ([64, 48].some((height) => geometry.hasLineOfSight(origin(64), point(height)))) {
        endpointProfiles.standing.visible += 1
      }
      if (
        [64, 46].some((observerHeight) =>
          [64, 48, 36].some((targetHeight) =>
            geometry.hasLineOfSight(origin(observerHeight), point(targetHeight))
          )
        )
      ) {
        endpointProfiles.crouchCompatible.visible += 1
      }
    }
    if (!visible && offsetMs === 0 && blockedKillSamples.length < 5) {
      const from = [attacker.position[0], attacker.position[1], attacker.position[2] + 64] as const
      const to = [victim.position[0], victim.position[1], victim.position[2] + 64] as const
      blockedKillSamples.push({
        attacker: attacker.name,
        victim: victim.name,
        from,
        to,
        targetDistance: Math.round(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])),
        firstHitDistance: geometry.firstIntersectionDistance(from, to)
      })
    }
  }
}

let playerFrames = 0
let playerFramesWithVisibleEnemy = 0
let visibleEnemyTotal = 0
let featureComparisonFrames = 0
let visibleCountMismatches = 0
let nearestVisibleMismatches = 0
const startedAt = performance.now()
for (const frame of timeline.frames) {
  const players = normalizePlayers(frame.payload)
  const features = computeGeometryFeatures(players, geometry)
  const comparisonFeatures = comparisonGeometry
    ? computeGeometryFeatures(players, comparisonGeometry)
    : null
  for (const player of players.filter((candidate) => candidate.alive)) {
    const feature = features.get(player.steamId)
    if (!feature) continue
    playerFrames += 1
    visibleEnemyTotal += feature.visibleEnemyCount
    if (feature.visibleEnemyCount > 0) playerFramesWithVisibleEnemy += 1
    const comparisonFeature = comparisonFeatures?.get(player.steamId)
    if (comparisonFeature) {
      featureComparisonFrames += 1
      if (feature.visibleEnemyCount !== comparisonFeature.visibleEnemyCount) {
        visibleCountMismatches += 1
      }
      if (feature.nearestVisibleEnemySteamId !== comparisonFeature.nearestVisibleEnemySteamId) {
        nearestVisibleMismatches += 1
      }
    }
  }
}
const queryElapsedMs = performance.now() - startedAt

const percentage = (value: number, total: number): number =>
  total ? Math.round((value / total) * 1000) / 10 : 0

console.log(
  JSON.stringify(
    {
      timeline: timelinePath,
      demoSha256: timeline.metadata.sourceSha256,
      geometry: {
        path: artifactPath,
        sourceSha256: geometry.sourceSha256,
        triangles: geometry.triangleCount
      },
      killPairLineOfSight: Object.fromEntries(
        offsetsMs.map((offsetMs) => {
          const metric = visibleAtOffset.get(offsetMs)!
          return [
            offsetMs === 0 ? 'atKill' : `${offsetMs}msBefore`,
            {
              visible: metric.visible,
              eligible: metric.eligible,
              percentage: percentage(metric.visible, metric.eligible)
            }
          ]
        })
      ),
      blockedKillSamples,
      endpointProfiles: Object.fromEntries(
        Object.entries(endpointProfiles).map(([name, metric]) => [
          name,
          {
            ...metric,
            percentage: percentage(metric.visible, metric.eligible)
          }
        ])
      ),
      comparison: comparisonGeometry
        ? {
            geometry: {
              path: comparisonArtifactPath,
              sourceSha256: comparisonGeometry.sourceSha256,
              triangles: comparisonGeometry.triangleCount
            },
            killRayDisagreement: Object.fromEntries(
              offsetsMs.map((offsetMs) => {
                const metric = killRayDisagreement.get(offsetMs)!
                return [
                  offsetMs === 0 ? 'atKill' : `${offsetMs}msBefore`,
                  {
                    ...metric,
                    percentage: percentage(metric.disagree, metric.eligible)
                  }
                ]
              })
            ),
            playerFrameFeatureDisagreement: {
              eligible: featureComparisonFrames,
              visibleCountMismatches,
              visibleCountMismatchPercentage: percentage(
                visibleCountMismatches,
                featureComparisonFrames
              ),
              nearestVisibleMismatches,
              nearestVisibleMismatchPercentage: percentage(
                nearestVisibleMismatches,
                featureComparisonFrames
              )
            }
          }
        : null,
      frameDistribution: {
        sampledFrames: timeline.frames.length,
        livingPlayerFrames: playerFrames,
        withVisibleEnemy: playerFramesWithVisibleEnemy,
        withVisibleEnemyPercentage: percentage(playerFramesWithVisibleEnemy, playerFrames),
        meanVisibleEnemies:
          playerFrames > 0 ? Math.round((visibleEnemyTotal / playerFrames) * 1000) / 1000 : 0
      },
      runtime: {
        totalMs: Math.round(queryElapsedMs * 10) / 10,
        meanFrameMs:
          timeline.frames.length > 0
            ? Math.round((queryElapsedMs / timeline.frames.length) * 1000) / 1000
            : 0
      }
    },
    null,
    2
  )
)
