import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type Split = 'train' | 'validation' | 'test'

interface CorpusEntry {
  split: Split
  timeline: string
  map: string
}

interface ModeReport {
  mode: string
  rounds: number
  switches: number
  meanDwellMs: number
  thrashUnderOneSecond: number
  deadTargetFrames: number
  killEvents: number
  killerCaptureAtKillPercent: number
  participantCaptureAtKillPercent: number
  killerCaptureHalfSecondBeforePercent?: number
  participantCaptureHalfSecondBeforePercent?: number
  killerCaptureOneSecondBeforePercent: number
  participantCaptureOneSecondBeforePercent: number
  killerCaptureTwoSecondsBeforePercent?: number
  participantCaptureTwoSecondsBeforePercent?: number
  objectiveCoveragePercent: number
  objectiveSamples: number
}

interface EvaluationReport {
  modes: ModeReport[]
  hybridModes?: ModeReport[]
}

const [
  indexArg,
  evaluatorArg,
  geometryArg,
  modelArg,
  outputArg,
  splitArg = 'validation,test',
  profileOverridesArg = '-',
  evaluationScope = 'focused'
] = process.argv.slice(2)
if (!indexArg || !evaluatorArg || !geometryArg || !modelArg || !outputArg) {
  throw new Error(
    'Usage: evaluate-auto-director-corpus <index.json> <evaluator.js> <geometry-dir> <model.json> <output.json> [splits profile-overrides.json|- scope]'
  )
}

const indexPath = path.resolve(indexArg)
const indexDirectory = path.dirname(indexPath)
const evaluator = path.resolve(evaluatorArg)
const geometry = path.resolve(geometryArg)
const model = path.resolve(modelArg)
const requestedSplits = new Set(splitArg.split(',') as Split[])
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { entries: CorpusEntry[] }
const entries = index.entries.filter((entry) => requestedSplits.has(entry.split))
if (!entries.length) throw new Error(`No corpus entries for ${splitArg}`)

const weightedPercent = (
  reports: ModeReport[],
  percent: keyof ModeReport,
  count: keyof ModeReport
): number => {
  const total = reports.reduce((sum, report) => sum + Number(report[count]), 0)
  if (!total) return 0
  return Number(
    (
      reports.reduce(
        (sum, report) => sum + Number(report[percent] ?? 0) * Number(report[count]),
        0
      ) / total
    ).toFixed(1)
  )
}

const aggregate = (reports: ModeReport[]) => {
  const rounds = reports.reduce((sum, report) => sum + report.rounds, 0)
  const switches = reports.reduce((sum, report) => sum + report.switches, 0)
  return {
    matches: reports.length,
    rounds,
    killEvents: reports.reduce((sum, report) => sum + report.killEvents, 0),
    switches,
    switchesPerRound: Number((switches / Math.max(1, rounds)).toFixed(2)),
    meanDwellMs: Math.round(
      reports.reduce((sum, report) => sum + report.meanDwellMs * report.switches, 0) /
        Math.max(1, switches)
    ),
    thrashUnderOneSecond: reports.reduce((sum, report) => sum + report.thrashUnderOneSecond, 0),
    deadTargetFrames: reports.reduce((sum, report) => sum + report.deadTargetFrames, 0),
    killerCaptureAtKillPercent: weightedPercent(
      reports,
      'killerCaptureAtKillPercent',
      'killEvents'
    ),
    participantCaptureAtKillPercent: weightedPercent(
      reports,
      'participantCaptureAtKillPercent',
      'killEvents'
    ),
    killerCaptureHalfSecondBeforePercent: weightedPercent(
      reports,
      'killerCaptureHalfSecondBeforePercent',
      'killEvents'
    ),
    participantCaptureHalfSecondBeforePercent: weightedPercent(
      reports,
      'participantCaptureHalfSecondBeforePercent',
      'killEvents'
    ),
    killerCaptureOneSecondBeforePercent: weightedPercent(
      reports,
      'killerCaptureOneSecondBeforePercent',
      'killEvents'
    ),
    participantCaptureOneSecondBeforePercent: weightedPercent(
      reports,
      'participantCaptureOneSecondBeforePercent',
      'killEvents'
    ),
    killerCaptureTwoSecondsBeforePercent: weightedPercent(
      reports,
      'killerCaptureTwoSecondsBeforePercent',
      'killEvents'
    ),
    participantCaptureTwoSecondsBeforePercent: weightedPercent(
      reports,
      'participantCaptureTwoSecondsBeforePercent',
      'killEvents'
    ),
    objectiveCoveragePercent: weightedPercent(
      reports,
      'objectiveCoveragePercent',
      'objectiveSamples'
    )
  }
}

const modes = ['balanced', 'reactive', 'calm'] as const
type Mode = (typeof modes)[number]
type ModeReports = Record<Mode, ModeReport>

const reportsByMode = (reports: ModeReport[] | undefined, timeline: string): ModeReports =>
  Object.fromEntries(
    modes.map((mode) => {
      const report = reports?.find((candidate) => candidate.mode === mode)
      if (!report) throw new Error(`${mode} report missing for ${timeline}`)
      return [mode, report]
    })
  ) as ModeReports

const aggregateModes = (reports: ModeReports[]) =>
  Object.fromEntries(modes.map((mode) => [mode, aggregate(reports.map((report) => report[mode]))]))

async function main() {
const runEntry = (entry: CorpusEntry, index: number) => new Promise<{ entry: CorpusEntry; rules: ModeReports; hybrid: ModeReports }>((resolve, reject) => {
  const timeline = path.resolve(indexDirectory, entry.timeline)
  console.log(`[${index + 1}/${entries.length}] ${entry.split}: ${path.basename(timeline)}`)
  const child = spawn(
    process.execPath,
    [
      evaluator,
      timeline,
      geometry,
      model,
      path.resolve('resources/auto-director/aerial'),
      profileOverridesArg,
      evaluationScope
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  )
  child.once('error', reject)
  child.once('exit', (code) => {
    if (code !== 0) return reject(new Error(`Evaluator failed for ${entry.timeline}`))
    const reportPath = timeline.replace(/\.timeline\.json(?:\.gz)?$/i, '.evaluation.json')
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as EvaluationReport
    resolve({
    entry,
    rules: reportsByMode(report.modes, entry.timeline),
    hybrid: reportsByMode(report.hybridModes, entry.timeline)
    })
  })
})

const results = await Promise.all(entries.map((entry, index) => runEntry(entry, index)))

const maps = Object.fromEntries(
  [...new Set(results.map(({ entry }) => entry.map))].sort().map((mapName) => {
    const mapResults = results.filter(({ entry }) => entry.map === mapName)
    return [
      mapName,
      {
        rules: aggregateModes(mapResults.map(({ rules }) => rules)),
        hybrid: aggregateModes(mapResults.map(({ hybrid }) => hybrid))
      }
    ]
  })
)
const output = {
  schemaVersion: 1,
  evaluator,
  splits: [...requestedSplits],
  rules: aggregateModes(results.map(({ rules }) => rules)),
  hybrid: aggregateModes(results.map(({ hybrid }) => hybrid)),
  maps
}
fs.mkdirSync(path.dirname(path.resolve(outputArg)), { recursive: true })
fs.writeFileSync(path.resolve(outputArg), `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
