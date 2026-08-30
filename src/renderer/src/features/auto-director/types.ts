export type AutoDirectorMode = 'balanced' | 'reactive' | 'calm'
export type CameraTransport = 'telnet' | 'keyboard'

export interface AutoDirectorPreset {
  id: string
  name: string
  mode: AutoDirectorMode
  weights: Record<string, number>
  minimumDwellOverrideMs: number | null
  postDeathHoldMs: number
}

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

export interface AutoDirectorSettings {
  enabled: boolean
  paused: boolean
  mode: AutoDirectorMode
  autoFallback: boolean
  rulesEnabled: boolean
  sceneAdvisoryEnabled: boolean
  geometryAdvisoryEnabled: boolean
  mlAdvisoryEnabled: boolean
  aerialPresentationEnabled: boolean
  aerialPresentationPhases: {
    freezeTime: boolean
    midRound: boolean
    roundEnd: boolean
  }
  minimumDwellOverrideMs: number | null
  postDeathHoldMs: number
  customPresets: AutoDirectorPreset[]
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
  type: 'decision' | 'switch' | 'presentation' | 'transport-error' | 'operator'
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
    topology: {
      mapName: string | null
      state: 'missing' | 'loaded' | 'error'
      areaCount: number
      portalCount: number
      message: string
    }
  }
  aerial: {
    enabled: boolean
    mapName: string | null
    state: 'missing' | 'loaded' | 'error'
    anchorCount: number
    message: string
    activeAnchorId: string | null
    activeAnchorLabel: string | null
    activeUntil: number | null
    reason: string
    visibleSteamIds: string[]
  }
  cameraDebug: CameraDebugStatus
}

export interface CameraDebugPlayer {
  steamId: string
  name: string
  team: string
  observerSlot: number
  health: number
  alive: boolean
  position: [number, number, number] | null
  forward: [number, number, number] | null
  priorityScore: number
  cameraScore: number
  visibleEnemySteamIds: string[]
  nearestEnemySteamId: string | null
  nearestEnemyVisible: boolean
  peekPotentialEnemySteamIds: string[]
  forwardEnemySteamIds: string[]
}

export interface CameraDebugAnchor {
  id: string
  label: string
  kind: string
  position: [number, number, number]
  angles: [number, number, number]
  cameraScore: number
  inFrustumSteamIds: string[]
  visibleSteamIds: string[]
  occludedSteamIds: string[]
  reason: string
  reasons: string[]
}

export interface CameraDebugStatus {
  mapName: string | null
  updatedAt: number | null
  geometryAvailable: boolean
  geometryMessage: string
  players: CameraDebugPlayer[]
  anchors: CameraDebugAnchor[]
  currentPlayerSteamId: string | null
  candidatePlayerSteamId: string | null
  activeAnchorId: string | null
  summary: string
}

export interface CameraDebugGeometry {
  schemaVersion: 1
  mapName: string
  sourceSha256: string
  coordinateSystem: 'source2-hammer-units'
  sourceTriangleCount?: number
  triangles: number[]
}
