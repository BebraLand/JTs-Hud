import { Router, Request, Response } from 'express'
import { dbAll, dbRun } from '../../database/sqlite'
import { matIntegrationService } from '../../integrations/mat.integration'

const router = Router()

export interface AppSettings {
  autoSwitchSides: boolean
  telnetHost: string
  telnetPort: number
  matEnabled: boolean
  matUrl: string
  matTokenConfigured: boolean
  matPollIntervalSeconds: number
}

const DEFAULT_SETTINGS: AppSettings = {
  autoSwitchSides: true,
  telnetHost: '127.0.0.1',
  telnetPort: 2020,
  matEnabled: false,
  matUrl: '',
  matTokenConfigured: false,
  matPollIntervalSeconds: 5
}

// Load all settings from the DB and return as a typed object
export const getSettings = async (): Promise<AppSettings> => {
  const rows: { key: string; value: string }[] = await dbAll('SELECT key, value FROM settings')
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    autoSwitchSides:
      map.autoSwitchSides !== undefined
        ? map.autoSwitchSides === 'true'
        : DEFAULT_SETTINGS.autoSwitchSides,
    telnetHost: map.telnetHost ?? DEFAULT_SETTINGS.telnetHost,
    telnetPort: map.telnetPort !== undefined ? Number(map.telnetPort) : DEFAULT_SETTINGS.telnetPort,
    matEnabled: map.matEnabled === 'true',
    matUrl: map.matUrl || '',
    matTokenConfigured: Boolean(map.matTokenEncrypted || process.env.MAT_HUD_TOKEN),
    matPollIntervalSeconds: Number(map.matPollIntervalSeconds || 5)
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
  res.status(403).json({ error: 'MAT settings can only be changed from the local JTs-Hud app' })
}

router.get('/mat/status', async (_req: Request, res: Response) => {
  res.json(matIntegrationService.getStatus())
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

// GET /api/settings — return all settings as a JSON object
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await getSettings())
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/settings — update one or more settings keys
router.put('/', async (req: Request, res: Response) => {
  try {
    const updates: Partial<AppSettings> = req.body
    const localKeys = new Set(['autoSwitchSides', 'telnetHost', 'telnetPort'])
    for (const [key, value] of Object.entries(updates).filter(([key]) => localKeys.has(key))) {
      await dbRun(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, String(value)]
      )
    }
    res.json(await getSettings())
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
