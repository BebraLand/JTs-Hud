import { ref } from 'vue'
import { API_URL } from '../../../index'
import { useConfirmation } from '../../../composables/useConfirmation'

export function useTeams() {
  const teams = ref<any[]>([])
  const isLoading = ref(false)

  const fetchTeams = async () => {
    isLoading.value = true
    try {
      const res = await fetch(`${API_URL}/teams`)
      if (res.ok) teams.value = await res.json()
    } catch (error) {
      console.error('Failed to fetch teams:', error)
    } finally {
      isLoading.value = false
    }
  }

  const saveTeam = async (payload: any, id: string | null = null, file: File | null = null) => {
    try {
      const method = id ? 'PUT' : 'POST'
      const url = id ? `${API_URL}/teams/${id}` : `${API_URL}/teams`

      // Switch from JSON to FormData
      const formData = new FormData()
      Object.keys(payload).forEach((key) => {
        const value = typeof payload[key] === 'object' ? JSON.stringify(payload[key]) : payload[key]
        formData.append(key, value)
      })

      if (file) formData.append('logo', file)

      const res = await fetch(url, {
        method,
        body: formData
      })

      if (!res.ok) throw new Error('Failed to save team')
      await fetchTeams()
      return await res.json()
    } catch (error) {
      console.error(error)
      throw error
    }
  }

  const { confirmChoice } = useConfirmation()

  const deleteTeam = async (id: string) => {
    const choice = await confirmChoice(
      'What would you like to delete?',
      'Delete Team & All Players',
      'Delete Team Only'
    )
    if (!choice) return false

    try {
      const url =
        choice === 'primary'
          ? `${API_URL}/teams/${id}?deletePlayers=true`
          : `${API_URL}/teams/${id}`

      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete team')

      await fetchTeams()
      return true
    } catch (error) {
      console.error(error)
      return false
    }
  }

  const deleteManyTeams = async (ids: string[]) => {
    if (!ids.length) return false
    const choice = await confirmChoice(
      `Delete ${ids.length} team(s). What would you like to do?`,
      'Delete Teams & All Players',
      'Delete Teams Only'
    )
    if (!choice) return false
    try {
      for (const id of ids) {
        const url =
          choice === 'primary'
            ? `${API_URL}/teams/${id}?deletePlayers=true`
            : `${API_URL}/teams/${id}`
        await fetch(url, { method: 'DELETE' })
      }
      await fetchTeams()
      return true
    } catch (error) {
      console.error(error)
      return false
    }
  }

  return {
    teams,
    isLoading,
    fetchTeams,
    saveTeam,
    deleteTeam,
    deleteManyTeams
  }
}
