import { Router, Request, Response } from 'express'
import { dbAll, dbRun } from '../../database/sqlite'
import { matIntegrationService } from '../../integrations/mat.integration'
import { challongeIntegrationService } from '../../integrations/challonge.integration'
import { refreshTournamentLabels } from '../../integrations/tournamentLabels'
import { resolveTelnetSettings } from './telnetSettings'

const router = Router()
let debugMapEndEnabled = false
let debugSeriesEndEnabled = false

export interface AppSettings {
  autoSwitchSides: boolean
  autoRefreshHuds: boolean
  developerTestingEnabled: boolean
  telnetHost: string
  telnetPort: number
  matEnabled: boolean
  matUrl: string
  matTokenConfigured: boolean
  matPollIntervalSeconds: number
  matUseSteamAvatars: boolean
  challongeEnabled: boolean
  challongeTournament: string
  challongeSourceConfigured: boolean
  challongePollIntervalSeconds: number
  tournamentIntegrationPriority: 'mat' | 'challonge'
}

const DEFAULT_SETTINGS: AppSettings = {
  autoSwitchSides: true,
  autoRefreshHuds: true,
  developerTestingEnabled: false,
  telnetHost: '127.0.0.1',
  telnetPort: 2020,
  matEnabled: false,
  matUrl: '',
  matTokenConfigured: false,
  matPollIntervalSeconds: 5,
  matUseSteamAvatars: false,
  challongeEnabled: false,
  challongeTournament: '',
  challongeSourceConfigured: false,
  challongePollIntervalSeconds: 10,
  tournamentIntegrationPriority: 'challonge'
}

// Load all settings from the DB and return as a typed object
export const getSettings = async (): Promise<AppSettings> => {
  const rows: { key: string; value: string }[] = await dbAll('SELECT key, value FROM settings')
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const telnet = resolveTelnetSettings(map)
  return {
    autoSwitchSides:
      map.autoSwitchSides !== undefined
        ? map.autoSwitchSides === 'true'
        : DEFAULT_SETTINGS.autoSwitchSides,
    autoRefreshHuds:
      map.autoRefreshHuds !== undefined
        ? map.autoRefreshHuds === 'true'
        : DEFAULT_SETTINGS.autoRefreshHuds,
    developerTestingEnabled:
      map.developerTestingEnabled !== undefined
        ? map.developerTestingEnabled === 'true'
        : DEFAULT_SETTINGS.developerTestingEnabled,
    telnetHost: telnet.host,
    telnetPort: telnet.port,
    matEnabled: map.matEnabled === 'true',
    matUrl: map.matUrl || '',
    matTokenConfigured: Boolean(map.matTokenEncrypted || process.env.MAT_HUD_TOKEN),
    matPollIntervalSeconds: Number(map.matPollIntervalSeconds || 5),
    matUseSteamAvatars: map.matUseSteamAvatars === 'true',
    challongeEnabled: map.challongeEnabled === 'true',
    challongeTournament: map.challongeTournament || '',
    challongeSourceConfigured: Boolean(map.challongeTournament),
    challongePollIntervalSeconds: Number(map.challongePollIntervalSeconds || 10),
    tournamentIntegrationPriority: map.tournamentIntegrationPriority === 'mat' ? 'mat' : 'challonge'
  }
}

const requireLocalOrigin = (req: Request, res: Response, next: () => void) => {
  const origin = req.get('origin')
  if (!origin || origin === 'null') return next()
  try {
    const host = new URL(origin).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return next()
  } catch {
    // Fall through to the rejection below.
  }
  res.status(403).json({ error: 'Settings can only be changed from the local JTs-Hud app' })
}

router.get('/mat/status', async (_req: Request, res: Response) => {
  res.json(matIntegrationService.getStatus())
})

router.get('/mat/projection', (_req: Request, res: Response) => {
  res.json(matIntegrationService.getProjection())
})

router.get('/debug/map-end', (_req: Request, res: Response) => {
  res.json({ enabled: debugMapEndEnabled })
})

router.put('/debug/map-end', requireLocalOrigin, (req: Request, res: Response) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Debug map-end enabled must be a boolean' })
  }
  debugMapEndEnabled = req.body.enabled
  if (debugMapEndEnabled) debugSeriesEndEnabled = false
  return res.json({ enabled: debugMapEndEnabled })
})

router.get('/debug/series-end', (_req: Request, res: Response) => {
  res.json({ enabled: debugSeriesEndEnabled })
})

router.put('/debug/series-end', requireLocalOrigin, (req: Request, res: Response) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Debug series-end enabled must be a boolean' })
  }
  debugSeriesEndEnabled = req.body.enabled
  if (debugSeriesEndEnabled) debugMapEndEnabled = false
  return res.json({ enabled: debugSeriesEndEnabled })
})

router.post('/mat/test', requireLocalOrigin, async (req: Request, res: Response) => {
  try {
    res.json(await matIntegrationService.testConnection(req.body))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.post('/mat/refresh', requireLocalOrigin, async (_req: Request, res: Response) => {
  await matIntegrationService.refreshNow()
  res.json(matIntegrationService.getStatus())
})

router.put('/mat', requireLocalOrigin, async (req: Request, res: Response) => {
  try {
    const settings = await matIntegrationService.updateSettings(req.body)
    res.json({ ...settings, status: matIntegrationService.getStatus() })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.get('/challonge/status', async (_req: Request, res: Response) => {
  res.json(challongeIntegrationService.getStatus())
})

router.post('/challonge/test', requireLocalOrigin, async (req: Request, res: Response) => {
  try {
    res.json(await challongeIntegrationService.testConnection(req.body))
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.post('/challonge/refresh', requireLocalOrigin, async (_req: Request, res: Response) => {
  await challongeIntegrationService.refreshNow()
  res.json(challongeIntegrationService.getStatus())
})

router.put('/challonge', requireLocalOrigin, async (req: Request, res: Response) => {
  try {
    const settings = await challongeIntegrationService.updateSettings(req.body)
    res.json({ ...settings, status: challongeIntegrationService.getStatus() })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/settings — return all settings as a JSON object
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await getSettings())
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/settings — update one or more settings keys
router.put('/', requireLocalOrigin, async (req: Request, res: Response) => {
  try {
    const updates: Partial<AppSettings> = req.body
    const localKeys = new Set([
      'autoSwitchSides',
      'autoRefreshHuds',
      'developerTestingEnabled',
      'telnetHost',
      'telnetPort',
      'tournamentIntegrationPriority'
    ])
    if (
      updates.developerTestingEnabled !== undefined &&
      typeof updates.developerTestingEnabled !== 'boolean'
    ) {
      return res.status(400).json({ error: 'Developer/testing setting must be a boolean' })
    }
    if (
      updates.telnetHost !== undefined &&
      (typeof updates.telnetHost !== 'string' || !updates.telnetHost.trim())
    ) {
      return res.status(400).json({ error: 'Telnet host is required' })
    }
    if (updates.telnetPort !== undefined) {
      const port = Number(updates.telnetPort)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return res.status(400).json({ error: 'Telnet port must be 1-65535' })
      }
    }
    for (const [key, value] of Object.entries(updates).filter(([key]) => localKeys.has(key))) {
      if (key === 'tournamentIntegrationPriority' && value !== 'mat' && value !== 'challonge') {
        return res
          .status(400)
          .json({ error: 'Tournament integration priority must be mat or challonge' })
      }
      await dbRun(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, key === 'telnetHost' ? String(value).trim() : String(value)]
      )
    }
    await refreshTournamentLabels()
    return res.json(await getSettings())
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
