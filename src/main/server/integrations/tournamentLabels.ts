import type { Server } from 'socket.io'
import { dbGet } from '../database/sqlite'

export type TournamentLabelSource = 'mat' | 'challonge' | 'none'

export interface TournamentHudLabels {
  enabled: boolean
  available: boolean
  state: 'disabled' | 'connecting' | 'connected' | 'stale' | 'error'
  tournamentName: string
  tournamentStage: string
  revision: string | null
  source: TournamentLabelSource
}

const disabledLabels = (): TournamentHudLabels => ({
  enabled: false,
  available: false,
  state: 'disabled',
  tournamentName: '',
  tournamentStage: '',
  revision: null,
  source: 'none'
})

let io: Server | null = null
let matLabels = disabledLabels()
let challongeLabels = disabledLabels()

const isUsable = (labels: TournamentHudLabels): boolean => labels.enabled && labels.available

const resolve = async (): Promise<TournamentHudLabels> => {
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', [
    'tournamentIntegrationPriority'
  ])
  const priority = row?.value === 'mat' ? 'mat' : 'challonge'
  const preferred = priority === 'mat' ? matLabels : challongeLabels
  const fallback = priority === 'mat' ? challongeLabels : matLabels
  if (isUsable(preferred)) return preferred
  if (isUsable(fallback)) return fallback
  return preferred.enabled ? preferred : fallback.enabled ? fallback : disabledLabels()
}

export const publishTournamentLabels = async (
  server: Server,
  source: Exclude<TournamentLabelSource, 'none'>,
  labels: Omit<TournamentHudLabels, 'source'>
): Promise<void> => {
  io = server
  if (source === 'mat') matLabels = { ...labels, source }
  else challongeLabels = { ...labels, source }
  const resolved = await resolve()
  server.emit('tournament:labels', resolved)
  // Existing HUDs already consume this event. Keep it as the compatibility
  // channel while tournament-aware HUDs can use tournament:labels directly.
  server.emit('mat:labels', resolved)
}

export const refreshTournamentLabels = async (): Promise<void> => {
  if (!io) return
  const resolved = await resolve()
  io.emit('tournament:labels', resolved)
  io.emit('mat:labels', resolved)
}

export const getResolvedTournamentLabels = async (): Promise<TournamentHudLabels> => resolve()
