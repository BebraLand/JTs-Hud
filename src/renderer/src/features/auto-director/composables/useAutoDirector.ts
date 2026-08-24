import { computed, onMounted, onUnmounted, ref } from 'vue'
import { API_URL } from '../../../index'
import { socket } from '../../../socket'
import type { AutoDirectorSettings, AutoDirectorStatus, CameraTransport } from '../types'

const emptyStatus = (): AutoDirectorStatus => ({
  settings: {
    enabled: false,
    paused: false,
    mode: 'balanced',
    autoFallback: false,
    rulesEnabled: true,
    sceneAdvisoryEnabled: true,
    geometryAdvisoryEnabled: true,
    mlAdvisoryEnabled: true,
    aerialPresentationEnabled: false,
    scoringIntervalMs: 100,
    manualOverrideSteamId: null,
    customWeights: {}
  },
  connected: false,
  lastGsiAt: null,
  running: false,
  decision: null,
  lastCommand: null,
  transportHealth: {
    telnet: {
      state: 'unknown',
      lastCheckedAt: null,
      message: 'Not tested',
      consecutiveFailures: 0
    },
    keyboard: {
      state: 'unknown',
      lastCheckedAt: null,
      message: 'Not tested',
      consecutiveFailures: 0
    }
  },
  history: [],
  ml: {
    enabled: true,
    modelLoaded: false,
    modelMessage: 'Loading model',
    geometry: {
      mapName: null,
      state: 'missing',
      triangleCount: 0,
      message: 'No map requested'
    },
    topology: {
      mapName: null,
      state: 'missing',
      areaCount: 0,
      portalCount: 0,
      message: 'No map requested'
    }
  },
  aerial: {
    enabled: false,
    mapName: null,
    state: 'missing',
    anchorCount: 0,
    message: 'No map requested',
    activeAnchorId: null,
    activeAnchorLabel: null,
    activeUntil: null,
    reason: 'Aerial presentation disabled',
    visibleSteamIds: []
  }
})

export function useAutoDirector() {
  const status = ref<AutoDirectorStatus>(emptyStatus())
  const loading = ref(true)
  const saving = ref(false)
  const error = ref<string | null>(null)
  let controlToken: string | null = null

  const players = computed(() => status.value.decision?.scores ?? [])
  const current = computed(() =>
    players.value.find((player) => player.steamId === status.value.decision?.currentSteamId)
  )
  const candidate = computed(() =>
    players.value.find((player) => player.steamId === status.value.decision?.candidateSteamId)
  )

  const readJson = async (response: Response) => {
    const body = await response.json()
    if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
    return body
  }

  const controlHeaders = async (): Promise<Record<string, string>> => {
    controlToken ??= await window.api.getControlToken()
    return {
      'Content-Type': 'application/json',
      'X-JTs-Control-Token': controlToken
    }
  }

  const refresh = async () => {
    loading.value = true
    error.value = null
    try {
      status.value = await readJson(await fetch(`${API_URL}/auto-director`))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  const updateSettings = async (patch: Partial<AutoDirectorSettings>) => {
    saving.value = true
    error.value = null
    try {
      status.value = await readJson(
        await fetch(`${API_URL}/auto-director/settings`, {
          method: 'PUT',
          headers: await controlHeaders(),
          body: JSON.stringify(patch)
        })
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }

  const forcePlayer = async (steamId: string | null) => {
    saving.value = true
    error.value = null
    try {
      status.value = await readJson(
        await fetch(`${API_URL}/auto-director/force`, {
          method: 'POST',
          headers: await controlHeaders(),
          body: JSON.stringify({ steamId })
        })
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      saving.value = false
    }
  }

  const testTransport = async (transport: CameraTransport, observerSlot = 1) => {
    saving.value = true
    error.value = null
    try {
      const result = await readJson(
        await fetch(`${API_URL}/auto-director/test-transport`, {
          method: 'POST',
          headers: await controlHeaders(),
          body: JSON.stringify({ transport, observerSlot })
        })
      )
      status.value.lastCommand = result
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      saving.value = false
    }
  }

  const onStatus = (next: AutoDirectorStatus) => {
    status.value = next
    loading.value = false
  }

  onMounted(() => {
    socket.on('auto-director:update', onStatus)
    void refresh()
  })

  onUnmounted(() => {
    socket.off('auto-director:update', onStatus)
  })

  return {
    status,
    players,
    current,
    candidate,
    loading,
    saving,
    error,
    refresh,
    updateSettings,
    forcePlayer,
    testTransport
  }
}
