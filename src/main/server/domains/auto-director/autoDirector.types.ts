export type AutoDirectorMode = 'balanced' | 'reactive' | 'calm'
export type CameraTransport = 'telnet' | 'keyboard'

export type ScoreFactorKey =
  | 'base'
  | 'objective'
  | 'combat'
  | 'damage'
  | 'recentKill'
  | 'proximity'
  | 'aimAlignment'
  | 'clutch'
  | 'grenade'
  | 'entry'
  | 'retake'
  | 'weaponPressure'
  | 'bombCarrier'
  | 'lowHealthDrama'
  | 'continuity'
  | 'geometryAdvisory'
  | 'mlAdvisory'
  | 'death'
  | 'flashPenalty'
  | 'orientationPenalty'
  | 'sceneRelevance'
  | 'groupCoverage'
  | 'routeEntry'
  | 'contactImminence'
  | 'incomingGroupPressure'
  | 'scenePovQuality'
  | 'portalControl'
  | 'fightPrediction'
  | 'crossfire'
  | 'isolationPenalty'

export interface ScoreFactor {
  key: ScoreFactorKey
  label: string
  value: number
  detail: string
}

export interface DirectorPlayer {
  steamId: string
  name: string
  team: 'CT' | 'T' | string
  observerSlot: number
  health: number
  armor: number
  alive: boolean
  flashed: number
  position: [number, number, number] | null
  forward: [number, number, number] | null
  weapon: string
  weaponType: string
  ammoClip: number | null
  kills: number
  roundKills: number
  roundDamage: number
  hasBomb: boolean
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
  nearestEnemyHasLineOfSight?: boolean
  nearestEnemyHasPeekPotential?: boolean
  sceneKey?: string | null
  sceneScore?: number
  sceneRelevance?: number
  sceneMemberCount?: number
  opposingSceneMemberCount?: number
  enemiesInViewCone?: number
  nearbyEnemyCount?: number
  enemyGroupAlignment?: number
  enemyGroupCoverage?: number
  contactImminence?: number
  routeEntryRelevance?: number
  routeEntryTargetCount?: number
  topologyCallout?: string | null
  topologyTacticalRoles?: string[]
  topologyPlantSite?: 'site_a' | 'site_b' | null
  topologyRoutePortalId?: string | null
  topologyRouteDistance?: number | null
  topologyRoutePortalChokepoint?: boolean
  topologyPortalControlScore?: number
  topologyDefensiveAngleScore?: number
  topologyCrossfirePotential?: number
  topologyRouteConvergence?: number
  topologyPeekPotential?: boolean
  topologyPeekPortalCount?: number
  topologyIncomingRoutePressure?: number
  topologyPredictedFightMs?: number | null
  topologyFightPredictionConfidence?: number
  topologyVerticalSeparation?: number | null
  topologyRouteAdvisoryAllowed?: boolean
  incomingGroupPressure?: number
  scenePhase?: 'forming' | 'approaching' | 'contact' | 'objective' | null
  sceneConfidence?: number
  movementMagnitude?: number
  approachPressure?: number
  povQuality?: number
  threatSceneKey?: string | null
  threatSceneTargetCount?: number
  threatSceneEnemiesInViewCone?: number
  threatSceneAlignment?: number
  threatSceneCoverage?: number
  threatSceneActionableTargetCount?: number
  threatSceneActionableCoverage?: number
  threatSceneVisibleCount?: number
  threatScenePeekCount?: number
  threatSceneExternal?: boolean
  isolatedNoAction?: boolean
  switchEligible: boolean
}

export interface AutoDirectorProfile {
  mode: AutoDirectorMode
  minDwellMs: number
  switchMargin: number
  combatSoftLockMs: number
  postKillHoldMs: number
  weights: Record<
    Exclude<
      ScoreFactorKey,
      | 'death'
      | 'flashPenalty'
      | 'orientationPenalty'
      | 'geometryAdvisory'
      | 'mlAdvisory'
      | 'sceneRelevance'
      | 'groupCoverage'
      | 'routeEntry'
      | 'contactImminence'
      | 'incomingGroupPressure'
      | 'scenePovQuality'
      | 'isolationPenalty'
    >,
    number
  >
}

export interface AutoDirectorSettings {
  enabled: boolean
  paused: boolean
  mode: AutoDirectorMode
  autoFallback: boolean
  rulesEnabled: boolean
  sceneAdvisoryEnabled: boolean
  geometryAdvisoryEnabled: boolean
  mlAdvisoryEnabled: boolean
  scoringIntervalMs: number
  manualOverrideSteamId: string | null
  customWeights: Partial<AutoDirectorProfile['weights']>
}

export type CameraLockKind =
  | 'none'
  | 'minimum-dwell'
  | 'combat'
  | 'post-kill'
  | 'objective'
  | 'manual'

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
  lockKind: CameraLockKind
  lockUntil: number | null
  dominantSceneKey?: string | null
  dominantSceneScore?: number
  currentSceneKey?: string | null
  currentSceneScore?: number
  dominantScenePhase?: 'forming' | 'approaching' | 'contact' | 'objective' | null
  dominantSceneConfidence?: number
  currentScenePhase?: 'forming' | 'approaching' | 'contact' | 'objective' | null
  currentSceneConfidence?: number
}

export interface CameraCommandResult {
  ok: boolean
  transport: CameraTransport
  message: string
  at: number
  attempts?: Array<{
    transport: CameraTransport
    ok: boolean
    message: string
  }>
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
  transport?: CameraTransport
}

export interface AutoDirectorStatus {
  settings: AutoDirectorSettings
  connected: boolean
  lastGsiAt: number | null
  running: boolean
  decision: AutoDirectorDecision | null
  lastCommand: CameraCommandResult | null
  transportHealth: Record<CameraTransport, TransportHealth>
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
    topology: {
      mapName: string | null
      state: 'missing' | 'loaded' | 'error'
      areaCount: number
      portalCount: number
      message: string
    }
  }
}

export interface GsiLikePayload {
  player?: {
    steamid?: string
    activity?: string
  }
  allplayers?: Record<string, any>
  bomb?: {
    state?: string
    player?: string
    position?: string
    countdown?: number
  }
  grenades?: Record<
    string,
    {
      owner?: string
      type?: string
      position?: string
    }
  >
  phase_countdowns?: {
    phase?: string
    phase_ends_in?: string | number
  }
  map?: {
    name?: string
    phase?: string
    round?: number
    team_ct?: { score?: number }
    team_t?: { score?: number }
  }
  round?: {
    phase?: string
    bomb?: string
    win_team?: string
  }
}
