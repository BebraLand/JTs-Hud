import { ref } from 'vue'
import { API_URL } from '../../../index'

export interface AppSettings {
  autoSwitchSides: boolean
  autoRefreshHuds: boolean
  telnetHost: string
  telnetPort: number
  matEnabled: boolean
  matUrl: string
  matTokenConfigured: boolean
  matPollIntervalSeconds: number
}

export interface MatStatus {
  state: 'disabled' | 'connecting' | 'connected' | 'stale' | 'error'
  message: string
  lastSyncAt: string | null
  revision: string | null
  currentMatchSlug: string | null
  tokenMode: 'manual' | 'automatic' | null
}

export function useSettings() {
  const settings = ref<AppSettings>({
    autoSwitchSides: true,
    autoRefreshHuds: true,
    telnetHost: '127.0.0.1',
    telnetPort: 2020,
    matEnabled: false,
    matUrl: '',
    matTokenConfigured: false,
    matPollIntervalSeconds: 5
  })
  const matStatus = ref<MatStatus | null>(null)
  const error = ref('')
  const isLoading = ref(false)
  const isSaving = ref(false)
  const isTesting = ref(false)

  const readError = async (res: Response): Promise<string> => {
    const payload = await res.json().catch(() => null)
    return payload?.error || `Request failed with HTTP ${res.status}`
  }

  const fetchSettings = async () => {
    isLoading.value = true
    error.value = ''
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch(`${API_URL}/settings`),
        fetch(`${API_URL}/settings/mat/status`)
      ])
      if (settingsRes.ok) settings.value = await settingsRes.json()
      if (statusRes.ok) matStatus.value = await statusRes.json()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch settings'
    } finally {
      isLoading.value = false
    }
  }

  const saveSettings = async (updates: Partial<AppSettings>) => {
    isSaving.value = true
    error.value = ''
    try {
      const res = await fetch(`${API_URL}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (!res.ok) throw new Error(await readError(res))
      settings.value = await res.json()
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save settings'
      return false
    } finally {
      isSaving.value = false
    }
  }

  const saveMatSettings = async (input: {
    enabled: boolean
    url: string
    token?: string
    pollIntervalSeconds: number
  }) => {
    isSaving.value = true
    error.value = ''
    try {
      const res = await fetch(`${API_URL}/settings/mat`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
      if (!res.ok) throw new Error(await readError(res))
      const payload = await res.json()
      settings.value = {
        ...settings.value,
        matEnabled: payload.enabled,
        matUrl: payload.url,
        matTokenConfigured: payload.tokenConfigured,
        matPollIntervalSeconds: payload.pollIntervalSeconds
      }
      matStatus.value = payload.status
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save MAT settings'
      return false
    } finally {
      isSaving.value = false
    }
  }

  const testMatConnection = async (input: { url: string; token?: string }) => {
    isTesting.value = true
    error.value = ''
    try {
      const res = await fetch(`${API_URL}/settings/mat/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
      if (!res.ok) throw new Error(await readError(res))
      matStatus.value = await res.json()
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'MAT connection test failed'
      return false
    } finally {
      isTesting.value = false
    }
  }

  const refreshMat = async () => {
    error.value = ''
    try {
      const res = await fetch(`${API_URL}/settings/mat/refresh`, { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res))
      matStatus.value = await res.json()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'MAT refresh failed'
    }
  }

  return {
    settings,
    matStatus,
    error,
    isLoading,
    isSaving,
    isTesting,
    fetchSettings,
    saveSettings,
    saveMatSettings,
    testMatConnection,
    refreshMat
  }
}
