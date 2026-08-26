import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { AutoDirectorEngine, normalizePlayers } from '../src/main/server/domains/auto-director/autoDirector.engine'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import type { AutoDirectorMode, GsiLikePayload } from '../src/main/server/domains/auto-director/autoDirector.types'

interface Timeline {
  frames: Array<{ tick: number; atMs: number; round: number; payload: GsiLikePayload }>
  kills: Array<{ tick: number; atMs: number; attackerSteamId: string | null; victimSteamId: string | null }>
}

const file = process.argv[2]
const mode = (process.argv[3] ?? 'balanced') as AutoDirectorMode
if (!file) throw new Error('Usage: inspect-auto-director-demo <timeline.gz> [balanced|reactive|calm]')

const bytes = fs.readFileSync(file)
const timeline = JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as Timeline
const frames = timeline.frames
const engine = new AutoDirectorEngine()
const settings = {
  ...DEFAULT_AUTO_DIRECTOR_SETTINGS,
  enabled: true,
  mode,
  geometryAdvisoryEnabled: false,
  mlAdvisoryEnabled: false,
  aerialPresentationEnabled: false,
  aerialPresentationPhases: { freezeTime: true, midRound: true, roundEnd: true }
}
let lastTarget: string | null = null
let lastTop = ''
const names = new Map<string, string>()

for (const frame of frames) {
  const players = normalizePlayers(frame.payload)
  for (const player of players) names.set(player.steamId, player.name)
  const decision = engine.evaluate(frame.payload, settings, frame.atMs)
  if (decision.shouldSwitch && decision.candidateSteamId) {
    lastTarget = decision.candidateSteamId
    engine.confirmSwitch(lastTarget, frame.atMs)
  } else {
    lastTarget = decision.currentSteamId
  }

  const top = decision.scores.slice(0, 5).map((score) => `${score.name}:${score.total}`).join(' | ')
  const killNear = timeline.kills.find((kill) => Math.abs(kill.atMs - frame.atMs) <= 130)
  const targetChanged = lastTarget !== decision.currentSteamId || top !== lastTop
  if (targetChanged || killNear) {
    console.log(`FRAME tick=${frame.tick} at=${frame.atMs} target=${names.get(lastTarget ?? '') ?? lastTarget ?? 'none'} reason=${decision.reason}`)
    console.log(`TOP ${top}`)
    for (const score of decision.scores.slice(0, 5)) {
      console.log(`  ${score.name} [${score.team}] ${score.total} ${score.factors.slice(0, 6).map((factor) => `${factor.key}=${factor.value}`).join(', ')}`)
    }
    if (killNear) {
      console.log(`KILL ${names.get(killNear.attackerSteamId ?? '') ?? killNear.attackerSteamId} -> ${names.get(killNear.victimSteamId ?? '') ?? killNear.victimSteamId}`)
    }
  }
  lastTop = top
}
