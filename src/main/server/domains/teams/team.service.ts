import { TeamRepository } from './team.repository'
import { CreateTeamDTO, UpdateTeamDTO } from './team.types'
import { matIntegrationService } from '../../integrations/mat.integration'

export class TeamService {
  private repo = new TeamRepository()

  async getTeams() {
    const matTeams = matIntegrationService.getTeams()
    if (matTeams) return matTeams
    if (matIntegrationService.isEnabled()) return []
    return this.repo.getTeams()
  }

  async getTeamById(id: string) {
    const matTeam = matIntegrationService.getTeamById(id)
    if (matTeam) return matTeam
    if (matIntegrationService.isActive()) return null
    return this.repo.getTeamById(id)
  }

  async getTeamLogoPath(id: string): Promise<string | null> {
    const matTeam = matIntegrationService.getTeamById(id)
    if (matTeam) return matTeam.logo || null
    if (matIntegrationService.isActive()) return null
    const team = await this.repo.getTeamById(id)
    if (!team || !team.logo) return null
    // logo is stored as "/api/uploads/<filename>" - extract just the filename
    return team.logo.split('/').pop() ?? null
  }

  async createTeam(data: CreateTeamDTO) {
    matIntegrationService.assertLocalWritesAllowed()
    return this.repo.createTeam(data)
  }

  async updateTeam(id: string, data: UpdateTeamDTO) {
    matIntegrationService.assertLocalWritesAllowed()
    return this.repo.updateTeam(id, data)
  }

  async deleteTeam(id: string) {
    matIntegrationService.assertLocalWritesAllowed()
    return this.repo.deleteTeam(id)
  }

  async deleteTeamWithPlayers(id: string) {
    matIntegrationService.assertLocalWritesAllowed()
    return this.repo.deleteTeamWithPlayers(id)
  }
}
