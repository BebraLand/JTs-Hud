import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { createGzip, gunzipSync } from 'node:zlib'
import {
  AutoDirectorEngine,
  normalizePlayers
} from '../src/main/server/domains/auto-director/autoDirector.engine'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import { computeGeometryFeatures } from '../src/main/server/domains/auto-director/geometry/geometryFeatures'
import { GeometryRegistry } from '../src/main/server/domains/auto-director/geometry/geometryRegistry'
import {
  AUTO_DIRECTOR_ML_FEATURES,
  buildAutoDirectorMlFeatures
} from '../src/main/server/domains/auto-director/autoDirector.mlFeatures'
import { AutoDirectorTemporalTracker } from '../src/main/server/domains/auto-director/autoDirector.temporal'
import { computeTopologyFeatures } from '../src/main/server/domains/auto-director/topology/topologyFeatures'
import { TopologyRegistry } from '../src/main/server/domains/auto-director/topology/topologyRegistry'
import type {
  DirectorPlayer,
  GsiLikePayload
} from '../src/main/server/domains/auto-director/autoDirector.types'

interface CorpusEntry {
  split: 'train' | 'validation' | 'test'
  timeline: string
  sourceSha256: string
  map: string
}

interface CorpusIndex {
  entries: CorpusEntry[]
}

interface TimelineFrame {
  tick: number
  atMs: number
  round: number
  payload: GsiLikePayload
}

interface TimelineKill {
  tick: number
  atMs: number
  attackerSteamId: string | null
  victimSteamId: string | null
}

interface Timeline {
  metadata: {
    sourceFile: string
    sourceSha256: string
    map: string
    sampleIntervalMs: number
  }
  frames: TimelineFrame[]
  kills: TimelineKill[]
}

const HORIZON_MS = 3_000
const HORIZONS_MS = [500, 1_000, 2_000, 3_000] as const
const FRAME_STEP = 4

const [indexPath, outputPath, geometryDirectory, shardIndexArg = '0', shardCountArg = '1'] =
  process.argv.slice(2)
if (!indexPath || !outputPath) {
  throw new Error(
    'Usage: npm run ml:dataset -- <corpus-index.json> <training-rows.csv.gz> [geometry-directory]'
  )
}

const readTimeline = (file: string): Timeline => {
  const bytes = fs.readFileSync(file)
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as Timeline
}

const shardIndex = Number(shardIndexArg)
const shardCount = Number(shardCountArg)
if (
  !Number.isInteger(shardIndex) ||
  !Number.isInteger(shardCount) ||
  shardCount < 1 ||
  shardIndex < 0 ||
  shardIndex >= shardCount
) {
  throw new Error(`Invalid shard ${shardIndexArg}/${shardCountArg}`)
}

const eligibleKills = (timeline: Timeline): TimelineKill[] => {
  let frameIndex = 0
  return timeline.kills
    .filter((kill) => kill.attackerSteamId && kill.victimSteamId)
    .sort((left, right) => left.atMs - right.atMs)
    .filter((kill) => {
      while (
        frameIndex + 1 < timeline.frames.length &&
        timeline.frames[frameIndex + 1].atMs <= kill.atMs
      ) {
        frameIndex += 1
      }
      const frame = timeline.frames[frameIndex]
      return (
        frame.atMs <= kill.atMs &&
        kill.atMs - frame.atMs <= timeline.metadata.sampleIntervalMs + 20 &&
        Boolean(frame.payload.allplayers?.[kill.attackerSteamId!]) &&
        Boolean(frame.payload.allplayers?.[kill.victimSteamId!])
      )
    })
}

const csv = (value: string | number): string => {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const columns = [
  'split',
  'match',
  'map',
  'round',
  'tick',
  'at_ms',
  'time_to_kill_ms',
  'steam_id',
  ...HORIZONS_MS.map((horizon) => `label_${horizon}`),
  ...AUTO_DIRECTOR_ML_FEATURES
]

const main = async (): Promise<void> => {
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as CorpusIndex
  const absoluteIndexDirectory = path.dirname(path.resolve(indexPath))
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  const target = fs.createWriteStream(outputPath)
  const gzip = createGzip({ level: 9 })
  gzip.pipe(target)
  if (shardIndex === 0) gzip.write(`${columns.join(',')}\n`)

  let rowCount = 0
  const rowsBySplit = { train: 0, validation: 0, test: 0 }
  const settings = { ...DEFAULT_AUTO_DIRECTOR_SETTINGS, enabled: true, mode: 'balanced' as const }

  const entries = index.entries.filter((_, entryIndex) => entryIndex % shardCount === shardIndex)
  for (const entry of entries) {
    const timelinePath = path.resolve(absoluteIndexDirectory, entry.timeline)
    const timeline = readTimeline(timelinePath)
    if (timeline.metadata.sourceSha256 !== entry.sourceSha256) {
      throw new Error(`Timeline SHA-256 mismatch: ${entry.timeline}`)
    }
    const engine = new AutoDirectorEngine()
    const temporal = new AutoDirectorTemporalTracker()
    const geometry = geometryDirectory
      ? new GeometryRegistry(path.resolve(geometryDirectory)).load(timeline.metadata.map)
      : null
    const topology = new TopologyRegistry(path.resolve('resources/auto-director/topology')).load(
      timeline.metadata.map
    )
    const kills = eligibleKills(timeline)
    const roundStarts = new Map<number, number>()
    let killIndex = 0
    let matchRows = 0
    let previousPlayers = new Map<string, DirectorPlayer>()
    let previousFrameAt = 0
    let previousRound = -1
    const roundCounterBaselines = new Map<string, { kills: number; damage: number }>()

    for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
      const frame = timeline.frames[frameIndex]
      if (frame.round !== previousRound) {
        engine.reset()
        temporal.reset()
        previousPlayers.clear()
        previousFrameAt = 0
        previousRound = frame.round
        roundCounterBaselines.clear()
      }
      roundStarts.set(frame.round, roundStarts.get(frame.round) ?? frame.atMs)
      while (killIndex < kills.length && kills[killIndex].atMs < frame.atMs) killIndex += 1
      const players = normalizePlayers(frame.payload)
      for (const player of players) {
        const baseline = roundCounterBaselines.get(player.steamId) ?? {
          kills: player.roundKills,
          damage: player.roundDamage
        }
        roundCounterBaselines.set(player.steamId, baseline)
        player.roundKills = Math.max(0, player.roundKills - baseline.kills)
        player.roundDamage = Math.max(0, player.roundDamage - baseline.damage)
      }
      const temporalFeatures = temporal.update(players, frame.atMs)
      if (frameIndex % FRAME_STEP !== 0) {
        engine.evaluate(frame.payload, settings, frame.atMs)
        previousPlayers = new Map(players.map((player) => [player.steamId, player]))
        previousFrameAt = frame.atMs
        continue
      }

      const alivePlayers = players.filter((player) => player.alive)
      const geometryFeatures = geometry ? computeGeometryFeatures(alivePlayers, geometry) : null
      const topologyFeatures = topology
        ? computeTopologyFeatures(
            alivePlayers,
            topology,
            geometry,
            previousPlayers,
            previousFrameAt ? frame.atMs - previousFrameAt : timeline.metadata.sampleIntervalMs
          )
        : null
      const decision = engine.evaluate(
        frame.payload,
        settings,
        frame.atMs,
        undefined,
        geometryFeatures ?? undefined,
        topologyFeatures ?? undefined
      )
      const upcomingKills = kills.filter(
        (kill, index) =>
          index >= killIndex && kill.atMs >= frame.atMs && kill.atMs - frame.atMs <= HORIZON_MS
      )
      const nextKill = upcomingKills[0]

      for (const player of alivePlayers) {
        const score = decision.scores.find((candidate) => candidate.steamId === player.steamId)
        if (!score) continue
        const playerGeometry = geometryFeatures?.get(player.steamId)
        const labels = HORIZONS_MS.map((horizon) =>
          upcomingKills.some(
            (kill) =>
              kill.atMs - frame.atMs <= horizon &&
              (kill.attackerSteamId === player.steamId || kill.victimSteamId === player.steamId)
          )
            ? 1
            : 0
        )
        const features = buildAutoDirectorMlFeatures(
          player,
          score,
          players,
          frame.atMs - roundStarts.get(frame.round)!,
          playerGeometry ?? null,
          geometry !== null,
          temporalFeatures.get(player.steamId) ?? null
        )
        const values: Array<string | number> = [
          entry.split,
          timeline.metadata.sourceFile,
          timeline.metadata.map,
          frame.round,
          frame.tick,
          frame.atMs,
          nextKill ? nextKill.atMs - frame.atMs : -1,
          player.steamId,
          ...labels,
          ...features
        ]
        if (!gzip.write(`${values.map(csv).join(',')}\n`)) await once(gzip, 'drain')
        rowCount += 1
        matchRows += 1
        rowsBySplit[entry.split] += 1
      }
      previousPlayers = new Map(players.map((player) => [player.steamId, player]))
      previousFrameAt = frame.atMs
    }
    console.log(
      `${entry.split}: ${timeline.metadata.sourceFile}: ${matchRows.toLocaleString()} rows`
    )
  }

  gzip.end()
  await once(target, 'close')
  console.log(
    JSON.stringify(
      {
        output: path.resolve(outputPath),
        rows: rowCount,
        rowsBySplit,
        horizonMs: HORIZON_MS,
        horizonsMs: HORIZONS_MS,
        frameStep: FRAME_STEP,
        shardIndex,
        shardCount,
        bytes: fs.statSync(outputPath).size
      },
      null,
      2
    )
  )
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
