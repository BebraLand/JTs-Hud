// src/main/domains/players/player.routes.ts
import { Router } from 'express'
import type { Request, Response } from 'express'
import type { Server } from 'socket.io'
import { upload } from '../../utils/multer'
import { notifyHudDataChanged } from '../../hudRefresh'
import {
  getPlayers,
  getPlayerAvatar,
  getPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer
} from './player.controller'

export default function createPlayerRouter(io: Server) {
  const router = Router()

  router.get('/', getPlayers)
  router.get('/avatar/steamid/:steamid', getPlayerAvatar)
  router.get('/:id', getPlayerById)
  const notifyIfSuccessful = (handler: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      await handler(req, res)
      if (res.statusCode < 400) void notifyHudDataChanged(io, 'player')
    }

  router.post('/', upload.single('avatar'), notifyIfSuccessful(createPlayer))
  router.put('/:id', upload.single('avatar'), notifyIfSuccessful(updatePlayer))
  router.delete('/:id', notifyIfSuccessful(deletePlayer))

  return router
}
