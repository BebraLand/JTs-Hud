import dotenv from 'dotenv'
dotenv.config() // Load .env variables before anything else

import './database/sqlite'
import express from 'express'
import cors from 'cors'

import { createServer } from 'http'
import { Server } from 'socket.io'
import { setupSockets } from './socket'
import { getLastHudState, setupGSI } from './integrations/gsi'

import createMatchRouter from './domains/matches/match.routes'
import createPlayerRouter from './domains/players/player.routes'
import createTeamRouter from './domains/teams/team.routes'
import createHudRouter from './domains/huds/hud.routes'
import settingsRoutes from './domains/settings/settings.routes'
import spectatorRoutes from './domains/spectator/spectator.routes'
import autoDirectorRoutes from './domains/auto-director/autoDirector.routes'
import { autoDirectorService } from './domains/auto-director/autoDirector.service'
import { uploadsPath } from './utils/multer'
import { getHudsDir, getBuiltinHudDir } from '../paths'
import { signedHudMiddleware } from './middleware/signedHudMiddleware'
import { matIntegrationService } from './integrations/mat.integration'
import { challongeIntegrationService } from './integrations/challonge.integration'
import { databaseReady } from './database/sqlite'
import { getSystemStats } from './systemStats'
import { proxyAsset } from './utils/assetProxy'

// Track the currently active HUD id so the socket register handler can look up correct HUD
let activeHudId: string | null = null
export const setActiveHudId = (id: string | null) => {
  activeHudId = id
}
export const getActiveHudId = () => activeHudId

// Setup HUD Server (Port 1349)
const hudsPath = getHudsDir()
const app = express()

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  })
)

const httpServer = createServer(app)
export const io = new Server(httpServer, {
  cors: { origin: '*' }
})

app.use(express.json())
// Middleware to handle signed HUD files (decode JWT before serving)
app.use(signedHudMiddleware)
// Bundled HUD mounts must come first so they take priority over the user HUD folder.
app.use('/huds/default', express.static(getBuiltinHudDir()))
app.use('/huds/bebraland', express.static(getBuiltinHudDir('bebraland')))
app.use('/huds', express.static(hudsPath))
app.use('/api/uploads', express.static(uploadsPath))
app.get('/api/assets/proxy', proxyAsset)

app.use('/api/huds', createHudRouter(io))
app.use('/api/teams', createTeamRouter(io))
app.use('/api/players', createPlayerRouter(io))
app.use('/api/match', createMatchRouter(io))
app.use('/api/settings', settingsRoutes)
app.use('/api/spectator', spectatorRoutes)
app.use('/api/auto-director', autoDirectorRoutes)
app.get('/api/gsi/state', (_req, res) => {
  const state = getLastHudState()
  if (!state) {
    res.status(204).end()
    return
  }

  res.setHeader('cache-control', 'no-store')
  res.json(state)
})
app.get('/api/system/stats', (_req, res) => {
  res.json(getSystemStats())
})

setupSockets(io)

// Setup GSI Listener Server (Port 23415)
const gsiApp = express()
gsiApp.use(express.json())
gsiApp.use(cors({ origin: '*' }))
gsiApp.use('/cs2', setupGSI(io)) // This is what the gsi cfg file sends data to

const HUD_PORT = Number(process.env.HUD_PORT || 1349)
const GSI_PORT = Number(process.env.GSI_PORT || 23415)

let serversRunning = false

// Start both servers
export function startServers(): void {
  if (serversRunning) return
  serversRunning = true

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[HUD Server] Port ${HUD_PORT} is already in use.`)
    } else {
      console.error('[HUD Server] Server error:', err)
    }
  })
  httpServer.listen(HUD_PORT, '127.0.0.1', () => {
    console.log(`HUD Server and WebSockets listening on port ${HUD_PORT}`)
    void databaseReady
      .then(async () => {
        await autoDirectorService.initialize(io)
        await matIntegrationService.start(io)
        await challongeIntegrationService.start(io)
      })
      .catch((error) => {
        console.error('[Server] Failed to initialize database-backed services:', error)
      })
  })

  const gsiServer = gsiApp.listen(GSI_PORT, '127.0.0.1', () => {
    console.log(`CS2 GSI Listener running on port ${GSI_PORT}`)
  })
  gsiServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[GSI Server] Port ${GSI_PORT} is already in use.`)
    } else {
      console.error('[GSI Server] Server error:', err)
    }
  })

  // Store reference so stopServers/shutdown can close it
  activeGsiServer = gsiServer
}

let activeGsiServer: ReturnType<typeof gsiApp.listen> | null = null

// Stop both servers
export function stopServers(): Promise<void> {
  if (!serversRunning) return Promise.resolve()
  serversRunning = false
  void matIntegrationService.stop()
  void challongeIntegrationService.stop()
  return new Promise((resolve) => {
    const done = () => {
      activeGsiServer = null
      resolve()
    }
    io.close(() => {
      httpServer.closeAllConnections?.()
      httpServer.close(() => {
        if (activeGsiServer) {
          activeGsiServer.closeAllConnections?.()
          activeGsiServer.close(() => {
            console.log('[Server] Servers stopped.')
            done()
          })
        } else {
          done()
        }
      })
    })
  })
}

// Gracefully shut down all servers and socket connections (called on app quit)
export function shutdown(): Promise<void> {
  return stopServers()
}
