export type AutoDirectorMode = 'balanced' | 'reactive' | 'calm'
export type CameraTransport = 'telnet' | 'keyboard'

export interface ScoreFactor {
  key: string
  label: string
  value: number
  detail: string
}

export interface PlayerScore {
  steamId: string
  name: string
  team: string
  observerSlot: number
  alive: boolean
  total: number
  factors: ScoreFactor[]
  nearestEnemyDistance: number | null
  switchEligible: boolean
}

export interface AutoDirectorSettings {
  enabled: boolean
  paused: boolean
  mode: AutoDirectorMode
  autoFallback: boolean
  rulesEnabled: boolean
  geometryAdvisoryEnabled: boolean
  mlAdvisoryEnabled: boolean
  scoringIntervalMs: number
  manualOverrideSteamId: string | null
  customWeights: Record<string, number>
}

export interface AutoDirectorDecision {
  at: number
  scores: PlayerScore[]
  currentSteamId: string | null
  currentName: string | null
  candidateSteamId: string | null
  candidateName: string | null
  runnerUpSteamId: string | null
  runnerUpName: string | null
  shouldSwitch: boolean
  reason: string
  lockKind: string
  lockUntil: number | null
}

export interface CameraCommandResult {
  ok: boolean
  transport: 'telnet' | 'keyboard'
  message: string
  at: number
  attempts?: Array<{ transport: 'telnet' | 'keyboard'; ok: boolean; message: string }>
}

export interface TransportHealth {
  state: 'unknown' | 'healthy' | 'degraded' | 'error' | 'unsupported'
  lastCheckedAt: number | null
  message: string
  consecutiveFailures: number
}

export interface DirectorHistoryEntry {
  at: number
  type: 'decision' | 'switch' | 'transport-error' | 'operator'
  message: string
  fromSteamId?: string | null
  toSteamId?: string | null
  transport?: 'telnet' | 'keyboard'
}

export interface AutoDirectorStatus {
  settings: AutoDirectorSettings
  connected: boolean
  lastGsiAt: number | null
  running: boolean
  decision: AutoDirectorDecision | null
  lastCommand: CameraCommandResult | null
  transportHealth: Record<'telnet' | 'keyboard', TransportHealth>
  history: DirectorHistoryEntry[]
  ml: {
    enabled: boolean
    modelLoaded: boolean
    modelMessage: string
    geometry: {
      mapName: string | null
      state: 'missing' | 'loaded' | 'error'
      triangleCount: number
      message: string
    }
  }
}
