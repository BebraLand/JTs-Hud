import { Router } from 'express'
import type { Request, Response } from 'express'
import type { Server } from 'socket.io'
import { upload } from '../../utils/multer'
import { notifyHudDataChanged } from '../../hudRefresh'
import {
  getTeams,
  getTeamLogo,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam
} from './team.controller'

export default function createTeamRouter(io: Server) {
  const router = Router()

  router.get('/', getTeams)
  router.get('/logo/:id', getTeamLogo) // must be before /:id to avoid conflict
  router.get('/:id', getTeamById)
  const notifyIfSuccessful = (handler: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      await handler(req, res)
      if (res.statusCode < 400) void notifyHudDataChanged(io, 'team')
    }

  router.post('/', upload.single('logo'), notifyIfSuccessful(createTeam))
  router.put('/:id', upload.single('logo'), notifyIfSuccessful(updateTeam))
  router.delete('/:id', notifyIfSuccessful(deleteTeam))

  return router
}
