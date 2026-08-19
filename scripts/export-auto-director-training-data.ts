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
import type {
  GsiLikePayload,
  ScoreFactorKey
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

const FACTORS: ScoreFactorKey[] = [
  'base',
  'objective',
  'combat',
  'damage',
  'recentKill',
  'proximity',
  'aimAlignment',
  'clutch',
  'grenade',
  'entry',
  'retake',
  'weaponPressure',
  'bombCarrier',
  'lowHealthDrama',
  'flashPenalty'
]
const WEAPON_TYPES = [
  'Pistol',
  'Rifle',
  'SniperRifle',
  'Submachine Gun',
  'Shotgun',
  'Machine Gun',
  'Grenade',
  'Knife',
  'C4'
]
const HORIZON_MS = 3_000
const FRAME_STEP = 2

const [indexPath, outputPath, geometryDirectory] = process.argv.slice(2)
if (!indexPath || !outputPath) {
  throw new Error(
    'Usage: npm run ml:dataset -- <corpus-index.json> <training-rows.csv.gz> [geometry-directory]'
  )
}

const readTimeline = (file: string): Timeline => {
  const bytes = fs.readFileSync(file)
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as Timeline
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
  'label',
  'team_t',
  'health',
  'armor',
  'flashed',
  'ammo_clip',
  'round_kills',
  'round_damage',
  'has_bomb',
  'nearest_enemy_distance',
  'alive_teammates',
  'alive_enemies',
  'round_elapsed_ms',
  'rule_score',
  'geometry_available',
  'visible_enemy_count',
  'nearest_visible_enemy_distance',
  'nearest_enemy_has_los',
  'nearest_enemy_has_peek_potential',
  'peek_potential_enemy_count',
  'best_visible_aim_alignment',
  ...FACTORS.map((factor) => `factor_${factor}`),
  ...WEAPON_TYPES.map((weaponType) => `weapon_${weaponType.replaceAll(' ', '_').toLowerCase()}`)
]

const main = async (): Promise<void> => {
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as CorpusIndex
  const absoluteIndexDirectory = path.dirname(path.resolve(indexPath))
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  const target = fs.createWriteStream(outputPath)
  const gzip = createGzip({ level: 9 })
  gzip.pipe(target)
  gzip.write(`${columns.join(',')}\n`)

  let rowCount = 0
  const rowsBySplit = { train: 0, validation: 0, test: 0 }
  const settings = { ...DEFAULT_AUTO_DIRECTOR_SETTINGS, enabled: true, mode: 'balanced' as const }

  for (const entry of index.entries) {
    const timelinePath = path.resolve(absoluteIndexDirectory, entry.timeline)
    const timeline = readTimeline(timelinePath)
    if (timeline.metadata.sourceSha256 !== entry.sourceSha256) {
      throw new Error(`Timeline SHA-256 mismatch: ${entry.timeline}`)
    }
    const engine = new AutoDirectorEngine()
    const geometry = geometryDirectory
      ? new GeometryRegistry(path.resolve(geometryDirectory)).load(timeline.metadata.map)
      : null
    const kills = eligibleKills(timeline)
    const roundStarts = new Map<number, number>()
    let killIndex = 0
    let matchRows = 0

    for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
      const frame = timeline.frames[frameIndex]
      roundStarts.set(frame.round, roundStarts.get(frame.round) ?? frame.atMs)
      const decision = engine.evaluate(frame.payload, settings, frame.atMs)
      while (killIndex < kills.length && kills[killIndex].atMs < frame.atMs) killIndex += 1
      const nextKill = kills[killIndex]
      if (frameIndex % FRAME_STEP !== 0 || !nextKill || nextKill.atMs - frame.atMs > HORIZON_MS) {
        continue
      }

      const players = normalizePlayers(frame.payload)
      const alivePlayers = players.filter((player) => player.alive)
      const geometryFeatures = geometry ? computeGeometryFeatures(alivePlayers, geometry) : null
      const aliveByTeam = new Map<string, number>()
      for (const player of alivePlayers) {
        aliveByTeam.set(player.team, (aliveByTeam.get(player.team) ?? 0) + 1)
      }

      for (const player of alivePlayers) {
        const score = decision.scores.find((candidate) => candidate.steamId === player.steamId)
        if (!score) continue
        const factors = new Map(score.factors.map((factor) => [factor.key, factor.value]))
        const playerGeometry = geometryFeatures?.get(player.steamId)
        const label =
          player.steamId === nextKill.attackerSteamId
            ? 3
            : player.steamId === nextKill.victimSteamId
              ? 2
              : 0
        const aliveTeammates = Math.max(0, (aliveByTeam.get(player.team) ?? 1) - 1)
        const aliveEnemies = alivePlayers.length - (aliveByTeam.get(player.team) ?? 0)
        const values: Array<string | number> = [
          entry.split,
          timeline.metadata.sourceFile,
          timeline.metadata.map,
          frame.round,
          frame.tick,
          frame.atMs,
          nextKill.atMs - frame.atMs,
          player.steamId,
          label,
          player.team === 'T' ? 1 : 0,
          player.health,
          player.armor,
          player.flashed,
          player.ammoClip ?? -1,
          player.roundKills,
          player.roundDamage,
          player.hasBomb ? 1 : 0,
          score.nearestEnemyDistance ?? -1,
          aliveTeammates,
          aliveEnemies,
          frame.atMs - roundStarts.get(frame.round)!,
          score.total,
          geometry ? 1 : 0,
          playerGeometry?.visibleEnemyCount ?? 0,
          playerGeometry?.nearestVisibleEnemyDistance ?? -1,
          playerGeometry?.nearestEnemyHasLineOfSight ? 1 : 0,
          playerGeometry?.nearestEnemyHasPeekPotential ? 1 : 0,
          playerGeometry?.peekPotentialEnemyCount ?? 0,
          playerGeometry?.bestVisibleAimAlignment ?? 0,
          ...FACTORS.map((factor) => factors.get(factor) ?? 0),
          ...WEAPON_TYPES.map((weaponType) => (player.weaponType === weaponType ? 1 : 0))
        ]
        if (!gzip.write(`${values.map(csv).join(',')}\n`)) await once(gzip, 'drain')
        rowCount += 1
        matchRows += 1
        rowsBySplit[entry.split] += 1
      }
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
        frameStep: FRAME_STEP,
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
