import { Server, Socket } from 'socket.io'
import { getHudConfig } from './domains/huds/hud.routes'
import { getActiveHudId } from './server'

export const setupSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
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
          const hudId = getActiveHudId() || hudName
          const config = await getHudConfig(hudId)
          socket.emit('hud_config', config)
        } catch (e) {
          console.error('Failed to push hud_config on register:', e)
        }
      }
    )
  })
}
