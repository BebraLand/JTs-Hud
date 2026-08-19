import fs from 'node:fs'
import path from 'node:path'
import { AutoDirectorEngine } from '../src/main/server/domains/auto-director/autoDirector.engine'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
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

const evaluateMode = (timeline: ReplayTimeline, mode: AutoDirectorMode) => {
  const engine = new AutoDirectorEngine()
  const settings: AutoDirectorSettings = {
    ...DEFAULT_AUTO_DIRECTOR_SETTINGS,
    enabled: true,
    mode
  }
  const samples: CameraSample[] = []
  const switches: Array<{ atMs: number; round: number }> = []
  let targetSteamId: string | null = null

  for (const frame of timeline.frames) {
    const decision = engine.evaluate(frame.payload, settings, frame.atMs)
    if (decision.shouldSwitch && decision.candidateSteamId) {
      targetSteamId = decision.candidateSteamId
      engine.confirmSwitch(targetSteamId, frame.atMs)
      switches.push({ atMs: frame.atMs, round: frame.round })
    } else {
      targetSteamId = decision.currentSteamId
    }

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
    objectiveSamples: objectiveSamples.length
  }
}

const input = process.argv[2]
if (!input) {
  console.error('Usage: npm run demo:evaluate -- fixtures/demos/example.timeline.json')
  process.exit(1)
}

const timeline = JSON.parse(fs.readFileSync(input, 'utf8')) as ReplayTimeline
if (!timeline.frames.length) {
  throw new Error('Timeline contains no frames')
}

const report = {
  source: {
    file: timeline.metadata.sourceFile,
    sha256: timeline.metadata.sourceSha256,
    map: timeline.metadata.map,
    sampleIntervalMs: timeline.metadata.sampleIntervalMs
  },
  modes: (['balanced', 'reactive', 'calm'] as const).map((mode) => evaluateMode(timeline, mode))
}

const output = `${input.replace(/\.timeline\.json$/i, '')}.evaluation.json`
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
console.log(`Evaluation written to ${path.resolve(output)}`)
