import { createHash } from 'crypto'
import type { Server } from 'socket.io'
import type { CSGORaw } from 'csgogsi'
import { dbAll, dbRun } from '../database/sqlite'
import { PlayerRepository } from '../domains/players/player.repository'
import { TeamRepository } from '../domains/teams/team.repository'
import {
  parseChallongeModule,
  resolveChallongeMatch,
  type ChallongeBracket,
  type ChallongeMatch,
  type ChallongeParticipant,
  type ResolvedChallongeMatch
} from './challonge.resolver'
import {
  publishTournamentLabels,
  refreshTournamentLabels,
  type TournamentHudLabels
} from './tournamentLabels'

const DEFAULT_POLL_SECONDS = 10
const MIN_POLL_SECONDS = 5
const MAX_POLL_SECONDS = 120

export interface ChallongePublicSettings {
  enabled: boolean
  tournament: string
  sourceConfigured: boolean
  pollIntervalSeconds: number
}

export interface ChallongeStatus {
  state: 'disabled' | 'connecting' | 'connected' | 'stale' | 'error'
  message: string
  lastSyncAt: string | null
  revision: string | null
  tournamentName: string | null
  currentMatchId: string | null
  currentStage: string | null
}

type StoredSettings = ChallongePublicSettings

const playerRepo = new PlayerRepository()
const teamRepo = new TeamRepository()

const emptyStatus = (): ChallongeStatus => ({
  state: 'disabled',
  message: 'Challonge integration is disabled',
  lastSyncAt: null,
  revision: null,
  tournamentName: null,
  currentMatchId: null,
  currentStage: null
})

const normalizeTournamentId = (value: string): string => {
  const input = value.trim()
  if (!input) throw new Error('Challonge tournament URL or ID is required')
  try {
    const parsed = new URL(input.includes('://') ? input : `https://${input}`)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parsed.hostname.endsWith('challonge.com') && parts.length) {
      const last = parts[parts.length - 1]
      return ['module', 'settings'].includes(last) && parts.length > 1
        ? parts[parts.length - 2]
        : last
    }
  } catch {
    // Treat a plain tournament slug or numeric ID as-is below.
  }
  return (
    input
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)
      .pop() || input
  )
}

const revisionFor = (
  tournament: any,
  matches: ChallongeMatch[],
  participants: ChallongeParticipant[]
): string =>
  createHash('sha1').update(JSON.stringify({ tournament, matches, participants })).digest('hex')

class ChallongeIntegrationService {
  private enabled = false
  private bracket: ChallongeBracket | null = null
  private status: ChallongeStatus = emptyStatus()
  private localIo: Server | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private refreshInFlight: Promise<void> | null = null
  private refreshGeneration = 0
  private settingsUpdateQueue: Promise<void> = Promise.resolve()
  private latestGsi: CSGORaw | null = null
  private resolvedMatch: ResolvedChallongeMatch | null = null
  private resolveInFlight: Promise<void> | null = null
  private lastPublishedKey = ''
  private cachedTeams: Awaited<ReturnType<TeamRepository['getTeams']>> = []
  private cachedTeamsAt = 0

  private async readStoredSettings(): Promise<StoredSettings> {
    const rows = (await dbAll('SELECT key, value FROM settings')) as Array<{
      key: string
      value: string
    }>
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    const poll = Number(values.challongePollIntervalSeconds || DEFAULT_POLL_SECONDS)
    return {
      enabled: values.challongeEnabled === 'true',
      tournament: values.challongeTournament || '',
      sourceConfigured: Boolean(values.challongeTournament),
      pollIntervalSeconds: Number.isFinite(poll)
        ? Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, poll))
        : DEFAULT_POLL_SECONDS
    }
  }

  private async writeSetting(key: string, value: string): Promise<void> {
    await dbRun(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
  }

  async getPublicSettings(): Promise<ChallongePublicSettings> {
    const { enabled, tournament, sourceConfigured, pollIntervalSeconds } =
      await this.readStoredSettings()
    return { enabled, tournament, sourceConfigured, pollIntervalSeconds }
  }

  getStatus(): ChallongeStatus {
    return { ...this.status }
  }

  getHudLabels(): Omit<TournamentHudLabels, 'source'> {
    return {
      enabled: this.enabled,
      available: Boolean(this.bracket && this.resolvedMatch),
      state: this.status.state,
      tournamentName: this.bracket?.tournamentName || '',
      tournamentStage: this.resolvedMatch?.stage || '',
      revision: this.status.revision
    }
  }

  async updateSettings(input: {
    enabled?: boolean
    tournament?: string
    pollIntervalSeconds?: number
  }): Promise<ChallongePublicSettings> {
    const update = this.settingsUpdateQueue.then(() => this.applySettingsUpdate(input))
    this.settingsUpdateQueue = update.then(
      () => undefined,
      () => undefined
    )
    return update
  }

  private async applySettingsUpdate(input: {
    enabled?: boolean
    tournament?: string
    pollIntervalSeconds?: number
  }): Promise<ChallongePublicSettings> {
    const previous = await this.readStoredSettings()
    const tournament =
      input.tournament !== undefined
        ? input.tournament.trim()
          ? normalizeTournamentId(input.tournament)
          : ''
        : undefined
    let poll: number | undefined
    if (input.pollIntervalSeconds !== undefined) {
      if (!Number.isFinite(input.pollIntervalSeconds))
        throw new Error('Challonge polling interval must be a finite number')
      poll = Math.min(
        MAX_POLL_SECONDS,
        Math.max(MIN_POLL_SECONDS, Math.round(input.pollIntervalSeconds))
      )
    }

    await this.stop()
    try {
      await dbRun('BEGIN IMMEDIATE')
      if (tournament !== undefined && tournament !== previous.tournament) {
        await this.writeSetting('challongeTournament', tournament)
      }
      if (input.enabled !== undefined)
        await this.writeSetting('challongeEnabled', String(input.enabled))
      if (poll !== undefined) await this.writeSetting('challongePollIntervalSeconds', String(poll))
      await dbRun('COMMIT')
    } catch (error) {
      await dbRun('ROLLBACK').catch(() => undefined)
      await this.restart().catch(() => undefined)
      throw error
    }
    await this.restart()
    await refreshTournamentLabels()
    return this.getPublicSettings()
  }

  async start(io: Server): Promise<void> {
    this.localIo = io
    await this.restart()
  }

  async stop(): Promise<void> {
    this.refreshGeneration += 1
    this.refreshInFlight = null
    this.latestGsi = null
    this.bracket = null
    this.resolvedMatch = null
    this.lastPublishedKey = ''
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async restart(): Promise<void> {
    await this.stop()
    const generation = this.refreshGeneration
    const settings = await this.readStoredSettings()
    this.enabled = settings.enabled
    this.status = emptyStatus()
    if (!settings.enabled) {
      if (this.localIo)
        await publishTournamentLabels(this.localIo, 'challonge', this.getHudLabels())
      return
    }
    if (!settings.tournament) {
      this.status = {
        ...emptyStatus(),
        state: 'error',
        message: 'Challonge tournament is required'
      }
      if (this.localIo)
        await publishTournamentLabels(this.localIo, 'challonge', this.getHudLabels())
      return
    }
    this.status = { ...this.status, state: 'connecting', message: 'Connecting to Challonge…' }
    this.emitStatus()
    await this.refreshNowUnfenced().catch(() => undefined)
    if (generation !== this.refreshGeneration || !this.enabled) return
    this.pollTimer = setInterval(() => void this.refreshNow(), settings.pollIntervalSeconds * 1000)
  }

  async refreshNow(): Promise<void> {
    await this.settingsUpdateQueue
    return this.refreshNowUnfenced()
  }

  private async refreshNowUnfenced(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight
    const generation = this.refreshGeneration
    const refresh = this.performRefresh(generation)
    const tracked = refresh.finally(() => {
      if (this.refreshInFlight === tracked) this.refreshInFlight = null
    })
    this.refreshInFlight = tracked
    return tracked
  }

  private async performRefresh(generation: number): Promise<void> {
    try {
      const settings = await this.readStoredSettings()
      if (!settings.enabled || generation !== this.refreshGeneration) return
      const id = normalizeTournamentId(settings.tournament)
      const next = await this.fetchPublicModule(id)
      const participants = next.participants
      const matches = next.matches
      if (generation !== this.refreshGeneration) return
      this.bracket = next
      this.status = {
        state: 'connected',
        message: `Synced public bracket ${next.tournamentName || 'Challonge tournament'} (${matches.length} matches)`,
        lastSyncAt: new Date().toISOString(),
        revision: revisionFor(next, matches, participants),
        tournamentName: next.tournamentName || null,
        currentMatchId: this.status.currentMatchId,
        currentStage: this.status.currentStage
      }
      await this.resolveLatestGsi()
      this.emitStatus()
    } catch (error) {
      if (generation !== this.refreshGeneration) return
      const message = error instanceof Error ? error.message : 'Unknown Challonge connection error'
      this.status = { ...this.status, state: this.bracket ? 'stale' : 'error', message }
      this.emitStatus()
      if (this.localIo)
        await publishTournamentLabels(this.localIo, 'challonge', this.getHudLabels())
    }
  }

  private async fetchPublicModule(tournament: string): Promise<ChallongeBracket> {
    const response = await fetch(`https://challonge.com/${encodeURIComponent(tournament)}/module`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'JTs-Hud public bracket reader'
      },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error'
    })
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? 'Challonge public bracket is not accessible'
          : `Challonge request failed with HTTP ${response.status}`
      )
    }
    return parseChallongeModule(await response.text())
  }

  async testConnection(input: { tournament: string }): Promise<ChallongeStatus> {
    await this.settingsUpdateQueue
    const id = normalizeTournamentId(input.tournament)
    const bracket = await this.fetchPublicModule(id)
    return {
      state: 'connected',
      message: `Connected to public Challonge bracket: ${bracket.tournamentName || id}`,
      lastSyncAt: new Date().toISOString(),
      revision: null,
      tournamentName: bracket.tournamentName || id,
      currentMatchId: null,
      currentStage: null
    }
  }

  processGsi(raw: CSGORaw): void {
    this.latestGsi = raw
    if (this.enabled && this.bracket && !this.resolveInFlight) void this.resolveLatestGsi()
  }

  private async resolveLatestGsi(): Promise<void> {
    if (!this.latestGsi || !this.bracket || !this.localIo) return
    const raw = this.latestGsi
    const operation = (async () => {
      const steamIds = Object.keys(raw.allplayers || {})
      const players = steamIds.length ? await playerRepo.getPlayers(steamIds) : []
      if (Date.now() - this.cachedTeamsAt > 10_000) {
        this.cachedTeams = await teamRepo.getTeams()
        this.cachedTeamsAt = Date.now()
      }
      const resolved = resolveChallongeMatch(this.bracket!, raw, players, this.cachedTeams)
      this.status.currentMatchId = resolved?.match.id || null
      this.status.currentStage = resolved?.stage || null
      this.resolvedMatch = resolved
      const labels = this.getHudLabels()
      const key = `${labels.tournamentName}|${labels.tournamentStage}|${labels.revision}`
      if (key !== this.lastPublishedKey) {
        this.lastPublishedKey = key
        await publishTournamentLabels(this.localIo!, 'challonge', labels)
      }
    })()
    const tracked = operation.finally(() => {
      if (this.resolveInFlight === tracked) {
        this.resolveInFlight = null
        if (this.latestGsi !== raw && this.enabled && this.bracket) void this.resolveLatestGsi()
      }
    })
    this.resolveInFlight = tracked
    return tracked
  }

  private emitStatus(): void {
    this.localIo?.emit('challonge:status', this.getStatus())
  }
}

export const challongeIntegrationService = new ChallongeIntegrationService()
