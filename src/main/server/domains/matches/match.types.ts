export interface PlayerRoundData {
  kills: number
  killshs: number
  damage: number
}

export interface RoundData {
  round: number
  players: {
    [steamid: string]: PlayerRoundData
  }
  winner: 'CT' | 'T' | null
  win_type: 'bomb' | 'elimination' | 'defuse' | 'time'
}

export interface Veto {
  teamId: string
  mapName: string
  side: 'CT' | 'T' | 'NO'
  type: 'ban' | 'pick' | 'decider'
  reverseSide?: boolean
  rounds?: (RoundData | null)[]
  score?: {
    [key: string]: number
  }
  winner?: string
  mapEnd: boolean
}

export interface Match {
  id: string
  current: boolean
  left: {
    id: string | null
    wins: number
  }
  right: {
    id: string | null
    wins: number
  }
  matchType: 'bo1' | 'bo2' | 'bo3' | 'bo5'
  vetos: Veto[]
}

// Utility types for CRUD
export type CreateMatchDTO = Omit<Match, 'id'>
export type UpdateMatchDTO = Partial<CreateMatchDTO>
