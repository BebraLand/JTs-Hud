import { MatchRepository } from './match.repository'
import { CreateMatchDTO, UpdateMatchDTO } from './match.types'
import { matIntegrationService } from '../../integrations/mat.integration'

export class MatchService {
  private repo = new MatchRepository()

  async getAllMatches() {
    const matMatch = matIntegrationService.getCurrentMatch()
    if (matMatch) return [matMatch]
    if (matIntegrationService.isEnabled()) return []
    return this.repo.getAllMatches()
  }

  async getCurrentMatch() {
    const matMatch = matIntegrationService.getCurrentMatch()
    if (matMatch) return matMatch
    if (matIntegrationService.isEnabled()) throw new Error('No MAT broadcast match is available')
    const match = await this.repo.getCurrentMatch()
    if (!match) {
      throw new Error('No current match found')
    }
    return match
  }

  async getMatchById(id: string) {
    const matMatch = matIntegrationService.getCurrentMatch()
    if (matMatch?.id === id) return matMatch
    if (matIntegrationService.isActive()) throw new Error('Match not found')
    const match = await this.repo.getMatchById(id)
    if (!match) throw new Error('Match not found')
    return match
  }

  async createMatch(data: CreateMatchDTO) {
    matIntegrationService.assertLocalWritesAllowed()
    if (data.current) {
      await this.repo.setAllMatchesNotCurrent()
    }
    return this.repo.createMatch(data)
  }

  async updateMatch(id: string, data: UpdateMatchDTO) {
    matIntegrationService.assertLocalWritesAllowed()
    if (data.current) {
      await this.repo.setAllMatchesNotCurrent()
    }
    const match = await this.repo.updateMatch(id, data)
    if (!match) throw new Error('Match not found to update')
    return match
  }

  async deleteMatch(id: string) {
    matIntegrationService.assertLocalWritesAllowed()
    return this.repo.deleteMatch(id)
  }

  async toggleVetoReverseSide(mapName: string) {
    matIntegrationService.assertLocalWritesAllowed()
    const match = await this.repo.toggleVetoReverseSide(mapName)
    if (!match) throw new Error('No current match or map not found in vetos')
    return match
  }
}
