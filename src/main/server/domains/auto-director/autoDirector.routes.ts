import { Router, Request, Response, NextFunction } from 'express'
import { autoDirectorService } from './autoDirector.service'
import type { CameraTransport } from './autoDirector.types'
import { databaseReady } from '../../database/sqlite'
import { isValidControlToken } from '../../controlToken'

const router = Router()

const requireControlToken = (req: Request, res: Response, next: NextFunction): void => {
  if (isValidControlToken(req.get('x-jts-control-token'))) return next()
  res.status(403).json({ error: 'Invalid JTs-Hud control token' })
}

const requireDatabaseReady = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await databaseReady
    next()
  } catch {
    res.status(503).json({ error: 'JTs-Hud database is not ready' })
  }
}

router.get('/', (_req: Request, res: Response) => {
  res.json(autoDirectorService.getStatus())
})

router.put(
  '/settings',
  requireControlToken,
  requireDatabaseReady,
  async (req: Request, res: Response) => {
    try {
      res.json(await autoDirectorService.updateSettings(req.body ?? {}))
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  }
)

router.post(
  '/force',
  requireControlToken,
  requireDatabaseReady,
  async (req: Request, res: Response) => {
    try {
      const steamId = req.body?.steamId
      if (steamId !== null && typeof steamId !== 'string') {
        return res.status(400).json({ error: 'steamId must be a string or null' })
      }
      return res.json(await autoDirectorService.updateSettings({ manualOverrideSteamId: steamId }))
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  }
)

router.post('/test-transport', requireControlToken, async (req: Request, res: Response) => {
  const transport = req.body?.transport as CameraTransport
  if (transport !== 'telnet' && transport !== 'keyboard') {
    return res.status(400).json({ error: 'transport must be telnet or keyboard' })
  }
  const observerSlot =
    req.body?.observerSlot === undefined ? undefined : Number(req.body.observerSlot)
  return res.json(await autoDirectorService.testTransport(transport, observerSlot))
})

export default router
