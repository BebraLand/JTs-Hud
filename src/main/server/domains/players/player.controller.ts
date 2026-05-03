import { Request, Response } from 'express'
import { PlayerService } from './player.service'
import { deleteUploadedFile } from '../../utils/multer'
import { syncCoaches } from '../../integrations/gsi'

const playerService = new PlayerService()

export const getPlayers = async (req: Request, res: Response) => {
  try {
    const steamids = req.query.steamids as string | undefined
    const players = await playerService.getPlayers(steamids)
    res.json(players)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}

export const getPlayerAvatar = async (req: Request, res: Response) => {
  try {
    const avatarData = await playerService.getPlayerAvatar(req.params.steamid as string)
    res.json(avatarData)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}

export const getPlayerById = async (req: Request, res: Response) => {
  try {
    const player = await playerService.getPlayerById(req.params.id as string)
    if (!player) return res.status(404).json({ error: 'Player not found' })
    res.json(player)
    return
  } catch (error: any) {
    res.status(500).json({ error: error.message })
    return
  }
}

export const createPlayer = async (req: Request, res: Response) => {
  try {
    const playerData = req.body
    if (req.file) {
      playerData.avatar = `/api/uploads/${req.file.filename}`
    }
    // FormData sends booleans as strings
    playerData.isCoach = playerData.isCoach === 'true' || playerData.isCoach === true
    const player = await playerService.createPlayer(playerData)
    syncCoaches()
    res.status(201).json(player)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}

export const updatePlayer = async (req: Request, res: Response) => {
  try {
    const playerData = req.body
    if (req.file) {
      const existing = await playerService.getPlayerById(req.params.id as string)
      if (existing?.avatar) deleteUploadedFile(existing.avatar)
      playerData.avatar = `/api/uploads/${req.file.filename}`
    }
    // FormData sends booleans as strings
    playerData.isCoach = playerData.isCoach === 'true' || playerData.isCoach === true
    const player = await playerService.updatePlayer(req.params.id as string, playerData)
    if (!player) return res.status(404).json({ error: 'Player not found' })
    syncCoaches()
    res.json(player)
    return
  } catch (error: any) {
    res.status(400).json({ error: error.message })
    return
  }
}

export const deletePlayer = async (req: Request, res: Response) => {
  try {
    const player = await playerService.getPlayerById(req.params.id as string)
    if (player?.avatar) deleteUploadedFile(player.avatar)
    await playerService.deletePlayer(req.params.id as string)
    syncCoaches()
    res.status(204).send()
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
}
