import type { Server } from 'socket.io'
import { randomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { sendTelnetCommands } from '../../../camera/telnet'
import { simulateObserverSlotKey } from '../../../camera/keySimulation'
import { dbGet, dbRun } from '../../database/sqlite'
import { getTelnetSettings } from '../settings/telnetSettings.repository'
import { AUTO_DIRECTOR_PROFILES, DEFAULT_AUTO_DIRECTOR_SETTINGS } from './autoDirector.config'
import {
  AutoDirectorEngine,
  normalizePlayers,
  type ScoreAdvisory,
  type ScoreAdvisoryResult
} from './autoDirector.engine'
import { buildAutoDirectorMlFeatures } from './autoDirector.mlFeatures'
import { AutoDirectorTemporalTracker, type TemporalPlayerFeatures } from './autoDirector.temporal'
import { autoDirectorMlAdvisory, LightGbmRanker, loadLightGbmRanker } from './autoDirector.ml'
import {
  persistSettingsCandidate,
  sanitizeAerialPresentationPhases,
  sanitizeHlaePresentationPhases
} from './autoDirector.settings'
import { CameraController } from './cameraController'
import { getAutoDirectorResourceDir } from '../../../paths'
import { computeGeometryFeatures } from './geometry/geometryFeatures'
import { GeometryRegistry } from './geometry/geometryRegistry'
import { computeTopologyFeatures } from './topology/topologyFeatures'
import { TopologyRegistry } from './topology/topologyRegistry'
import { AerialCameraRegistry, type AerialCameraAnchor } from './aerial/aerialCameraRegistry'
import {
  decideAerialPresentation,
  getAerialPresentationPhase,
  type AerialPresentationDecision
} from './aerial/aerialPresentation'
import { computeCameraDebugStatus, emptyCameraDebugStatus } from './cameraDebug'
import {
  HlaeCameraRegistry,
  getHlaeCameraPose,
  type HlaeCameraMap,
  type HlaeCameraPath
} from './hlae/hlaeCameraRegistry'
import { computeCameraVisibility } from './geometry/cameraVisibility'
import {
  detectHlaeRawAction,
  getHlaePhaseRemainingMs,
  getHlaeSafety,
  hasHlaeAction,
  isHlaeFreezePathInProgress,
  type HlaeRawAction,
  type HlaeSafetyState
} from './hlae/presentationSafety'
import type { GeometryMap } from './geometry/geometryMap'
import type {
  AutoDirectorSettings,
  AutoDirectorPreset,
  AutoDirectorStatus,
  CameraTransport,
  DirectorPlayer,
  DirectorHistoryEntry,
  GsiLikePayload,
  PlayerScore
} from './autoDirector.types'

const SETTINGS_KEY = 'autoDirectorSettings'
const MAX_HISTORY = 200
const AERIAL_MIN_CONFIRMATIONS = 2
const AERIAL_MAX_HOLD_MS = 6000
const AERIAL_SEQUENCE_GAP_MS = 250
const AERIAL_COOLDOWN_MS = 15000
const HLAE_PROBE_INTERVAL_MS = 5000
const HLAE_COOLDOWN_MS = 10000
const HLAE_OPENING_ROUTE_WINDOW_MS = 10000
const HLAE_PHASE_START_BUFFER_MS = 1000
const HLAE_FREEZE_CARRYOVER_MS = 2000
const MAX_CUSTOM_PRESETS = 20
const MAX_PRESET_NAME_LENGTH = 40
type HlaeSpawnTeam = 'CT' | 'T'

const getHlaeSpawnTeam = (pathEntry: HlaeCameraPath): HlaeSpawnTeam | null => {
  const name = `${pathEntry.id} ${pathEntry.label}`.toLowerCase()
  if (/ct[_ -]?spawn/.test(name)) return 'CT'
  if (/(^|[_ -])t[_ -]?spawn/.test(name)) return 'T'
  return null
}

const isHlaeOpeningRoute = (pathEntry: HlaeCameraPath): boolean =>
  /(?:running|opening|rush)/i.test(`${pathEntry.id} ${pathEntry.label}`)

type HlaePlantSite = 'site_a' | 'site_b'

const getHlaePlantSite = (pathEntry: HlaeCameraPath): HlaePlantSite | null => {
  const name = `${pathEntry.id} ${pathEntry.label}`.toLowerCase()
  if (/(?:^|[\s_-])a[\s_-]?site(?:[\s_-]|$)|site[\s_-]?a(?:[\s_-]|$)/.test(name)) {
    return 'site_a'
  }
  if (/(?:to|toward|towards)[\s_-]?a(?:[\s_-]|$)/.test(name)) return 'site_a'
  if (/(?:^|[\s_-])b[\s_-]?site(?:[\s_-]|$)|site[\s_-]?b(?:[\s_-]|$)/.test(name)) {
    return 'site_b'
  }
  if (/(?:to|toward|towards)[\s_-]?b(?:[\s_-]|$)/.test(name)) return 'site_b'
  return null
}

const isHlaeSiteRelevant = (
  pathEntry: HlaeCameraPath,
  visibleSteamIds: string[],
  players: DirectorPlayer[],
  scores: PlayerScore[]
): boolean => {
  const site = getHlaePlantSite(pathEntry)
  if (!site) return true

  const playersById = new Map(players.map((player) => [player.steamId, player]))
  const scoresById = new Map(scores.map((score) => [score.steamId, score]))
  const aliveT = players.filter((player) => player.alive && player.team === 'T')
  const visibleT = visibleSteamIds.some((steamId) => playersById.get(steamId)?.team === 'T')
  const bombCarrier = aliveT.find((player) => player.hasBomb)
  const bombCarrierSite = bombCarrier
    ? scoresById.get(bombCarrier.steamId)?.topologyPlantSite
    : null
  if (bombCarrierSite) return bombCarrierSite === site

  const tSiteCounts = new Map<HlaePlantSite, number>([
    ['site_a', 0],
    ['site_b', 0]
  ])
  for (const player of aliveT) {
    const playerSite = scoresById.get(player.steamId)?.topologyPlantSite
    if (playerSite) tSiteCounts.set(playerSite, tSiteCounts.get(playerSite)! + 1)
  }
  const siteCount = tSiteCounts.get(site) ?? 0
  const otherSiteCount = tSiteCounts.get(site === 'site_a' ? 'site_b' : 'site_a') ?? 0
  if (siteCount >= 2 || otherSiteCount >= 2) return siteCount > otherSiteCount
  return visibleT
}

const isTGroupRunning = (
  players: DirectorPlayer[],
  temporalFeatures: Map<string, TemporalPlayerFeatures>
): boolean => {
  const terrorists = players.filter((player) => player.team === 'T' && player.alive)
  if (terrorists.length < 3 || terrorists.some((player) => !player.position)) return false
  const runners = terrorists.filter(
    (player) => (temporalFeatures.get(player.steamId)?.speed500 ?? 0) >= 80
  )
  if (runners.length !== terrorists.length) return false
  const center = runners.reduce<[number, number, number]>(
    (sum, player) => [
      sum[0] + player.position![0],
      sum[1] + player.position![1],
      sum[2] + player.position![2]
    ],
    [0, 0, 0]
  )
  center[0] /= runners.length
  center[1] /= runners.length
  center[2] /= runners.length
  return runners.every(
    (player) =>
      Math.hypot(
        player.position![0] - center[0],
        player.position![1] - center[1],
        player.position![2] - center[2]
      ) <= 900
  )
}

const isHlaeRouteRelevant = (
  pathEntry: HlaeCameraPath,
  players: DirectorPlayer[],
  scores: PlayerScore[]
): boolean => {
  const targetSite = getHlaePlantSite(pathEntry)
  if (!targetSite) return true
  const playersById = new Map(scores.map((score) => [score.steamId, score]))
  const knownTargetSites = players
    .filter((player) => player.alive && player.team === 'T')
    .map((player) => playersById.get(player.steamId)?.topologyPlantSite)
    .filter((site): site is HlaePlantSite => site !== null && site !== undefined)
  return knownTargetSites.length === 0 || knownTargetSites.every((site) => site === targetSite)
}

const sanitizePreset = (input: unknown): AutoDirectorPreset => {
  if (!input || typeof input !== 'object') throw new Error('Invalid custom preset')
  const candidate = input as Record<string, unknown>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const mode = candidate.mode
  if (!id || id.length > 80) throw new Error('Custom preset id is invalid')
  if (!name || name.length > MAX_PRESET_NAME_LENGTH) {
    throw new Error(`Preset name must be 1-${MAX_PRESET_NAME_LENGTH} characters`)
  }
  if (!['balanced', 'reactive', 'calm'].includes(String(mode))) {
    throw new Error('Custom preset mode is invalid')
  }
  if (!candidate.weights || typeof candidate.weights !== 'object') {
    throw new Error('Custom preset weights are invalid')
  }
  const weights = Object.fromEntries(
    Object.entries(candidate.weights)
      .filter(([key]) => key in AUTO_DIRECTOR_PROFILES.balanced.weights)
      .map(([key, value]) => [key, Number(value)] as const)
      .filter(([, value]) => Number.isFinite(value) && value >= 0 && value <= 200)
  )
  const minimumDwellOverrideMs =
    candidate.minimumDwellOverrideMs === null ? null : Number(candidate.minimumDwellOverrideMs)
  const postDeathHoldMs = Number(candidate.postDeathHoldMs)
  if (
    (minimumDwellOverrideMs !== null &&
      (!Number.isFinite(minimumDwellOverrideMs) ||
        minimumDwellOverrideMs < 0 ||
        minimumDwellOverrideMs > 5000)) ||
    !Number.isFinite(postDeathHoldMs) ||
    postDeathHoldMs < 0 ||
    postDeathHoldMs > 2000
  ) {
    throw new Error('Custom preset timing is invalid')
  }
  return {
    id,
    name,
    mode: mode as AutoDirectorPreset['mode'],
    weights,
    minimumDwellOverrideMs:
      minimumDwellOverrideMs === null ? null : Math.round(minimumDwellOverrideMs),
    postDeathHoldMs: Math.round(postDeathHoldMs)
  }
}

const sanitizeSettings = (
  input: Partial<AutoDirectorSettings>,
  aerialPresentationPhases = DEFAULT_AUTO_DIRECTOR_SETTINGS.aerialPresentationPhases,
  hlaePresentationPhases = DEFAULT_AUTO_DIRECTOR_SETTINGS.hlaePresentationPhases
): Partial<AutoDirectorSettings> => {
  const output: Partial<AutoDirectorSettings> = {}
  if (typeof input.enabled === 'boolean') output.enabled = input.enabled
  if (typeof input.paused === 'boolean') output.paused = input.paused
  if (['balanced', 'reactive', 'calm'].includes(String(input.mode))) output.mode = input.mode
  if (typeof input.autoFallback === 'boolean') output.autoFallback = input.autoFallback
  if (typeof input.rulesEnabled === 'boolean') output.rulesEnabled = input.rulesEnabled
  if (typeof input.sceneAdvisoryEnabled === 'boolean')
    output.sceneAdvisoryEnabled = input.sceneAdvisoryEnabled
  if (typeof input.storyPlannerEnabled === 'boolean')
    output.storyPlannerEnabled = input.storyPlannerEnabled
  if (typeof input.geometryAdvisoryEnabled === 'boolean')
    output.geometryAdvisoryEnabled = input.geometryAdvisoryEnabled
  if (typeof input.mlAdvisoryEnabled === 'boolean')
    output.mlAdvisoryEnabled = input.mlAdvisoryEnabled
  if (typeof input.aerialPresentationEnabled === 'boolean') {
    output.aerialPresentationEnabled = input.aerialPresentationEnabled
  }
  if (input.aerialPresentationPhases && typeof input.aerialPresentationPhases === 'object') {
    output.aerialPresentationPhases = sanitizeAerialPresentationPhases(
      input.aerialPresentationPhases,
      aerialPresentationPhases
    )
  }
  if (typeof input.hlaePresentationEnabled === 'boolean') {
    output.hlaePresentationEnabled = input.hlaePresentationEnabled
  }
  if (input.hlaePresentationPhases && typeof input.hlaePresentationPhases === 'object') {
    output.hlaePresentationPhases = sanitizeHlaePresentationPhases(
      input.hlaePresentationPhases,
      hlaePresentationPhases
    )
  }
  if (input.hlaeDurationOverrides && typeof input.hlaeDurationOverrides === 'object') {
    output.hlaeDurationOverrides = Object.fromEntries(
      Object.entries(input.hlaeDurationOverrides)
        .filter(([key]) => /^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(key))
        .map(([key, value]) => [key, Number(value)] as const)
        .filter(([, value]) => Number.isFinite(value) && value >= 0.5 && value <= 300)
        .map(([key, value]) => [key, Math.round(value * 10) / 10] as const)
    )
  }
  if (input.minimumDwellOverrideMs !== undefined) {
    if (input.minimumDwellOverrideMs === null) {
      output.minimumDwellOverrideMs = null
    } else {
      const dwell = Number(input.minimumDwellOverrideMs)
      if (!Number.isFinite(dwell) || dwell < 0 || dwell > 5000) {
        throw new Error('POV lock must be 0-5000 ms')
      }
      output.minimumDwellOverrideMs = Math.round(dwell)
    }
  }
  if (input.postDeathHoldMs !== undefined) {
    const hold = Number(input.postDeathHoldMs)
    if (!Number.isFinite(hold) || hold < 0 || hold > 2000) {
      throw new Error('Post-death hold must be 0-2000 ms')
    }
    output.postDeathHoldMs = Math.round(hold)
  }
  if (input.customPresets !== undefined) {
    if (!Array.isArray(input.customPresets) || input.customPresets.length > MAX_CUSTOM_PRESETS) {
      throw new Error(`You can save up to ${MAX_CUSTOM_PRESETS} custom presets`)
    }
    const presets = input.customPresets.map(sanitizePreset)
    const names = new Set<string>()
    for (const preset of presets) {
      const name = preset.name.toLowerCase()
      if (names.has(name)) throw new Error('Custom preset names must be unique')
      names.add(name)
    }
    output.customPresets = presets
  }
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
  private readonly temporal = new AutoDirectorTemporalTracker()
  private readonly camera = new CameraController(
    getTelnetSettings,
    sendTelnetCommands,
    simulateObserverSlotKey
  )
  private readonly geometry = new GeometryRegistry(
    path.join(getAutoDirectorResourceDir(), 'geometry')
  )
  private readonly topology = new TopologyRegistry(
    path.join(getAutoDirectorResourceDir(), 'topology')
  )
  private readonly aerial = new AerialCameraRegistry(
    path.join(getAutoDirectorResourceDir(), 'aerial')
  )
  private readonly hlae = new HlaeCameraRegistry(path.join(getAutoDirectorResourceDir(), 'hlae'))
  private mlRanker: LightGbmRanker | null = null
  private mlModelMessage = 'Model not loaded'
  private roundStartedAt = 0
  private roundLiveStartedAt = 0
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
  private previousTopologyPlayers = new Map<string, DirectorPlayer>()
  private previousTopologyAt = 0
  private previousObservedPlayers = new Map<string, DirectorPlayer>()
  private previousObservedRoundKey = ''
  private previousObservedBombState: string | null = null
  private previousObservedPhaseKey = ''
  private hlaeActionPending = false
  private hlaeStateVersion = 0
  private statusTimer: NodeJS.Timeout | null = null
  private aerialActiveAnchor: AerialCameraAnchor | null = null
  private aerialActiveUntil = 0
  private aerialCooldownUntil = 0
  private aerialCandidateId: string | null = null
  private aerialCandidateConfirmations = 0
  private aerialReason = 'Aerial presentation disabled'
  private aerialVisibleSteamIds: string[] = []
  private aerialActivePhase: ReturnType<typeof getAerialPresentationPhase> = null
  private aerialSequencePhase: ReturnType<typeof getAerialPresentationPhase> = null
  private aerialSequenceAnchorIds = new Set<string>()
  private hlaeActivePath: HlaeCameraPath | null = null
  private hlaeManualOverride = false
  private hlaeActivePhase: ReturnType<typeof getAerialPresentationPhase> = null
  private hlaeActiveStartedAt = 0
  private hlaeActiveUntil = 0
  private hlaeLastActionAt = 0
  private hlaeCooldownUntil = 0
  private hlaeLastProbeAt = 0
  private hlaeProbeInFlight = false
  private hlaeAvailable = false
  private hlaeState: 'disabled' | 'missing' | 'checking' | 'ready' | 'unavailable' | 'error' =
    'disabled'
  private hlaeMessage = 'HLAE presentation disabled'
  private hlaeSafety: HlaeSafetyState = {
    allowed: false,
    actionBlocked: false,
    calmForMs: 0,
    reason: 'HLAE presentation disabled'
  }
  private hlaePathCoverage = new Map<string, { startVisibleCount: number; startScore: number }>()
  private hlaeDebug: Pick<
    AutoDirectorStatus['hlae'],
    | 'activePose'
    | 'visibleSteamIds'
    | 'occludedSteamIds'
    | 'inFrustumSteamIds'
    | 'players'
    | 'summary'
  > = {
    activePose: null,
    visibleSteamIds: [],
    occludedSteamIds: [],
    inFrustumSteamIds: [],
    players: [],
    summary: 'Waiting for GSI state'
  }
  private hlaeFreezeSpawnTeams = new Set<HlaeSpawnTeam>()
  private hlaeFreezeSpawnOrder: HlaeSpawnTeam[] = []
  private hlaeLastFreezeSpawnPathIds = new Map<HlaeSpawnTeam, string>()
  private cameraDebug = emptyCameraDebugStatus()

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
    const aerialStatus = this.aerial.getStatus()
    const hlaeStatus = this.hlae.getStatus()
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
        geometry: this.geometry.getStatus(),
        topology: this.topology.getStatus()
      },
      aerial: {
        enabled: this.settings.aerialPresentationEnabled,
        mapName: aerialStatus.mapName,
        state: aerialStatus.state,
        anchorCount: aerialStatus.anchorCount,
        message: aerialStatus.message,
        activeAnchorId: this.aerialActiveAnchor?.id ?? null,
        activeAnchorLabel: this.aerialActiveAnchor?.label ?? null,
        activeUntil: this.aerialActiveAnchor ? this.aerialActiveUntil : null,
        reason: this.aerialReason,
        visibleSteamIds: [...this.aerialVisibleSteamIds]
      },
      hlae: {
        enabled: this.settings.hlaePresentationEnabled,
        mapName: hlaeStatus.mapName,
        state:
          this.settings.hlaePresentationEnabled || this.hlaeManualOverride
            ? this.hlaeState
            : 'disabled',
        pathCount: hlaeStatus.pathCount,
        message:
          this.settings.hlaePresentationEnabled || this.hlaeManualOverride
            ? this.hlaeMessage
            : 'HLAE presentation disabled',
        activePathId: this.hlaeActivePath?.id ?? null,
        activePathLabel: this.hlaeActivePath?.label ?? null,
        activeUntil: this.hlaeActivePath ? this.hlaeActiveUntil : null,
        safety: { ...this.hlaeSafety },
        ...this.hlaeDebug,
        paths: hlaeStatus.paths.map((pathEntry) => ({
          ...pathEntry,
          durationSeconds: this.getHlaeDuration(
            hlaeStatus.mapName,
            pathEntry.id,
            pathEntry.durationSeconds
          ),
          baseDurationSeconds: pathEntry.durationSeconds,
          startVisibleCount: this.hlaePathCoverage.get(pathEntry.id)?.startVisibleCount ?? 0,
          startScore: this.hlaePathCoverage.get(pathEntry.id)?.startScore ?? 0
        }))
      },
      cameraDebug: structuredClone(this.cameraDebug)
    }
  }

  getGeometryRenderData(mapName: string) {
    const geometry = this.geometry.load(mapName)
    return geometry?.toRenderArtifact() ?? null
  }

  async updateSettings(input: Partial<AutoDirectorSettings>): Promise<AutoDirectorStatus> {
    const next = sanitizeSettings(
      input,
      this.settings.aerialPresentationPhases,
      this.settings.hlaePresentationPhases
    )
    const directorDisabled = (next.enabled ?? this.settings.enabled) === false
    if (directorDisabled) {
      next.autoFallback = false
      next.manualOverrideSteamId = null
    }
    const previousOverride = this.settings.manualOverrideSteamId
    const aerialReturnTarget =
      (next.aerialPresentationEnabled === false || directorDisabled) && this.aerialActiveAnchor
        ? this.getAerialReturnTarget()
        : null
    this.settings = await persistSettingsCandidate(this.settings, next, (candidate) =>
      this.persistSettings(candidate)
    )
    const activeMapName = this.hlae.getStatus().mapName
    const activeDuration =
      this.hlaeActivePath && activeMapName
        ? next.hlaeDurationOverrides?.[`${activeMapName}/${this.hlaeActivePath.id}`]
        : undefined
    if (
      this.settings.hlaePresentationEnabled &&
      this.hlaeActivePath &&
      Number.isFinite(activeDuration) &&
      !this.commandInFlight
    ) {
      void this.updateActiveHlaeDuration(Number(activeDuration))
    }
    if (directorDisabled) {
      this.engine.setCurrent(null)
      this.pendingTargetSteamId = null
      this.decision = null
      this.cameraDebug = emptyCameraDebugStatus()
    }
    if (
      (next.aerialPresentationEnabled === false || directorDisabled) &&
      this.aerialActiveAnchor &&
      !this.commandInFlight
    ) {
      if (aerialReturnTarget) {
        void this.exitAerial(
          aerialReturnTarget,
          directorDisabled
            ? 'Operator disabled Auto Director'
            : 'Operator disabled Aerial presentation'
        )
      } else {
        this.clearAerialPresentation(
          Date.now(),
          directorDisabled
            ? 'Operator disabled Auto Director'
            : 'Operator disabled Aerial presentation'
        )
      }
    } else if (directorDisabled) {
      this.clearAerialPresentation(Date.now(), 'Operator disabled Auto Director')
    }
    if (next.hlaePresentationEnabled === false || directorDisabled) {
      if (this.hlaeActivePath && !this.commandInFlight)
        void this.exitHlae('HLAE presentation disabled')
      else if (directorDisabled) this.clearHlaePresentation(Date.now(), 'Auto Director disabled')
    } else if (next.hlaePresentationEnabled === true) {
      this.hlaeState = 'checking'
      this.hlaeMessage = 'Checking HLAE connection'
      void this.refreshHlaeAvailability(true)
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
    if (!this.settings.enabled) {
      const message = 'Auto-director is disabled'
      this.lastCommand = {
        ok: false,
        transport,
        message,
        at: Date.now(),
        attempts: [{ transport, ok: false, message }]
      }
    } else {
      this.lastCommand = await this.camera.test(transport, this.settings, observerSlot)
    }
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

  async launchHlaePath(pathId: string): Promise<AutoDirectorStatus> {
    const mapName = this.hlae.getStatus().mapName
    if (!mapName) throw new Error('Waiting for a GSI map before launching HLAE')
    const map = this.hlae.load(mapName)
    const normalizedPathId = String(pathId).trim().toLowerCase()
    const pathEntry = map?.paths.find((entry) => entry.id === normalizedPathId)
    if (!pathEntry) throw new Error(`HLAE campath not found: ${pathId}`)
    if (this.commandInFlight) throw new Error('A camera command is already in flight')
    if (this.aerialActiveAnchor) {
      const target = this.getAerialReturnTarget()
      if (!target) throw new Error('Cannot launch HLAE while Aerial camera is active')
      await this.exitAerial(target, 'Operator launched HLAE campath')
      if (this.aerialActiveAnchor) throw new Error('Could not release the Aerial camera')
    }
    await this.enterHlae(pathEntry, mapName, null, Date.now(), true)
    return this.getStatus()
  }

  processGsi(payload: GsiLikePayload): void {
    const now = Date.now()
    this.lastGsiAt = now
    const players = normalizePlayers(payload)
    const roundKey = `${payload.map?.name ?? ''}:${payload.map?.round ?? ''}`
    const rawAction: HlaeRawAction = detectHlaeRawAction(
      players,
      this.previousObservedRoundKey === roundKey ? this.previousObservedPlayers : new Map(),
      payload,
      this.previousObservedRoundKey === roundKey ? this.previousObservedBombState : null
    )
    const phaseKey = `${payload.map?.phase ?? ''}:${payload.round?.phase ?? payload.phase_countdowns?.phase ?? ''}:${payload.bomb?.state ?? ''}`
    const phaseChanged =
      this.previousObservedPhaseKey !== '' && phaseKey !== this.previousObservedPhaseKey
    this.previousObservedPlayers = new Map(players.map((player) => [player.steamId, player]))
    this.previousObservedRoundKey = roundKey
    this.previousObservedBombState = String(payload.bomb?.state ?? '').toLowerCase() || null
    this.previousObservedPhaseKey = phaseKey
    if (rawAction.detected || phaseChanged) this.hlaeStateVersion += 1
    if (rawAction.detected) {
      this.hlaeLastActionAt = now
      this.hlaeActionPending = true
    }
    if (!this.settings.enabled) return
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

    if (this.roundStartedAt === 0 || roundKey !== this.lastRoundKey) {
      if (this.roundStartedAt !== 0 && roundKey !== this.lastRoundKey) this.resetAerialSequence()
      if (this.roundStartedAt !== 0 && roundKey !== this.lastRoundKey) {
        this.hlaeFreezeSpawnTeams.clear()
        this.hlaeFreezeSpawnOrder = []
      }
      this.lastRoundKey = roundKey
      this.roundStartedAt = now
      this.roundLiveStartedAt = 0
      this.hlaeLastActionAt = 0
      const currentSteamId = this.engine.getCurrent()
      this.engine.reset()
      if (currentSteamId) this.engine.setCurrent(currentSteamId, now)
      this.temporal.reset()
      this.previousTopologyPlayers.clear()
      this.previousTopologyAt = 0
    }
    const temporalFeatures = this.temporal.update(players, now)
    const needsGeometry =
      this.settings.geometryAdvisoryEnabled ||
      (this.settings.mlAdvisoryEnabled && this.mlRanker !== null) ||
      this.settings.sceneAdvisoryEnabled ||
      this.settings.aerialPresentationEnabled ||
      this.settings.hlaePresentationEnabled ||
      this.hlaeManualOverride
    const geometryMap =
      needsGeometry && payload.map?.name ? this.geometry.load(payload.map.name) : null
    const geometryFeatures = geometryMap
      ? computeGeometryFeatures(
          players.filter((player) => player.alive),
          geometryMap
        )
      : null
    const aerialMap = payload.map?.name ? this.aerial.load(payload.map.name) : null
    const hlaeMap = payload.map?.name ? this.hlae.load(payload.map.name) : null
    if (this.settings.hlaePresentationEnabled) void this.refreshHlaeAvailability()
    const topologyMap =
      this.settings.sceneAdvisoryEnabled && payload.map?.name
        ? this.topology.load(payload.map.name)
        : null
    const topologyFeatures = topologyMap
      ? computeTopologyFeatures(
          players.filter((player) => player.alive),
          topologyMap,
          geometryMap,
          this.previousTopologyPlayers,
          this.previousTopologyAt
            ? Math.max(25, Math.min(1000, now - this.previousTopologyAt))
            : 100
        )
      : null
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
              const prediction = autoDirectorMlAdvisory(
                this.mlRanker,
                buildAutoDirectorMlFeatures(
                  player,
                  score,
                  allPlayers,
                  now - this.roundStartedAt,
                  playerGeometry,
                  geometryMap !== null,
                  temporalFeatures.get(player.steamId) ?? null,
                  this.mlRanker.featureNames
                )
              )
              results.push({
                key: 'mlAdvisory' as const,
                value: prediction.value,
                detail: `${prediction.detail}; ${geometryMap ? 'geometry available' : 'no geometry'}`
              })
            }
            return results
          }
        : undefined
    this.decision = this.engine.evaluate(
      payload,
      this.settings,
      now,
      advisory,
      geometryFeatures ?? undefined,
      topologyFeatures ?? undefined
    )
    const hlaeActionDetected = hasHlaeAction(this.decision.scores) || this.hlaeActionPending
    this.hlaeActionPending = false
    if (hlaeActionDetected) this.hlaeLastActionAt = now
    this.cameraDebug = computeCameraDebugStatus({
      mapName: payload.map?.name ? String(payload.map.name) : null,
      at: now,
      players,
      scores: this.decision.scores,
      geometryFeatures,
      geometry: geometryMap,
      anchors: aerialMap?.anchors ?? [],
      currentPlayerSteamId: this.decision.currentSteamId,
      candidatePlayerSteamId: this.decision.candidateSteamId,
      activeAnchorId: this.aerialActiveAnchor?.id ?? null,
      geometryMessage: this.geometry.getStatus().message
    })
    this.previousTopologyPlayers = new Map(players.map((player) => [player.steamId, player]))
    this.previousTopologyAt = now
    this.recordDecision(this.decision, now)

    const aerialPhase = getAerialPresentationPhase(payload)
    if (aerialPhase !== this.aerialSequencePhase) {
      if (aerialPhase === 'quiet-live' && this.aerialSequencePhase === 'freeze-time') {
        this.roundLiveStartedAt = now
      } else if (aerialPhase === 'quiet-live' && this.roundLiveStartedAt === 0) {
        this.roundLiveStartedAt = now
      } else if (aerialPhase === 'freeze-time') {
        this.roundLiveStartedAt = 0
      }
      this.aerialSequencePhase = aerialPhase
      this.aerialSequenceAnchorIds.clear()
    }
    const aerialDecision = decideAerialPresentation(
      payload,
      this.settings,
      players,
      this.decision,
      aerialMap,
      geometryMap,
      {
        excludedAnchorIds: this.aerialActiveAnchor ? undefined : this.aerialSequenceAnchorIds
      }
    )
    const hlaeFirst =
      aerialPhase === 'freeze-time' ||
      aerialPhase === 'post-round' ||
      this.isHlaeOpeningRouteWindow(aerialPhase, now, players, temporalFeatures)
    const decisionScores = this.decision.scores
    const hlaePhaseRemainingMs = getHlaePhaseRemainingMs(payload)
    const handleHlae = () =>
      this.handleHlaePresentation(
        hlaeMap,
        aerialPhase,
        now,
        players,
        decisionScores,
        geometryMap,
        temporalFeatures,
        hlaeActionDetected,
        hlaePhaseRemainingMs,
        Boolean(this.decision && (this.decision.shouldSwitch || this.decision.lockKind !== 'none'))
      )
    const presentationControlsCamera = this.hlaeActivePath
      ? handleHlae()
      : this.aerialActiveAnchor
        ? this.handleAerialPresentation(aerialDecision, now)
        : hlaeFirst
          ? handleHlae() || this.handleAerialPresentation(aerialDecision, now)
          : this.handleAerialPresentation(aerialDecision, now) || handleHlae()

    if (
      this.decision.shouldSwitch &&
      !presentationControlsCamera &&
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
    if (!this.settings.enabled) return
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

  private async refreshHlaeAvailability(force = false): Promise<void> {
    if (!this.settings.hlaePresentationEnabled) {
      this.hlaeAvailable = false
      this.hlaeState = 'disabled'
      this.hlaeMessage = 'HLAE presentation disabled'
      return
    }
    const registryStatus = this.hlae.getStatus()
    if (registryStatus.pathCount === 0) {
      this.hlaeAvailable = false
      this.hlaeState = registryStatus.state === 'error' ? 'error' : 'missing'
      this.hlaeMessage = registryStatus.message
      return
    }
    const now = Date.now()
    if (
      this.hlaeProbeInFlight ||
      (!force && this.hlaeAvailable && now - this.hlaeLastProbeAt < HLAE_PROBE_INTERVAL_MS)
    ) {
      return
    }
    this.hlaeProbeInFlight = true
    this.hlaeLastProbeAt = now
    this.hlaeState = 'checking'
    this.hlaeMessage = 'Checking HLAE connection'
    this.emitStatus()
    try {
      const result = await this.camera.probeHlae()
      this.lastCommand = result
      this.updateTransportHealth(result)
      this.hlaeAvailable = result.ok
      this.hlaeState = result.ok ? 'ready' : 'unavailable'
      this.hlaeMessage = result.ok ? 'HLAE detected and ready' : result.message
      if (!result.ok) this.hlaeCooldownUntil = result.at + HLAE_PROBE_INTERVAL_MS
    } catch (error) {
      this.hlaeAvailable = false
      this.hlaeState = 'error'
      this.hlaeMessage = error instanceof Error ? error.message : String(error)
    } finally {
      this.hlaeProbeInFlight = false
      this.emitStatus()
    }
  }

  private getHlaeDuration(mapName: string | null, pathId: string, rawDuration: number): number {
    const key = mapName ? `${mapName}/${pathId}` : pathId
    return this.settings.hlaeDurationOverrides[key] ?? rawDuration
  }

  private evaluateHlaePath(
    pathEntry: HlaeCameraPath,
    elapsedSeconds: number,
    players: DirectorPlayer[],
    geometry: GeometryMap | null,
    durationSeconds: number
  ) {
    const pose = getHlaeCameraPose(pathEntry, elapsedSeconds, durationSeconds)
    const visibility = geometry
      ? computeCameraVisibility(
          { position: pose.position, angles: pose.angles },
          players,
          geometry,
          { horizontalFovDegrees: pose.fov }
        )
      : new Map()
    const alive = players.filter((player) => player.alive && player.position)
    const inFrustumSteamIds = alive
      .filter((player) => visibility.get(player.steamId)?.inFrustum)
      .map((player) => player.steamId)
    const visibleSteamIds = alive
      .filter((player) => visibility.get(player.steamId)?.visible)
      .map((player) => player.steamId)
    const occludedSteamIds = inFrustumSteamIds.filter((id) => !visibleSteamIds.includes(id))
    return {
      pose,
      visibleSteamIds,
      occludedSteamIds,
      inFrustumSteamIds,
      score: visibleSteamIds.length * 20
    }
  }

  private updateHlaeDebug(
    pathEntry: HlaeCameraPath | null,
    players: DirectorPlayer[],
    geometry: GeometryMap | null,
    now: number,
    durationSeconds = pathEntry ? pathEntry.durationSeconds : 0
  ): void {
    this.hlaeDebug.players = players.map((player) => ({
      steamId: player.steamId,
      name: player.name,
      team: player.team,
      alive: player.alive,
      position: player.position ? [...player.position] : null
    }))
    if (!pathEntry || !this.hlaeActiveStartedAt) {
      this.hlaeDebug.activePose = null
      this.hlaeDebug.visibleSteamIds = []
      this.hlaeDebug.occludedSteamIds = []
      this.hlaeDebug.inFrustumSteamIds = []
      this.hlaeDebug.summary = geometry
        ? `${players.filter((player) => player.alive).length} alive · no active campath`
        : 'Player positions live · geometry unavailable'
      return
    }
    const evaluation = this.evaluateHlaePath(
      pathEntry,
      (now - this.hlaeActiveStartedAt) / 1000,
      players,
      geometry,
      durationSeconds
    )
    this.hlaeDebug.activePose = {
      position: [...evaluation.pose.position],
      angles: [...evaluation.pose.angles],
      fov: evaluation.pose.fov,
      progress: evaluation.pose.progress
    }
    this.hlaeDebug.visibleSteamIds = evaluation.visibleSteamIds
    this.hlaeDebug.occludedSteamIds = evaluation.occludedSteamIds
    this.hlaeDebug.inFrustumSteamIds = evaluation.inFrustumSteamIds
    this.hlaeDebug.summary = geometry
      ? `${evaluation.visibleSteamIds.length} visible · ${evaluation.occludedSteamIds.length} occluded · ${Math.round(evaluation.pose.progress * 100)}% path`
      : 'Player positions live · geometry unavailable'
  }

  private isHlaePathWindowViable(
    pathEntry: HlaeCameraPath,
    players: DirectorPlayer[],
    geometry: GeometryMap | null,
    durationSeconds: number,
    phase: ReturnType<typeof getAerialPresentationPhase>
  ): boolean {
    if ((phase !== 'quiet-live' && phase !== 'freeze-time') || !geometry) return true
    // ponytail: cap long paths at 16 forecast samples; raise only after profiling geometry cost.
    const sampleCount = Math.min(16, Math.max(2, Math.ceil(durationSeconds) + 1))
    const visibleAtSample: boolean[] = []
    const aimedAtSample: boolean[] = []
    for (let index = 0; index < sampleCount; index += 1) {
      const progress = index / (sampleCount - 1)
      const evaluation = this.evaluateHlaePath(
        pathEntry,
        durationSeconds * progress,
        players,
        geometry,
        durationSeconds
      )
      visibleAtSample.push(evaluation.visibleSteamIds.length > 0)
      aimedAtSample.push(evaluation.inFrustumSteamIds.length > 0)
    }
    if (phase === 'freeze-time') {
      return aimedAtSample.some(Boolean) && visibleAtSample.some(Boolean)
    }
    return visibleAtSample.every(Boolean)
  }

  private selectHlaePath(
    map: HlaeCameraMap,
    players: DirectorPlayer[],
    scores: PlayerScore[],
    geometry: GeometryMap | null,
    phase: ReturnType<typeof getAerialPresentationPhase>,
    now: number,
    excludePathId: string | undefined,
    temporalFeatures: Map<string, TemporalPlayerFeatures>,
    phaseRemainingMs: number | null
  ): HlaeCameraPath | null {
    this.hlaePathCoverage.clear()
    const knownFreezeSpawnTeams = new Set(
      map.paths.map((pathEntry) => getHlaeSpawnTeam(pathEntry)).filter(Boolean)
    )
    const availableFreezeSpawnTeams: HlaeSpawnTeam[] = (['T', 'CT'] as const).filter((team) =>
      knownFreezeSpawnTeams.has(team)
    )
    if (phase === 'freeze-time' && this.hlaeFreezeSpawnOrder.length === 0) {
      this.hlaeFreezeSpawnOrder = [...availableFreezeSpawnTeams]
      if (this.hlaeFreezeSpawnOrder.length === 2 && randomInt(2) === 1) {
        this.hlaeFreezeSpawnOrder.reverse()
      }
    }
    const requiredFreezeSpawnTeam =
      phase === 'freeze-time'
        ? (this.hlaeFreezeSpawnOrder.find((team) => !this.hlaeFreezeSpawnTeams.has(team)) ?? null)
        : null
    const evaluations = map.paths.map((pathEntry) => {
      const durationSeconds = this.getHlaeDuration(
        map.mapName,
        pathEntry.id,
        pathEntry.durationSeconds
      )
      const evaluation = this.evaluateHlaePath(pathEntry, 0, players, geometry, durationSeconds)
      this.hlaePathCoverage.set(pathEntry.id, {
        startVisibleCount: evaluation.visibleSteamIds.length,
        startScore: evaluation.score
      })
      return { pathEntry, evaluation, durationSeconds }
    })
    const eligible = evaluations
      .filter(
        ({ pathEntry, evaluation, durationSeconds }) =>
          pathEntry.id !== excludePathId &&
          (!isHlaeOpeningRoute(pathEntry) ||
            this.isHlaeOpeningRouteWindow(phase, now, players, temporalFeatures)) &&
          (!isHlaeOpeningRoute(pathEntry) || isHlaeRouteRelevant(pathEntry, players, scores)) &&
          isHlaeSiteRelevant(pathEntry, evaluation.visibleSteamIds, players, scores) &&
          this.isHlaePathWindowViable(pathEntry, players, geometry, durationSeconds, phase) &&
          ((phase !== 'freeze-time' && phase !== 'post-round') ||
            (phaseRemainingMs !== null &&
              durationSeconds * 1000 + HLAE_PHASE_START_BUFFER_MS <= phaseRemainingMs)) &&
          (phase === 'freeze-time' && pathEntry.kind === 'spawn'
            ? knownFreezeSpawnTeams.size === 0
              ? true
              : requiredFreezeSpawnTeam !== null &&
                getHlaeSpawnTeam(pathEntry) === requiredFreezeSpawnTeam
            : evaluation.visibleSteamIds.length > 0)
      )
      .sort(
        (left, right) =>
          right.evaluation.score - left.evaluation.score ||
          right.evaluation.visibleSteamIds.length - left.evaluation.visibleSteamIds.length ||
          left.pathEntry.id.localeCompare(right.pathEntry.id)
      )
    if (!eligible.length) return null
    const openingRouteWindow = this.isHlaeOpeningRouteWindow(phase, now, players, temporalFeatures)
    const candidates =
      openingRouteWindow && eligible.some(({ pathEntry }) => isHlaeOpeningRoute(pathEntry))
        ? eligible.filter(({ pathEntry }) => isHlaeOpeningRoute(pathEntry))
        : eligible
    if (phase === 'freeze-time' && requiredFreezeSpawnTeam) {
      const spawnCandidates = candidates.filter(
        ({ pathEntry }) => getHlaeSpawnTeam(pathEntry) === requiredFreezeSpawnTeam
      )
      if (spawnCandidates.length) {
        const previousId = this.hlaeLastFreezeSpawnPathIds.get(requiredFreezeSpawnTeam)
        const variedCandidates =
          spawnCandidates.length > 1
            ? spawnCandidates.filter(({ pathEntry }) => pathEntry.id !== previousId)
            : spawnCandidates
        return variedCandidates[randomInt(variedCandidates.length)].pathEntry
      }
    }
    const preferred = this.hlae.next(map.mapName)
    return (
      candidates.find(({ pathEntry }) => pathEntry.id === preferred?.id)?.pathEntry ??
      candidates[0].pathEntry
    )
  }

  private isHlaeOpeningRouteWindow(
    phase: ReturnType<typeof getAerialPresentationPhase>,
    now: number,
    players: DirectorPlayer[],
    temporalFeatures: Map<string, TemporalPlayerFeatures>
  ): boolean {
    return (
      phase === 'quiet-live' &&
      this.roundLiveStartedAt > 0 &&
      now >= this.roundLiveStartedAt &&
      now - this.roundLiveStartedAt <= HLAE_OPENING_ROUTE_WINDOW_MS &&
      isTGroupRunning(players, temporalFeatures)
    )
  }

  private isHlaePhaseEnabled(phase: ReturnType<typeof getAerialPresentationPhase>): boolean {
    if (phase === 'freeze-time') return this.settings.hlaePresentationPhases.freezeTime
    if (phase === 'post-round') return this.settings.hlaePresentationPhases.roundEnd
    if (phase) return this.settings.hlaePresentationPhases.midRound
    return false
  }

  private isSameHlaePhase(
    left: ReturnType<typeof getAerialPresentationPhase>,
    right: ReturnType<typeof getAerialPresentationPhase>
  ): boolean {
    const bucket = (phase: ReturnType<typeof getAerialPresentationPhase>) =>
      phase === 'freeze-time'
        ? 'freeze-time'
        : phase === 'post-round'
          ? 'post-round'
          : phase
            ? 'mid-round'
            : null
    return bucket(left) === bucket(right)
  }

  /** HLAE owns the camera only while a selected campath is running. */
  private handleHlaePresentation(
    map: HlaeCameraMap | null,
    phase: ReturnType<typeof getAerialPresentationPhase>,
    now: number,
    players: DirectorPlayer[],
    scores: PlayerScore[],
    geometry: GeometryMap | null,
    temporalFeatures: Map<string, TemporalPlayerFeatures>,
    hlaeActionDetected: boolean,
    phaseRemainingMs: number | null,
    povLockActive: boolean
  ): boolean {
    if (!this.settings.hlaePresentationEnabled && !this.hlaeManualOverride) {
      if (this.hlaeActivePath && !this.commandInFlight)
        void this.exitHlae('HLAE presentation disabled')
      return Boolean(this.hlaeActivePath || this.commandInFlight)
    }
    if (this.aerialActiveAnchor) return false
    if (!map?.paths.length) {
      this.updateHlaeDebug(null, players, geometry, now)
      this.hlaeState = 'missing'
      this.hlaeMessage = map ? `No HLAE campaths for ${map.mapName}` : 'Waiting for a GSI map'
      return false
    }
    if (!this.hlaeAvailable) {
      this.updateHlaeDebug(null, players, geometry, now)
      return false
    }
    const genericPhaseEnabled = this.isHlaePhaseEnabled(phase)
    const openingRouteWindow = this.isHlaeOpeningRouteWindow(phase, now, players, temporalFeatures)
    const openingRouteActive = Boolean(
      this.hlaeActivePath && isHlaeOpeningRoute(this.hlaeActivePath)
    )
    const roundEndCarryover = Boolean(
      this.hlaeActivePath && this.hlaeActivePhase === 'post-round' && phase === 'freeze-time'
    )
    const freezeCarryover = Boolean(
      this.hlaeActivePath &&
      this.hlaeActivePhase === 'freeze-time' &&
      phase === 'quiet-live' &&
      this.roundLiveStartedAt > 0 &&
      now - this.roundLiveStartedAt <= HLAE_FREEZE_CARRYOVER_MS
    )
    const freezePathInProgress =
      Boolean(this.hlaeActivePath) &&
      isHlaeFreezePathInProgress(this.hlaeActivePhase, phase, now, this.hlaeActiveUntil)
    const safety = getHlaeSafety({
      phase,
      now,
      roundLiveStartedAt: this.roundLiveStartedAt,
      lastActionAt: this.hlaeLastActionAt,
      scores,
      rawActionDetected: hlaeActionDetected,
      povLockActive
    })
    this.hlaeSafety = safety
    const phaseSafe = phase === 'quiet-live' ? safety.allowed : phase !== 'post-plant'
    const openingRouteAllowed = openingRouteWindow && !safety.actionBlocked
    const phaseEnabled =
      (genericPhaseEnabled && phaseSafe) ||
      openingRouteAllowed ||
      (openingRouteActive && phase === 'quiet-live') ||
      roundEndCarryover ||
      (freezeCarryover && !safety.actionBlocked) ||
      freezePathInProgress
    if (this.hlaeManualOverride && this.hlaeActivePath) {
      if (this.commandInFlight) return true
      const durationSeconds = this.getHlaeDuration(
        map?.mapName ?? this.hlae.getStatus().mapName,
        this.hlaeActivePath.id,
        this.hlaeActivePath.durationSeconds
      )
      this.updateHlaeDebug(this.hlaeActivePath, players, geometry, now, durationSeconds)
      if (now >= this.hlaeActiveUntil) void this.exitHlae('Manual HLAE campath finished')
      return true
    }
    if (phase === 'quiet-live' && safety.actionBlocked && this.hlaeActivePath) {
      if (!this.commandInFlight) {
        void this.exitHlae(
          povLockActive ? 'Player POV has priority' : 'Action detected; returning to player POV'
        )
      }
      return true
    }
    if (phase === 'post-plant' && this.hlaeActivePath) {
      if (!this.commandInFlight) void this.exitHlae('Post-plant is reserved for player POV')
      return true
    }
    if (this.hlaeActivePath) {
      if (this.commandInFlight) return true
      const durationSeconds = this.getHlaeDuration(
        map.mapName,
        this.hlaeActivePath.id,
        this.hlaeActivePath.durationSeconds
      )
      this.updateHlaeDebug(this.hlaeActivePath, players, geometry, now, durationSeconds)
      const phaseChanged =
        !roundEndCarryover &&
        !freezeCarryover &&
        !freezePathInProgress &&
        !this.isSameHlaePhase(phase, this.hlaeActivePhase)
      const freezeTimePresentation =
        phase === 'freeze-time' && this.hlaeActivePhase === 'freeze-time' && genericPhaseEnabled
      const pathFinished = now >= this.hlaeActiveUntil
      const finalFrameNotVisible =
        pathFinished && (geometry === null || this.hlaeDebug.visibleSteamIds.length === 0)
      if (phaseChanged || pathFinished || !phaseEnabled) {
        if (
          pathFinished &&
          !phaseChanged &&
          genericPhaseEnabled &&
          phaseSafe &&
          phase === 'freeze-time' &&
          !this.hlaeManualOverride
        ) {
          const nextPath = this.selectHlaePath(
            map,
            players,
            scores,
            geometry,
            phase,
            now,
            this.hlaeActivePath.id,
            temporalFeatures,
            phaseRemainingMs
          )
          if (nextPath && geometry !== null) {
            void this.enterHlae(nextPath, map.mapName, phase, now)
            return true
          }
          if (
            freezeTimePresentation &&
            this.hlaeDebug.visibleSteamIds.length > 0 &&
            !finalFrameNotVisible
          ) {
            this.hlaeMessage = `LIVE: ${this.hlaeActivePath.label} · holding freeze-time`
            return true
          }
        }
        void this.exitHlae(
          phaseChanged
            ? `HLAE phase changed to ${phase ?? 'unknown'}`
            : finalFrameNotVisible
              ? 'Final HLAE pose has no visible players'
              : `HLAE campath finished: ${this.hlaeActivePath.label}`
        )
      }
      return true
    }
    if (!phaseEnabled || now < this.hlaeCooldownUntil || this.commandInFlight) {
      if (!this.hlaeActivePath && !this.commandInFlight) this.hlaeMessage = safety.reason
      this.updateHlaeDebug(null, players, geometry, now)
      return false
    }
    const pathEntry = this.selectHlaePath(
      map,
      players,
      scores,
      geometry,
      phase,
      now,
      undefined,
      temporalFeatures,
      phaseRemainingMs
    )
    this.updateHlaeDebug(null, players, geometry, now)
    if (!pathEntry) {
      this.hlaeMessage = geometry
        ? 'No campath currently sees a living player'
        : 'Waiting for map geometry to evaluate visibility'
      return false
    }
    void this.enterHlae(pathEntry, map.mapName, phase, now)
    return true
  }

  private async enterHlae(
    pathEntry: HlaeCameraPath,
    mapName: string,
    phase: ReturnType<typeof getAerialPresentationPhase>,
    now: number,
    manual = false,
    expectedStateVersion = this.hlaeStateVersion
  ): Promise<void> {
    this.commandInFlight = true
    try {
      if (!manual && expectedStateVersion !== this.hlaeStateVersion) return
      const durationSeconds = this.getHlaeDuration(mapName, pathEntry.id, pathEntry.durationSeconds)
      this.lastCommand = await this.camera.loadHlaePath(pathEntry.sourcePath, durationSeconds)
      this.updateTransportHealth(this.lastCommand)
      if (this.lastCommand.ok) {
        if (!manual && expectedStateVersion !== this.hlaeStateVersion) {
          const disabled = await this.camera.disableHlae()
          this.lastCommand = disabled
          this.updateTransportHealth(disabled)
          if (disabled.ok) this.clearHlaePresentation(disabled.at, 'HLAE launch became stale')
          return
        }
        this.hlaeAvailable = true
        this.hlaeManualOverride = manual
        this.hlaeActivePath = pathEntry
        this.hlaeActivePhase = phase
        this.hlaeActiveStartedAt = this.lastCommand.at || now
        this.hlaeActiveUntil = this.hlaeActiveStartedAt + durationSeconds * 1000
        const spawnTeam = phase === 'freeze-time' ? getHlaeSpawnTeam(pathEntry) : null
        if (spawnTeam) {
          this.hlaeFreezeSpawnTeams.add(spawnTeam)
          this.hlaeLastFreezeSpawnPathIds.set(spawnTeam, pathEntry.id)
        }
        this.hlaeState = 'ready'
        this.hlaeMessage = `LIVE: ${pathEntry.label}`
        this.addHistory({
          at: this.lastCommand.at,
          type: 'presentation',
          message: `HLAE campath started: ${pathEntry.label}`,
          transport: this.lastCommand.transport
        })
      } else {
        this.hlaeAvailable = false
        this.hlaeState = 'unavailable'
        this.hlaeMessage = `HLAE campath failed: ${this.lastCommand.message}`
        this.hlaeCooldownUntil = this.lastCommand.at + HLAE_COOLDOWN_MS
        this.addHistory({
          at: this.lastCommand.at,
          type: 'transport-error',
          message: this.hlaeMessage,
          transport: this.lastCommand.transport
        })
      }
    } finally {
      this.commandInFlight = false
      this.emitStatus()
    }
  }

  private async updateActiveHlaeDuration(durationSeconds: number): Promise<void> {
    if (!this.hlaeActivePath) return
    this.commandInFlight = true
    try {
      this.lastCommand = await this.camera.setHlaeDuration(durationSeconds)
      this.updateTransportHealth(this.lastCommand)
      if (this.lastCommand.ok) {
        this.hlaeActiveUntil = this.hlaeActiveStartedAt + durationSeconds * 1000
        this.hlaeMessage = `LIVE: ${this.hlaeActivePath.label} · ${durationSeconds.toFixed(1)}s`
      }
    } finally {
      this.commandInFlight = false
      this.emitStatus()
    }
  }

  private async exitHlae(reason: string): Promise<void> {
    const pathLabel = this.hlaeActivePath?.label ?? 'HLAE campath'
    const target = this.getAerialReturnTarget()
    const shouldConfirmSwitch = Boolean(this.decision?.shouldSwitch)
    this.commandInFlight = true
    try {
      const disabled = await this.camera.disableHlae()
      this.lastCommand = disabled
      this.updateTransportHealth(disabled)
      if (!disabled.ok) {
        this.hlaeState = 'error'
        this.hlaeMessage = `Could not disable HLAE: ${disabled.message}`
        this.addHistory({
          at: disabled.at,
          type: 'transport-error',
          message: this.hlaeMessage,
          transport: disabled.transport
        })
        return
      }
      if (target) {
        this.lastCommand = await this.camera.switchTo(target, this.settings)
        this.updateTransportHealth(this.lastCommand)
        if (this.lastCommand.ok && shouldConfirmSwitch) {
          this.engine.confirmSwitch(target.steamId, this.lastCommand.at)
          if (this.observerConfirmationAvailable) {
            this.pendingTargetSteamId = target.steamId
            this.pendingTargetAt = this.lastCommand.at
          }
        }
      }
      this.addHistory({
        at: this.lastCommand.at,
        type: 'presentation',
        message: `Returned from ${pathLabel}: ${reason}`,
        toSteamId: target?.steamId,
        transport: this.lastCommand.transport
      })
      this.clearHlaePresentation(this.lastCommand.at, reason)
    } finally {
      this.commandInFlight = false
      this.emitStatus()
    }
  }

  private clearHlaePresentation(now: number, reason: string): void {
    this.hlaeActivePath = null
    this.hlaeManualOverride = false
    this.hlaeActivePhase = null
    this.hlaeActiveStartedAt = 0
    this.hlaeActiveUntil = 0
    this.hlaeCooldownUntil = now + HLAE_COOLDOWN_MS
    this.hlaeMessage = reason
  }

  /** Returns true while presentation owns the camera or a presentation command is in flight. */
  private handleAerialPresentation(decision: AerialPresentationDecision, now: number): boolean {
    this.aerialReason = decision.reason
    this.aerialVisibleSteamIds = decision.visibleSteamIds
    if (this.hlaeActivePath) return true

    if (this.aerialActiveAnchor) {
      if (this.commandInFlight) return true
      const phaseChanged =
        decision.eligible && decision.phase !== this.aerialActivePhase && decision.anchor !== null
      if (phaseChanged && decision.anchor) {
        void this.transitionAerial(
          decision.anchor,
          decision,
          now,
          `${this.aerialActivePhase ?? 'unknown'} → ${decision.phase ?? 'unknown'}`
        )
        return true
      }
      const exitReason = !decision.eligible
        ? decision.reason
        : now >= this.aerialActiveUntil
          ? `Aerial hold limit reached for ${this.aerialActiveAnchor.label}`
          : null
      if (exitReason) {
        const target = this.getAerialReturnTarget()
        if (target && !this.commandInFlight) void this.exitAerial(target, exitReason)
        else if (!target) this.clearAerialPresentation(now, exitReason)
      }
      return true
    }

    if (!decision.eligible || !decision.anchor) {
      this.aerialCandidateId = null
      this.aerialCandidateConfirmations = 0
      return false
    }
    if (now < this.aerialCooldownUntil) {
      this.aerialReason = `${decision.reason}; cooldown active`
      return false
    }
    if (this.aerialCandidateId === decision.anchor.id) {
      this.aerialCandidateConfirmations += 1
    } else {
      this.aerialCandidateId = decision.anchor.id
      this.aerialCandidateConfirmations = 1
    }
    if (this.aerialCandidateConfirmations < AERIAL_MIN_CONFIRMATIONS || this.commandInFlight) {
      this.aerialReason = `${decision.reason}; confirming ${this.aerialCandidateConfirmations}/${AERIAL_MIN_CONFIRMATIONS}`
      return false
    }
    void this.enterAerial(decision.anchor, decision, now)
    return true
  }

  private getAerialReturnTarget():
    | NonNullable<AutoDirectorStatus['decision']>['scores'][number]
    | null {
    if (!this.decision) return null
    const preferredSteamId = this.decision.shouldSwitch
      ? this.decision.candidateSteamId
      : this.decision.currentSteamId
    return this.decision.scores.find((score) => score.steamId === preferredSteamId) ?? null
  }

  private async enterAerial(
    anchor: AerialCameraAnchor,
    decision: AerialPresentationDecision,
    now: number
  ): Promise<void> {
    this.commandInFlight = true
    try {
      this.lastCommand = await this.camera.moveToAerial(
        anchor,
        decision.presentationAngles ?? anchor.angles
      )
      this.updateTransportHealth(this.lastCommand)
      if (this.lastCommand.ok) {
        this.aerialActiveAnchor = anchor
        this.aerialActiveUntil = now + AERIAL_MAX_HOLD_MS
        this.aerialActivePhase = decision.phase
        this.aerialSequenceAnchorIds.add(anchor.id)
        this.aerialSequencePhase = decision.phase
        this.aerialReason = decision.reason
        this.aerialVisibleSteamIds = decision.visibleSteamIds
        this.addHistory({
          at: this.lastCommand.at,
          type: 'presentation',
          message: `Aerial presentation started: ${decision.reason}`,
          transport: this.lastCommand.transport
        })
      } else {
        this.resetAerialSequence()
        this.aerialCooldownUntil = now + AERIAL_COOLDOWN_MS
        this.aerialReason = `Aerial command failed: ${this.lastCommand.message}`
        this.addHistory({
          at: this.lastCommand.at,
          type: 'transport-error',
          message: `Aerial camera ${anchor.label}: ${this.lastCommand.message}`,
          transport: this.lastCommand.transport
        })
      }
    } finally {
      this.commandInFlight = false
      this.emitStatus()
    }
  }

  private async transitionAerial(
    anchor: AerialCameraAnchor,
    decision: AerialPresentationDecision,
    now: number,
    reason: string
  ): Promise<void> {
    const fromLabel = this.aerialActiveAnchor?.label ?? 'Aerial camera'
    this.commandInFlight = true
    try {
      this.lastCommand = await this.camera.moveToAerial(
        anchor,
        decision.presentationAngles ?? anchor.angles
      )
      this.updateTransportHealth(this.lastCommand)
      if (this.lastCommand.ok) {
        this.aerialActiveAnchor = anchor
        this.aerialActiveUntil = now + AERIAL_MAX_HOLD_MS
        this.aerialActivePhase = decision.phase
        this.aerialSequenceAnchorIds.add(anchor.id)
        this.aerialReason = decision.reason
        this.aerialVisibleSteamIds = decision.visibleSteamIds
        this.addHistory({
          at: this.lastCommand.at,
          type: 'presentation',
          message: `Aerial transition ${fromLabel} → ${anchor.label}: ${reason}`,
          transport: this.lastCommand.transport
        })
      } else {
        this.aerialReason = `Could not transition Aerial camera: ${this.lastCommand.message}`
        this.addHistory({
          at: this.lastCommand.at,
          type: 'transport-error',
          message: this.aerialReason,
          transport: this.lastCommand.transport
        })
      }
    } finally {
      this.commandInFlight = false
      this.emitStatus()
    }
  }

  private async exitAerial(
    target: NonNullable<AutoDirectorStatus['decision']>['scores'][number],
    reason: string
  ): Promise<void> {
    const anchorLabel = this.aerialActiveAnchor?.label ?? 'Aerial camera'
    const shouldConfirmSwitch = Boolean(this.decision?.shouldSwitch)
    const continueSequence =
      this.aerialSequencePhase === 'freeze-time' && reason.startsWith('Aerial hold limit reached')
    this.commandInFlight = true
    try {
      this.lastCommand = await this.camera.switchTo(target, this.settings)
      this.updateTransportHealth(this.lastCommand)
      if (this.lastCommand.ok) {
        if (shouldConfirmSwitch) {
          this.engine.confirmSwitch(target.steamId, this.lastCommand.at)
          if (this.observerConfirmationAvailable) {
            this.pendingTargetSteamId = target.steamId
            this.pendingTargetAt = this.lastCommand.at
          }
        }
        this.addHistory({
          at: this.lastCommand.at,
          type: 'presentation',
          message: `Returned from ${anchorLabel} to ${target.name}: ${reason}`,
          toSteamId: target.steamId,
          transport: this.lastCommand.transport
        })
        this.clearAerialPresentation(this.lastCommand.at, reason, continueSequence)
      } else {
        this.aerialReason = `Could not exit Aerial camera: ${this.lastCommand.message}`
        this.addHistory({
          at: this.lastCommand.at,
          type: 'transport-error',
          message: this.aerialReason,
          toSteamId: target.steamId,
          transport: this.lastCommand.transport
        })
      }
    } finally {
      this.commandInFlight = false
      this.emitStatus()
    }
  }

  private clearAerialPresentation(now: number, reason: string, continueSequence = false): void {
    this.aerialActiveAnchor = null
    this.aerialActiveUntil = 0
    this.aerialActivePhase = null
    this.aerialCandidateId = null
    this.aerialCandidateConfirmations = 0
    this.aerialCooldownUntil =
      now + (continueSequence ? AERIAL_SEQUENCE_GAP_MS : AERIAL_COOLDOWN_MS)
    if (!continueSequence) this.resetAerialSequence()
    this.aerialReason = reason
    this.aerialVisibleSteamIds = []
  }

  private resetAerialSequence(): void {
    this.aerialSequencePhase = null
    this.aerialSequenceAnchorIds.clear()
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
