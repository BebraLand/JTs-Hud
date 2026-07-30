import { safeStorage } from 'electron'
import { io as createSocket, Socket } from 'socket.io-client'
import type { Server } from 'socket.io'
import { dbAll, dbRun } from '../database/sqlite'
import type { Match } from '../domains/matches/match.types'
import type { Team } from '../domains/teams/team.types'
import type { Player } from '../domains/players/player.types'
import type {
  MatHudProjectionV1,
  MatIntegrationPublicSettings,
  MatIntegrationStatus
} from './mat.types'
import { mapMatch, mapPlayer, mapTeam } from './mat.mapper'

const DEFAULT_POLL_SECONDS = 5
const MIN_POLL_SECONDS = 2
const MAX_POLL_SECONDS = 60

type StoredSettings = MatIntegrationPublicSettings & { encryptedToken: string }
type MatSettingsUpdate = {
  enabled?: boolean
  url?: string
  token?: string
  pollIntervalSeconds?: number
}

function normalizeMatUrl(value: string): string {
  const parsed = new URL(value.trim())
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('MAT URL must use http:// or https://')
  }
  return parsed.toString().replace(/\/$/, '')
}

class MatIntegrationService {
  private enabled = false
  private projection: MatHudProjectionV1 | null = null
  private teams: Team[] = []
  private players: Player[] = []
  private match: Match | null = null
  private status: MatIntegrationStatus = {
    state: 'disabled',
    message: 'MAT integration is disabled',
    lastSyncAt: null,
    revision: null,
    currentMatchSlug: null
  }
  private localIo: Server | null = null
  private matSocket: Socket | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private refreshInFlight: Promise<void> | null = null
  private refreshGeneration = 0
  private settingsUpdateQueue: Promise<void> = Promise.resolve()

  private async readStoredSettings(): Promise<StoredSettings> {
    const rows = (await dbAll('SELECT key, value FROM settings')) as Array<{
      key: string
      value: string
    }>
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    const poll = Number(values.matPollIntervalSeconds || DEFAULT_POLL_SECONDS)
    return {
      enabled: values.matEnabled === 'true',
      url: process.env.MAT_HUD_URL || values.matUrl || '',
      tokenConfigured: Boolean(values.matTokenEncrypted || process.env.MAT_HUD_TOKEN),
      pollIntervalSeconds: Number.isFinite(poll)
        ? Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, poll))
        : DEFAULT_POLL_SECONDS,
      encryptedToken: values.matTokenEncrypted || ''
    }
  }

  private decryptToken(encrypted: string): string {
    if (process.env.MAT_HUD_TOKEN) return process.env.MAT_HUD_TOKEN
    if (!encrypted) return ''
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS secure storage is unavailable; MAT token cannot be decrypted')
    }
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }

  private async getToken(): Promise<string> {
    const settings = await this.readStoredSettings()
    return this.decryptToken(settings.encryptedToken)
  }

  async getPublicSettings(): Promise<MatIntegrationPublicSettings> {
    const { enabled, url, tokenConfigured, pollIntervalSeconds } = await this.readStoredSettings()
    return { enabled, url, tokenConfigured, pollIntervalSeconds }
  }

  getStatus(): MatIntegrationStatus {
    return { ...this.status }
  }

  isActive(): boolean {
    return this.status.state === 'connected' || this.status.state === 'stale'
  }

  isEnabled(): boolean {
    return this.enabled
  }

  assertLocalWritesAllowed(): void {
    if (this.enabled) {
      throw new Error('This data is read-only while BebraLand MAT integration is enabled')
    }
  }

  getTeams(): Team[] | null {
    return this.isActive() ? this.teams.map((team) => ({ ...team })) : null
  }

  getTeamById(id: string): Team | null {
    return this.isActive() ? this.teams.find((team) => team._id === id) || null : null
  }

  getPlayers(steamIds?: string[]): Player[] | null {
    if (!this.isActive()) return null
    const selected = steamIds?.length
      ? this.players.filter((player) => steamIds.includes(player.steamid))
      : this.players
    return selected.map((player) => ({ ...player }))
  }

  getPlayerById(id: string): Player | null {
    return this.isActive() ? this.players.find((player) => player._id === id) || null : null
  }

  getPlayerBySteamId(steamId: string): Player | null {
    return this.isActive()
      ? this.players.find((player) => player.steamid === steamId) || null
      : null
  }

  getCurrentMatch(): Match | null {
    return this.isActive() && this.match ? structuredClone(this.match) : null
  }

  getProjection(): MatHudProjectionV1 | null {
    return this.projection ? structuredClone(this.projection) : null
  }

  async updateSettings(input: MatSettingsUpdate): Promise<MatIntegrationPublicSettings> {
    const update = this.settingsUpdateQueue.then(() => this.applySettingsUpdate(input))
    this.settingsUpdateQueue = update.then(
      () => undefined,
      () => undefined
    )
    return update
  }

  private async applySettingsUpdate(
    input: MatSettingsUpdate
  ): Promise<MatIntegrationPublicSettings> {
    const previous = await this.readStoredSettings()
    const normalizedUrl =
      input.url !== undefined ? (input.url.trim() ? normalizeMatUrl(input.url) : '') : undefined
    const suppliedToken = input.token?.trim()
    let encryptedToken: string | undefined
    if (suppliedToken) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS secure storage is unavailable; MAT token was not saved')
      }
      encryptedToken = safeStorage.encryptString(suppliedToken).toString('base64')
    }
    const urlChanged = normalizedUrl !== undefined && normalizedUrl !== previous.url
    if (urlChanged && process.env.MAT_HUD_TOKEN) {
      throw new Error('MAT URL cannot be changed in the UI while MAT_HUD_TOKEN is configured')
    }
    let normalizedPoll: number | undefined
    if (input.pollIntervalSeconds !== undefined) {
      if (!Number.isFinite(input.pollIntervalSeconds)) {
        throw new Error('MAT polling interval must be a finite number')
      }
      normalizedPoll = Math.min(
        MAX_POLL_SECONDS,
        Math.max(MIN_POLL_SECONDS, Math.round(input.pollIntervalSeconds))
      )
    }

    await this.stop()
    let transactionOpen = false
    try {
      await dbRun('BEGIN IMMEDIATE')
      transactionOpen = true
      if (urlChanged) await this.writeSetting('matTokenEncrypted', encryptedToken || '')
      if (normalizedUrl !== undefined) await this.writeSetting('matUrl', normalizedUrl)
      if (encryptedToken && !urlChanged) {
        await this.writeSetting('matTokenEncrypted', encryptedToken)
      }
      if (input.enabled !== undefined) await this.writeSetting('matEnabled', String(input.enabled))
      if (normalizedPoll !== undefined) {
        await this.writeSetting('matPollIntervalSeconds', String(normalizedPoll))
      }
      await dbRun('COMMIT')
      transactionOpen = false
    } catch (error) {
      if (transactionOpen) await dbRun('ROLLBACK').catch(() => undefined)
      await this.restart().catch(() => undefined)
      throw error
    }
    await this.restart()
    return this.getPublicSettings()
  }

  private async writeSetting(key: string, value: string): Promise<void> {
    await dbRun(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
  }

  async testConnection(input?: { url?: string; token?: string }): Promise<MatIntegrationStatus> {
    await this.settingsUpdateQueue
    const stored = await this.readStoredSettings()
    const url = input?.url?.trim() ? normalizeMatUrl(input.url) : stored.url
    const suppliedToken = input?.token?.trim()
    if (url !== stored.url && !suppliedToken) {
      throw new Error('Enter a token when testing a MAT URL different from the saved URL')
    }
    const token = suppliedToken || this.decryptToken(stored.encryptedToken)
    const projection = await this.fetchProjection(url, token)
    return {
      state: 'connected',
      message: projection.match
        ? `Connected to MAT: ${projection.match.team1.name} vs ${projection.match.team2.name}`
        : 'Connected to MAT; no broadcast match is selected',
      lastSyncAt: new Date().toISOString(),
      revision: projection.revision,
      currentMatchSlug: projection.match?.slug || null
    }
  }

  async start(io: Server): Promise<void> {
    this.localIo = io
    await this.restart()
  }

  async stop(): Promise<void> {
    this.refreshGeneration += 1
    this.refreshInFlight = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.matSocket?.disconnect()
    this.matSocket = null
  }

  private async restart(): Promise<void> {
    await this.stop()
    const generation = this.refreshGeneration
    const settings = await this.readStoredSettings()
    this.enabled = settings.enabled
    this.projection = null
    this.teams = []
    this.players = []
    this.match = null
    if (!settings.enabled) {
      this.status = {
        state: 'disabled',
        message: 'MAT integration is disabled',
        lastSyncAt: null,
        revision: null,
        currentMatchSlug: null
      }
      this.emitLocalUpdates()
      return
    }
    if (!settings.url || !settings.tokenConfigured) {
      this.status = {
        state: 'error',
        message: 'MAT URL and read-only HUD token are required',
        lastSyncAt: null,
        revision: null,
        currentMatchSlug: null
      }
      this.emitStatus()
      this.emitLocalUpdates()
      return
    }

    this.status = { ...this.status, state: 'connecting', message: 'Connecting to MAT…' }
    this.emitStatus()
    await this.refreshNowUnfenced().catch(() => undefined)
    if (generation !== this.refreshGeneration || !this.enabled) return
    const token = await this.getToken()
    if (generation !== this.refreshGeneration || !this.enabled) return
    this.matSocket = createSocket(`${settings.url}/jts-hud`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true
    })
    this.matSocket.on('hud:projection-invalidated', () => {
      if (generation === this.refreshGeneration) void this.refreshNow()
    })
    this.matSocket.on('connect_error', () => {
      if (generation !== this.refreshGeneration) return
      if (this.projection && this.status.state !== 'stale') {
        this.status = {
          ...this.status,
          state: 'connected',
          message: 'Connected to MAT via polling; live socket unavailable'
        }
        this.emitStatus()
      }
    })
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
    const trackedRefresh = refresh.finally(() => {
      if (this.refreshInFlight === trackedRefresh) this.refreshInFlight = null
    })
    this.refreshInFlight = trackedRefresh
    return this.refreshInFlight
  }

  private async performRefresh(generation: number): Promise<void> {
    try {
      const settings = await this.readStoredSettings()
      if (!settings.enabled || generation !== this.refreshGeneration) return
      const token = this.decryptToken(settings.encryptedToken)
      const projection = await this.fetchProjection(settings.url, token)
      if (generation !== this.refreshGeneration) return
      const changed = projection.revision !== this.projection?.revision
      this.projection = projection
      this.match = mapMatch(projection)
      this.teams = projection.match
        ? [mapTeam(projection.match.team1), mapTeam(projection.match.team2)]
        : []
      this.players = projection.match
        ? [...projection.match.team1.players, ...projection.match.team2.players].map(mapPlayer)
        : []
      this.status = {
        state: 'connected',
        message: projection.match
          ? `Synced ${projection.match.team1.name} vs ${projection.match.team2.name}`
          : 'Connected; no MAT broadcast match selected',
        lastSyncAt: new Date().toISOString(),
        revision: projection.revision,
        currentMatchSlug: projection.match?.slug || null
      }
      if (changed) this.emitLocalUpdates()
      else this.emitStatus()
    } catch (error) {
      if (generation !== this.refreshGeneration) return
      const message = error instanceof Error ? error.message : 'Unknown MAT connection error'
      this.status = {
        ...this.status,
        state: this.projection ? 'stale' : 'error',
        message
      }
      this.emitStatus()
    }
  }

  private async fetchProjection(url: string, token: string): Promise<MatHudProjectionV1> {
    if (!url || !token) throw new Error('MAT URL and HUD token are required')
    const response = await fetch(`${normalizeMatUrl(url)}/api/integrations/jts-hud/v1/current`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error'
    })
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? 'MAT rejected the HUD token'
          : `MAT request failed with HTTP ${response.status}`
      )
    }
    const projection = (await response.json()) as MatHudProjectionV1
    if (projection.contract !== 'bebraland-mat-hud' || projection.version !== 1) {
      throw new Error('MAT returned an unsupported HUD contract')
    }
    return projection
  }

  private emitStatus(): void {
    this.localIo?.emit('mat:status', this.getStatus())
  }

  private emitLocalUpdates(): void {
    this.emitStatus()
    this.localIo?.emit('match')
    this.localIo?.emit('teams')
    this.localIo?.emit('players')
  }
}

export const matIntegrationService = new MatIntegrationService()
