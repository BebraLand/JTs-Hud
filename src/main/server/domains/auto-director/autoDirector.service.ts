import type { Server } from 'socket.io'
import fs from 'node:fs'
import path from 'node:path'
import { sendTelnetCommands } from '../../../camera/telnet'
import { simulateObserverSlotKey } from '../../../camera/keySimulation'
import { dbGet, dbRun } from '../../database/sqlite'
import { getTelnetSettings } from '../settings/telnetSettings.repository'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from './autoDirector.config'
import {
  AutoDirectorEngine,
  normalizePlayers,
  type ScoreAdvisory,
  type ScoreAdvisoryResult
} from './autoDirector.engine'
import { buildAutoDirectorMlFeatures } from './autoDirector.mlFeatures'
import { LightGbmRanker, loadLightGbmRanker } from './autoDirector.ml'
import { persistSettingsCandidate } from './autoDirector.settings'
import { CameraController } from './cameraController'
import { getAutoDirectorResourceDir } from '../../../paths'
import { computeGeometryFeatures } from './geometry/geometryFeatures'
import { GeometryRegistry } from './geometry/geometryRegistry'
import type {
  AutoDirectorSettings,
  AutoDirectorStatus,
  CameraTransport,
  DirectorHistoryEntry,
  GsiLikePayload
} from './autoDirector.types'

const SETTINGS_KEY = 'autoDirectorSettings'
const MAX_HISTORY = 200

const sanitizeSettings = (input: Partial<AutoDirectorSettings>): Partial<AutoDirectorSettings> => {
  const output: Partial<AutoDirectorSettings> = {}
  if (typeof input.enabled === 'boolean') output.enabled = input.enabled
  if (typeof input.paused === 'boolean') output.paused = input.paused
  if (['balanced', 'reactive', 'calm'].includes(String(input.mode))) output.mode = input.mode
  if (typeof input.autoFallback === 'boolean') output.autoFallback = input.autoFallback
  if (typeof input.rulesEnabled === 'boolean') output.rulesEnabled = input.rulesEnabled
  if (typeof input.geometryAdvisoryEnabled === 'boolean')
    output.geometryAdvisoryEnabled = input.geometryAdvisoryEnabled
  if (typeof input.mlAdvisoryEnabled === 'boolean')
    output.mlAdvisoryEnabled = input.mlAdvisoryEnabled
  if (input.scoringIntervalMs !== undefined) {
    const interval = Number(input.scoringIntervalMs)
    if (!Number.isFinite(interval) || interval < 50 || interval > 1000) {
      throw new Error('Scoring interval must be 50-1000 ms')
    }
    output.scoringIntervalMs = Math.round(interval)
  }
  if (input.manualOverrideSteamId === null || typeof input.manualOverrideSteamId === 'string') {
    output.manualOverrideSteamId = input.manualOverrideSteamId
  }
  if (input.customWeights && typeof input.customWeights === 'object') {
    output.customWeights = Object.fromEntries(
      Object.entries(input.customWeights)
        .map(([key, value]) => [key, Number(value)] as const)
        .filter(([, value]) => Number.isFinite(value) && value >= 0 && value <= 200)
    )
  }
  return output
}

export class AutoDirectorService {
  private readonly engine = new AutoDirectorEngine()
  private readonly camera = new CameraController(
    getTelnetSettings,
    sendTelnetCommands,
    simulateObserverSlotKey
  )
  private readonly geometry = new GeometryRegistry(
    path.join(getAutoDirectorResourceDir(), 'geometry')
  )
  private mlRanker: LightGbmRanker | null = null
  private mlModelMessage = 'Model not loaded'
  private roundStartedAt = 0
  private lastRoundKey = ''
  private io: Server | null = null
  private settings: AutoDirectorSettings = { ...DEFAULT_AUTO_DIRECTOR_SETTINGS }
  private decision: AutoDirectorStatus['decision'] = null
  private lastCommand: AutoDirectorStatus['lastCommand'] = null
  private transportHealth: AutoDirectorStatus['transportHealth'] = {
    telnet: {
      state: 'unknown',
      lastCheckedAt: null,
      message: 'Not tested',
      consecutiveFailures: 0
    },
    keyboard: {
      state: process.platform === 'win32' ? 'unknown' : 'unsupported',
      lastCheckedAt: null,
      message:
        process.platform === 'win32'
          ? 'Not tested'
          : 'Windows keyboard simulation is unavailable on this platform',
      consecutiveFailures: 0
    }
  }
  private history: DirectorHistoryEntry[] = []
  private lastGsiAt: number | null = null
  private lastEvaluationAt = 0
  private commandInFlight = false
  private pendingTargetSteamId: string | null = null
  private pendingTargetAt = 0
  private observerConfirmationAvailable = false
  private retryNotBefore = 0
  private lastDecisionSignature = ''
  private lastDecisionHistoryAt = 0
  private statusTimer: NodeJS.Timeout | null = null

  async initialize(io: Server): Promise<void> {
    this.io = io
    this.loadMlModel()
    const row = (await dbGet('SELECT value FROM settings WHERE key = ?', [SETTINGS_KEY])) as
      | { value: string }
      | undefined
    if (row?.value) {
      try {
        const stored = JSON.parse(row.value) as Partial<AutoDirectorSettings> & {
          transport?: string
          telnetHost?: string
          telnetPort?: number
        }
        const normalized = sanitizeSettings(stored)
        if (stored.transport === 'keyboard' && stored.autoFallback === undefined) {
          normalized.autoFallback = true
        }
        this.settings = {
          ...DEFAULT_AUTO_DIRECTOR_SETTINGS,
          ...normalized,
          manualOverrideSteamId: null
        }
        if (
          stored.transport !== undefined ||
          stored.telnetHost !== undefined ||
          stored.telnetPort !== undefined
        ) {
          await this.persistSettings(this.settings)
        }
      } catch (error) {
        console.error('[AutoDirector] Ignoring invalid stored settings:', error)
      }
    }
    if (!this.statusTimer) {
      this.statusTimer = setInterval(() => this.emitStatus(), 1000)
      this.statusTimer.unref()
    }
    this.emitStatus()
  }

  private loadMlModel(): void {
    const modelPath = path.join(
      getAutoDirectorResourceDir(),
      'models',
      'auto-director-lightgbm.json'
    )
    if (!fs.existsSync(modelPath)) {
      this.mlModelMessage = `Model asset not found: ${modelPath}`
      return
    }
    try {
      this.mlRanker = loadLightGbmRanker(modelPath)
      this.mlModelMessage = `Loaded ${this.mlRanker.featureNames.length}-feature advisory model`
    } catch (error) {
      this.mlRanker = null
      this.mlModelMessage = error instanceof Error ? error.message : String(error)
      console.error('[AutoDirector] ML advisory model unavailable:', error)
    }
  }

  getStatus(): AutoDirectorStatus {
    const now = Date.now()
    const connected = this.lastGsiAt !== null && now - this.lastGsiAt < 5000
    return {
      settings: structuredClone(this.settings),
      connected,
      lastGsiAt: this.lastGsiAt,
      running: this.settings.enabled && !this.settings.paused && connected,
      decision: this.decision ? structuredClone(this.decision) : null,
      lastCommand: this.lastCommand ? { ...this.lastCommand } : null,
      transportHealth: structuredClone(this.transportHealth),
      history: structuredClone(this.history),
      ml: {
        enabled: this.settings.mlAdvisoryEnabled,
        modelLoaded: this.mlRanker !== null,
        modelMessage: this.mlModelMessage,
        geometry: this.geometry.getStatus()
      }
    }
  }

  async updateSettings(input: Partial<AutoDirectorSettings>): Promise<AutoDirectorStatus> {
    const next = sanitizeSettings(input)
    const previousOverride = this.settings.manualOverrideSteamId
    this.settings = await persistSettingsCandidate(this.settings, next, (candidate) =>
      this.persistSettings(candidate)
    )
    if (next.enabled === false) {
      this.engine.setCurrent(null)
      this.pendingTargetSteamId = null
    }
    if (
      next.manualOverrideSteamId !== undefined &&
      next.manualOverrideSteamId !== previousOverride
    ) {
      this.addHistory({
        at: Date.now(),
        type: 'operator',
        message: next.manualOverrideSteamId
          ? `Operator forced ${next.manualOverrideSteamId}`
          : 'Operator cleared manual override'
      })
    }
    this.emitStatus()
    return this.getStatus()
  }

  async testTransport(
    transport: CameraTransport,
    observerSlot?: number
  ): Promise<AutoDirectorStatus['lastCommand']> {
    this.lastCommand = await this.camera.test(transport, this.settings, observerSlot)
    this.updateTransportHealth(this.lastCommand)
    this.addHistory({
      at: this.lastCommand.at,
      type: this.lastCommand.ok ? 'operator' : 'transport-error',
      message: this.lastCommand.message,
      transport: this.lastCommand.transport
    })
    this.emitStatus()
    return this.lastCommand
  }

  processGsi(payload: GsiLikePayload): void {
    const now = Date.now()
    this.lastGsiAt = now
    if (now - this.lastEvaluationAt < this.settings.scoringIntervalMs) return
    this.lastEvaluationAt = now

    const observedSteamId = payload.player?.steamid ? String(payload.player.steamid) : null
    if (observedSteamId) this.observerConfirmationAvailable = true
    if (this.pendingTargetSteamId) {
      if (observedSteamId === this.pendingTargetSteamId) {
        this.engine.confirmSwitch(this.pendingTargetSteamId, now)
        this.pendingTargetSteamId = null
      } else if (now - this.pendingTargetAt > 1800) {
        const target = this.pendingTargetSteamId
        this.pendingTargetSteamId = null
        this.retryNotBefore = now + 1500
        if (observedSteamId) this.engine.setCurrent(observedSteamId, now)
        this.addHistory({
          at: now,
          type: 'transport-error',
          message: `Camera switch to ${target} was sent but not confirmed by GSI`,
          toSteamId: target,
          transport: this.lastCommand?.transport
        })
      }
    } else if (observedSteamId && observedSteamId !== this.engine.getCurrent()) {
      const previous = this.engine.getCurrent()
      this.engine.setCurrent(observedSteamId, now)
      if (previous) {
        this.addHistory({
          at: now,
          type: 'operator',
          message: `External observer change detected: ${observedSteamId}`,
          fromSteamId: previous,
          toSteamId: observedSteamId
        })
      }
    }

    const players = normalizePlayers(payload)
    const geometryMap =
      this.settings.geometryAdvisoryEnabled && payload.map?.name
        ? this.geometry.load(payload.map.name)
        : null
    const geometryFeatures = geometryMap
      ? computeGeometryFeatures(
          players.filter((player) => player.alive),
          geometryMap
        )
      : null
    const roundKey = `${payload.map?.name ?? ''}:${payload.map?.round ?? ''}`
    if (this.roundStartedAt === 0 || roundKey !== this.lastRoundKey) {
      this.lastRoundKey = roundKey
      this.roundStartedAt = now
    }
    const advisory: ScoreAdvisory | undefined =
      this.settings.geometryAdvisoryEnabled || (this.settings.mlAdvisoryEnabled && this.mlRanker)
        ? (player, score, allPlayers) => {
            const results: ScoreAdvisoryResult[] = []
            const playerGeometry = geometryFeatures?.get(player.steamId) ?? null
            if (this.settings.geometryAdvisoryEnabled && playerGeometry) {
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
                detail: `LOS ${playerGeometry.visibleEnemyCount} visible; forward ${playerGeometry.forwardEnemyCount}; peek ${playerGeometry.peekPotentialEnemyCount}; nearest ${playerGeometry.nearestEnemyHasLineOfSight ? 'visible' : 'occluded'}`
              })
            }
            if (this.settings.mlAdvisoryEnabled && this.mlRanker) {
              const raw = this.mlRanker.predict(
                buildAutoDirectorMlFeatures(
                  player,
                  score,
                  allPlayers,
                  now - this.roundStartedAt,
                  playerGeometry,
                  geometryMap !== null
                )
              )
              results.push({
                key: 'mlAdvisory' as const,
                value: Math.tanh(raw) * 8,
                detail: `ML ${raw >= 0 ? '+' : ''}${raw.toFixed(2)}; ${geometryMap ? 'geometry available' : 'no geometry'}`
              })
            }
            return results
          }
        : undefined
    this.decision = this.engine.evaluate(payload, this.settings, now, advisory)
    this.recordDecision(this.decision, now)

    if (
      this.decision.shouldSwitch &&
      !this.commandInFlight &&
      !this.pendingTargetSteamId &&
      now >= this.retryNotBefore
    ) {
      const target = this.decision.scores.find(
        (score) => score.steamId === this.decision?.candidateSteamId
      )
      if (target) void this.executeSwitch(target)
    }
    this.emitStatus()
  }

  private async executeSwitch(
    target: NonNullable<AutoDirectorStatus['decision']>['scores'][number]
  ): Promise<void> {
    this.commandInFlight = true
    const fromSteamId = this.decision?.currentSteamId ?? null
    try {
      this.lastCommand = await this.camera.switchTo(target, this.settings)
      this.updateTransportHealth(this.lastCommand)
      if (this.lastCommand.ok) {
        this.engine.confirmSwitch(target.steamId, this.lastCommand.at)
        if (this.observerConfirmationAvailable) {
          this.pendingTargetSteamId = target.steamId
          this.pendingTargetAt = this.lastCommand.at
        }
        this.addHistory({
          at: this.lastCommand.at,
          type: 'switch',
          message: this.lastCommand.message,
          fromSteamId,
          toSteamId: target.steamId,
          transport: this.lastCommand.transport
        })
      } else {
        this.retryNotBefore = this.lastCommand.at + 1500
        this.addHistory({
          at: this.lastCommand.at,
          type: 'transport-error',
          message: this.lastCommand.message,
          fromSteamId,
          toSteamId: target.steamId,
          transport: this.lastCommand.transport
        })
      }
    } finally {
      this.commandInFlight = false
      this.emitStatus()
    }
  }

  private async persistSettings(settings: AutoDirectorSettings): Promise<void> {
    await dbRun(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [SETTINGS_KEY, JSON.stringify(settings)]
    )
  }

  private recordDecision(decision: NonNullable<AutoDirectorStatus['decision']>, at: number): void {
    const signature = [
      decision.candidateSteamId,
      decision.shouldSwitch,
      decision.lockKind,
      decision.reason
    ].join('|')
    if (signature === this.lastDecisionSignature || at - this.lastDecisionHistoryAt < 750) return
    this.lastDecisionSignature = signature
    this.lastDecisionHistoryAt = at
    this.addHistory({
      at,
      type: 'decision',
      message: decision.reason,
      fromSteamId: decision.currentSteamId,
      toSteamId: decision.candidateSteamId
    })
  }

  private updateTransportHealth(command: NonNullable<AutoDirectorStatus['lastCommand']>): void {
    for (const attempt of command.attempts ?? [command]) {
      const previous = this.transportHealth[attempt.transport]
      const failures = attempt.ok ? 0 : previous.consecutiveFailures + 1
      this.transportHealth[attempt.transport] = {
        state: attempt.ok ? 'healthy' : failures >= 2 ? 'error' : 'degraded',
        lastCheckedAt: command.at,
        message: attempt.message,
        consecutiveFailures: failures
      }
    }
  }

  private addHistory(entry: DirectorHistoryEntry): void {
    this.history.unshift(entry)
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY
  }

  private emitStatus(): void {
    this.io?.emit('auto-director:update', this.getStatus())
  }
}

export const autoDirectorService = new AutoDirectorService()
