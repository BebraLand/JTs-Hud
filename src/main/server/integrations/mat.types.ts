export interface MatHudPlayer {
  id: string
  steamId: string
  nickname: string
  firstName: string | null
  lastName: string | null
  avatarUrl: string | null
  photoUrl: string | null
  countryCode: string | null
  teamId: string
}

export interface MatHudTeam {
  id: string
  name: string
  tag: string
  countryCode: string | null
  logoUrl: string | null
  players: MatHudPlayer[]
}

export interface MatHudPlayerStat {
  steamId: string
  name: string
  kills: number
  deaths: number
  assists: number
  flashAssists: number
  enemiesFlashed: number
  damage: number
  utilityDamage: number
  headshotKills: number
  kast: number
  mvps: number
  score: number
  roundsPlayed: number
}

export interface MatHudVetoAction {
  step: number
  teamId: string | null
  type: 'ban' | 'pick' | 'side' | 'decider'
  mapName: string
  side: 'CT' | 'T' | null
}

export interface MatHudMap {
  number: number
  name: string
  pickedByTeamId: string | null
  startingSideTeam1: 'CT' | 'T' | null
  score: { team1: number; team2: number } | null
  winnerTeamId: string | null
  completedAt: string | null
  playerStats?: { team1: MatHudPlayerStat[]; team2: MatHudPlayerStat[] } | null
}

export interface MatHudProjectionV1 {
  contract: 'bebraland-mat-hud'
  version: 1
  revision: string
  generatedAt: string
  tournament: {
    id: string
    name: string
    type: string
    status: string
  } | null
  match: {
    id: string
    numericId: number
    slug: string
    round: number
    roundLabel: string
    bracket: string | null
    format: 'bo1' | 'bo3' | 'bo5'
    status: 'queued' | 'veto' | 'prepared' | 'live' | 'completed' | 'held' | 'postponed'
    operatorState: 'queued' | 'held' | 'postponed' | null
    currentMap: string | null
    currentMapNumber: number | null
    team1: MatHudTeam
    team2: MatHudTeam
    seriesScore: { team1: number; team2: number }
    veto: {
      status: 'not_started' | 'in_progress' | 'completed'
      actions: MatHudVetoAction[]
    }
    maps: MatHudMap[]
    simulation: boolean
    confirmedWinnerTeamId: string | null
  } | null
}

export interface MatIntegrationPublicSettings {
  enabled: boolean
  url: string
  tokenConfigured: boolean
  pollIntervalSeconds: number
  useSteamAvatars: boolean
}

export type MatTokenMode = 'manual' | 'automatic'

export interface MatIntegrationStatus {
  state: 'disabled' | 'connecting' | 'connected' | 'stale' | 'error'
  message: string
  lastSyncAt: string | null
  revision: string | null
  currentMatchSlug: string | null
  tokenMode: MatTokenMode | null
}
