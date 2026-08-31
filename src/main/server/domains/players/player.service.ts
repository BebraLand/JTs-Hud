import { PlayerRepository } from './player.repository'
import { CreatePlayerDTO, UpdatePlayerDTO } from './player.types'
import { matIntegrationService } from '../../integrations/mat.integration'
import { proxyAssetUrl } from '../../utils/assetProxy'

export class PlayerService {
  private repo = new PlayerRepository()

  async getPlayers(steamidsString?: string) {
    // The HUD sends steamids as a semicolon-separated string: "steamids=id1;id2"
    let steamidsArray: string[] | undefined = undefined

    if (steamidsString) {
      steamidsArray = steamidsString.split(';').filter((id) => id.trim() !== '')
    }

    const matPlayers = matIntegrationService.getPlayers(steamidsArray)
    if (matPlayers) return matPlayers
    if (matIntegrationService.isEnabled()) return []
    const players = await this.repo.getPlayers(steamidsArray)
    return players.map((player) => ({ ...player, avatar: proxyAssetUrl(player.avatar) }))
  }

  async getPlayerAvatar(steamid: string) {
    const matPlayer = matIntegrationService.getPlayerBySteamId(steamid)
    if (matPlayer?.avatar) return { custom: matPlayer.avatar, steam: matPlayer.avatar }

    const matAvatar = await matIntegrationService.getBroadcastPlayerAvatar(steamid)
    if (matAvatar) return { custom: matAvatar, steam: matAvatar }
    if (matPlayer) return { custom: '', steam: '' }

    const player = await this.repo.getPlayerBySteamId(steamid)
    if (!player) {
      return { custom: '', steam: '' } // If player doesnt exist
    }

    const avatar = proxyAssetUrl(player.avatar)
    return {
      custom: avatar,
      steam: avatar
    }
  }

  async getPlayerById(id: string) {
    const matPlayer = matIntegrationService.getPlayerById(id)
    if (matPlayer) return matPlayer
    if (matIntegrationService.isActive()) return null
    return this.repo.getPlayerById(id)
  }

  async createPlayer(data: CreatePlayerDTO) {
    matIntegrationService.assertLocalWritesAllowed()
    return this.repo.createPlayer(data)
  }

  async updatePlayer(id: string, data: UpdatePlayerDTO) {
    matIntegrationService.assertLocalWritesAllowed()
    return this.repo.updatePlayer(id, data)
  }

  async deletePlayer(id: string) {
    matIntegrationService.assertLocalWritesAllowed()
    return this.repo.deletePlayer(id)
  }
}
