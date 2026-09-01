import { Server, Socket } from 'socket.io'
import { getHudConfig } from './domains/huds/hud.routes'
import { getActiveHudId } from './server'
import { getHudRefreshState, refreshAllHuds } from './hudRefresh'
import { getLastHudState } from './integrations/gsi'
import { matIntegrationService } from './integrations/mat.integration'
import { challongeIntegrationService } from './integrations/challonge.integration'
import { getResolvedTournamentLabels } from './integrations/tournamentLabels'

export const resolveRegisteredHudId = (
  hudName: string | null | undefined,
  activeHudId: string | null | undefined
): string => {
  const registeredHudId = typeof hudName === 'string' ? hudName.trim() : ''
  return registeredHudId || activeHudId || 'default'
}

export const setupSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    socket.emit('hud:refresh-state', getHudRefreshState())
    socket.emit('mat:status', matIntegrationService.getStatus())
    socket.emit('challonge:status', challongeIntegrationService.getStatus())
    void getResolvedTournamentLabels().then((labels) => {
      socket.emit('tournament:labels', labels)
      socket.emit('mat:labels', labels)
    })

    socket.on('request-hud-refresh', () => {
      refreshAllHuds(io)
    })

    // HUD registration:
    socket.on('started', () => {
      socket.emit('readyToRegister')
    })

    // HUD emits "register", server pushes the latest saved panel config
    socket.on(
      'register',
      async (hudName: string, _isDev: boolean, _game: string, _type: string) => {
        try {
          // Mark socket as a HUD so GSI updates can be filtered for it
          socket.join('huds')
          // Prefer the id reported by the registering HUD. The global active id
          // belongs to the Electron overlay and may be stale for browser URLs
          // such as /huds/bebraland/index.html?variant=vertical.
          const hudId = resolveRegisteredHudId(hudName, getActiveHudId())
          const config = await getHudConfig(hudId)
          socket.emit('hud_config', config)
          const labels = await getResolvedTournamentLabels()
          socket.emit('mat:labels', labels)
          const lastHudState = getLastHudState()
          if (lastHudState) socket.emit('update', lastHudState)
          socket.emit('match')
        } catch (e) {
          console.error('Failed to push hud_config on register:', e)
        }
      }
    )
  })
}
