import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  AutoDirectorEngine,
  normalizePlayers,
  type ScoreAdvisory
} from '../src/main/server/domains/auto-director/autoDirector.engine'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import { buildAutoDirectorMlFeatures } from '../src/main/server/domains/auto-director/autoDirector.mlFeatures'
import {
  LightGbmRanker,
  loadLightGbmRanker
} from '../src/main/server/domains/auto-director/autoDirector.ml'
import { GeometryRegistry } from '../src/main/server/domains/auto-director/geometry/geometryRegistry'
import type { GeometryMap } from '../src/main/server/domains/auto-director/geometry/geometryMap'
import { computeGeometryFeatures } from '../src/main/server/domains/auto-director/geometry/geometryFeatures'
import { AerialCameraRegistry } from '../src/main/server/domains/auto-director/aerial/aerialCameraRegistry'
import { decideAerialPresentation } from '../src/main/server/domains/auto-director/aerial/aerialPresentation'
import { TopologyRegistry } from '../src/main/server/domains/auto-director/topology/topologyRegistry'
import type { TopologyMap } from '../src/main/server/domains/auto-director/topology/topologyMap'
import { computeTopologyFeatures } from '../src/main/server/domains/auto-director/topology/topologyFeatures'
import type {
  AutoDirectorMode,
  AutoDirectorSettings,
  GsiLikePayload
} from '../src/main/server/domains/auto-director/autoDirector.types'

interface ReplayFrame {
  tick: number
  atMs: number
  round: number
  payload: GsiLikePayload
}

interface ReplayKill {
  tick: number
  atMs: number
  attackerSteamId: string | null
  victimSteamId: string | null
}

interface ReplayTimeline {
  metadata: {
    sourceFile: string
    sourceSha256: string
    map: string
    sampleIntervalMs: number
    rounds: number
  }
  frames: ReplayFrame[]
  kills: ReplayKill[]
}

interface CameraSample {
  atMs: number
  round: number
  targetSteamId: string | null
  alive: boolean
  objectiveActorSteamId: string | null
}

interface AerialEligibilitySample {
  eligible: boolean
  anchorId: string | null
  actionBlocked: boolean
}

const percentage = (hits: number, total: number): number =>
  total > 0 ? Number(((hits / total) * 100).toFixed(1)) : 0

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

const sampleAt = (samples: CameraSample[], atMs: number): CameraSample | undefined => {
  let low = 0
  let high = samples.length - 1
  let result: CameraSample | undefined
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (samples[middle].atMs <= atMs) {
      result = samples[middle]
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}

interface HybridConfig {
  ranker: LightGbmRanker | null
  geometry: GeometryMap | null
  topology: TopologyMap | null
  geometryEnabled: boolean
  mlEnabled: boolean
  aerialRegistry: AerialCameraRegistry | null
  aerialEnabled: boolean
  geometryCache: WeakMap<GsiLikePayload, ReturnType<typeof computeGeometryFeatures>>
  topologyCache: WeakMap<
    GsiLikePayload,
    {
      withGeometry: ReturnType<typeof computeTopologyFeatures> | null
      withoutGeometry: ReturnType<typeof computeTopologyFeatures> | null
    }
  >
}

const evaluateMode = (timeline: ReplayTimeline, mode: AutoDirectorMode, hybrid?: HybridConfig) => {
  const engine = new AutoDirectorEngine()
  const settings: AutoDirectorSettings = {
    ...DEFAULT_AUTO_DIRECTOR_SETTINGS,
    enabled: true,
    mode,
    geometryAdvisoryEnabled: hybrid?.geometryEnabled ?? false,
    mlAdvisoryEnabled: hybrid?.mlEnabled ?? false,
    aerialPresentationEnabled: hybrid?.aerialEnabled ?? false,
    aerialPresentationPhases: {
      freezeTime: true,
      midRound: true,
      roundEnd: true
    }
  }
  const samples: CameraSample[] = []
  const switches: Array<{ atMs: number; round: number }> = []
  const aerialSamples: AerialEligibilitySample[] = []
  let targetSteamId: string | null = null
  let roundStartedAt = 0
  let lastRound = -1
  let previousPlayers = new Map<string, ReturnType<typeof normalizePlayers>[number]>()

  for (const frame of timeline.frames) {
    if (frame.round !== lastRound) {
      lastRound = frame.round
      roundStartedAt = frame.atMs
    }
    const players = hybrid ? normalizePlayers(frame.payload) : []
    let geometryFeatures: ReturnType<typeof computeGeometryFeatures> | null = null
    if (hybrid?.geometry && hybrid.geometryEnabled) {
      geometryFeatures = hybrid.geometryCache.get(frame.payload) ?? null
      if (!geometryFeatures) {
        geometryFeatures = computeGeometryFeatures(
          players.filter((player) => player.alive),
          hybrid.geometry
        )
        hybrid.geometryCache.set(frame.payload, geometryFeatures)
      }
    }
    let topologyFeatures: ReturnType<typeof computeTopologyFeatures> | undefined
    if (hybrid?.topology) {
      const cached = hybrid.topologyCache.get(frame.payload) ?? {
        withGeometry: null,
        withoutGeometry: null
      }
      const cacheKey = geometryFeatures ? 'withGeometry' : 'withoutGeometry'
      topologyFeatures = cached[cacheKey] ?? undefined
      if (!topologyFeatures) {
        topologyFeatures = computeTopologyFeatures(
          players.filter((player) => player.alive),
          hybrid.topology,
          geometryFeatures ? hybrid.geometry : null,
          previousPlayers
        )
        cached[cacheKey] = topologyFeatures
        hybrid.topologyCache.set(frame.payload, cached)
      }
    }
    const advisory: ScoreAdvisory | undefined = hybrid
      ? (player, score, allPlayers) => {
          const results = []
          const playerGeometry = geometryFeatures?.get(player.steamId) ?? null
          if (hybrid.geometryEnabled && playerGeometry) {
            const geometryValue =
              playerGeometry.visibleEnemyCount * 2.5 +
              (playerGeometry.nearestEnemyHasLineOfSight ? 6 : 0) +
              playerGeometry.peekPotentialEnemyCount * 1.5 +
              (playerGeometry.nearestEnemyHasPeekPotential ? 2 : 0) +
              Math.min(6, Math.max(0, playerGeometry.forwardEnemyCount - 1) * 2) +
              playerGeometry.forwardEnemyAlignment * 3 +
              playerGeometry.bestVisibleAimAlignment * 4
            results.push({
              key: 'geometryAdvisory' as const,
              value: Math.tanh(geometryValue / 8) * 10,
              detail: `LOS ${playerGeometry.visibleEnemyCount} visible; forward ${playerGeometry.forwardEnemyCount}; peek ${playerGeometry.peekPotentialEnemyCount}`
            })
          }
          if (hybrid.mlEnabled && hybrid.ranker) {
            const raw = hybrid.ranker.predict(
              buildAutoDirectorMlFeatures(
                player,
                score,
                allPlayers,
                frame.atMs - roundStartedAt,
                playerGeometry,
                geometryFeatures !== null
              )
            )
            results.push({
              key: 'mlAdvisory' as const,
              value: Math.tanh(raw) * 8,
              detail: `ML ${raw >= 0 ? '+' : ''}${raw.toFixed(2)}`
            })
          }
          return results
        }
      : undefined
    const decision = engine.evaluate(
      frame.payload,
      settings,
      frame.atMs,
      advisory,
      geometryFeatures ?? undefined,
      topologyFeatures
    )
    if (hybrid?.aerialEnabled && hybrid.aerialRegistry) {
      const aerialMap = hybrid.aerialRegistry.load(frame.payload.map?.name ?? timeline.metadata.map)
      const aerial = decideAerialPresentation(
        frame.payload,
        settings,
        players,
        decision,
        aerialMap,
        geometryFeatures ? hybrid.geometry : null
      )
      aerialSamples.push({
        eligible: aerial.eligible,
        anchorId: aerial.anchor?.id ?? null,
        actionBlocked: aerial.actionBlocked
      })
    }
    if (decision.shouldSwitch && decision.candidateSteamId) {
      targetSteamId = decision.candidateSteamId
      engine.confirmSwitch(targetSteamId, frame.atMs)
      switches.push({ atMs: frame.atMs, round: frame.round })
    } else {
      targetSteamId = decision.currentSteamId
    }
    previousPlayers = new Map(players.map((player) => [player.steamId, player]))

    const target = decision.scores.find((score) => score.steamId === targetSteamId)
    const objectiveState = frame.payload.bomb?.state
    samples.push({
      atMs: frame.atMs,
      round: frame.round,
      targetSteamId,
      alive: target?.alive ?? false,
      objectiveActorSteamId:
        objectiveState === 'planting' || objectiveState === 'defusing'
          ? (frame.payload.bomb?.player ?? null)
          : null
    })
  }

  const validKills = timeline.kills.filter((kill) => {
    const sample = sampleAt(samples, kill.atMs)
    return (
      kill.attackerSteamId &&
      kill.victimSteamId &&
      sample &&
      kill.atMs - sample.atMs <= timeline.metadata.sampleIntervalMs + 20
    )
  })
  const captures = (offsetMs: number, participants: boolean): number =>
    validKills.filter((kill) => {
      const sample = sampleAt(samples, kill.atMs - offsetMs)
      if (!sample) return false
      return participants
        ? sample.targetSteamId === kill.attackerSteamId ||
            sample.targetSteamId === kill.victimSteamId
        : sample.targetSteamId === kill.attackerSteamId
    }).length

  const dwellTimes = switches
    .slice(1)
    .map((entry, index) =>
      entry.round === switches[index].round ? entry.atMs - switches[index].atMs : null
    )
    .filter((duration): duration is number => duration !== null)
  const objectiveSamples = samples.filter((sample) => sample.objectiveActorSteamId)
  const objectiveHits = objectiveSamples.filter(
    (sample) => sample.targetSteamId === sample.objectiveActorSteamId
  ).length
  const eligibleAerialSamples = aerialSamples.filter((sample) => sample.eligible)
  const aerialAnchorFrames = Object.fromEntries(
    [...new Set(eligibleAerialSamples.map((sample) => sample.anchorId).filter(Boolean))]
      .sort()
      .map((anchorId) => [
        anchorId,
        eligibleAerialSamples.filter((sample) => sample.anchorId === anchorId).length
      ])
  )

  return {
    mode,
    frames: samples.length,
    rounds: timeline.metadata.rounds,
    switches: switches.length,
    switchesPerRound: Number((switches.length / Math.max(1, timeline.metadata.rounds)).toFixed(2)),
    meanDwellMs: Math.round(mean(dwellTimes)),
    thrashUnderOneSecond: dwellTimes.filter((duration) => duration < 1_000).length,
    deadTargetFrames: samples.filter((sample) => sample.targetSteamId && !sample.alive).length,
    killEvents: validKills.length,
    killerCaptureAtKillPercent: percentage(captures(0, false), validKills.length),
    participantCaptureAtKillPercent: percentage(captures(0, true), validKills.length),
    killerCaptureOneSecondBeforePercent: percentage(captures(1_000, false), validKills.length),
    participantCaptureOneSecondBeforePercent: percentage(captures(1_000, true), validKills.length),
    objectiveCoveragePercent: percentage(objectiveHits, objectiveSamples.length),
    objectiveSamples: objectiveSamples.length,
    aerialEligibility:
      hybrid?.aerialEnabled && hybrid.aerialRegistry
        ? {
            eligibleFrames: eligibleAerialSamples.length,
            eligiblePercent: percentage(eligibleAerialSamples.length, aerialSamples.length),
            actionBlockedFrames: aerialSamples.filter((sample) => sample.actionBlocked).length,
            anchorFrames: aerialAnchorFrames,
            note: 'Eligibility only: does not simulate transport, two-frame confirmation, hold limit or cooldown.'
          }
        : undefined
  }
}

const input = process.argv[2]
if (!input) {
  console.error(
    'Usage: npm run demo:evaluate -- <timeline.json[.gz]> [geometry-dir model.json aerial-dir]'
  )
  process.exit(1)
}

const inputBytes = fs.readFileSync(input)
const timeline = JSON.parse(
  (input.endsWith('.gz') ? gunzipSync(inputBytes) : inputBytes).toString('utf8')
) as ReplayTimeline
if (!timeline.frames.length) {
  throw new Error('Timeline contains no frames')
}

const geometryDirectory = process.argv[3]
const modelPath = process.argv[4]
const aerialDirectory = process.argv[5]
let hybrid: HybridConfig | undefined
if (geometryDirectory && modelPath) {
  const geometry = new GeometryRegistry(path.resolve(geometryDirectory)).load(timeline.metadata.map)
  const topology = new TopologyRegistry(path.resolve('resources/auto-director/topology')).load(
    timeline.metadata.map
  )
  hybrid = {
    geometry,
    topology,
    ranker: loadLightGbmRanker(path.resolve(modelPath)),
    geometryEnabled: true,
    mlEnabled: true,
    aerialRegistry: new AerialCameraRegistry(
      path.resolve(aerialDirectory ?? 'resources/auto-director/aerial')
    ),
    aerialEnabled: false,
    geometryCache: new WeakMap(),
    topologyCache: new WeakMap()
  }
}

const report = {
  source: {
    file: timeline.metadata.sourceFile,
    sha256: timeline.metadata.sourceSha256,
    map: timeline.metadata.map,
    sampleIntervalMs: timeline.metadata.sampleIntervalMs
  },
  modes: (['balanced', 'reactive', 'calm'] as const).map((mode) => evaluateMode(timeline, mode)),
  ...(hybrid
    ? {
        geometryModes: (['balanced', 'reactive', 'calm'] as const).map((mode) =>
          evaluateMode(timeline, mode, { ...hybrid!, mlEnabled: false })
        ),
        mlModes: (['balanced', 'reactive', 'calm'] as const).map((mode) =>
          evaluateMode(timeline, mode, { ...hybrid!, geometryEnabled: false })
        ),
        hybridModes: (['balanced', 'reactive', 'calm'] as const).map((mode) =>
          evaluateMode(timeline, mode, hybrid)
        ),
        aerialEligibilityModes: (['balanced', 'reactive', 'calm'] as const).map((mode) =>
          evaluateMode(timeline, mode, { ...hybrid!, mlEnabled: false, aerialEnabled: true })
        )
      }
    : {})
}

const output = `${input.replace(/\.timeline\.json(?:\.gz)?$/i, '')}.evaluation.json`
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
console.log(`Evaluation written to ${path.resolve(output)}`)
