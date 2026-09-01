import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { API_URL } from '../../../index'
import { useTeams } from '../../teams/composables/useTeams'
import { usePlayers } from '../../players/composables/usePlayers'
import { useMatches } from '../../matches/composables/useMatches'
import { socket } from '../../../socket'

export type PanelInput = {
  type: string
  name: string
  label: string
  default?: boolean
  requires?: 'mat'
  values?: { name: string; label: string }[]
}

export type PanelSection = {
  name: string
  label: string
  inputs: PanelInput[]
}

const EMPTY_SECTION: PanelSection = { name: '', label: '', inputs: [] }
const HUD_BASE = API_URL.replace('/api', '')

export function useHudPanelView() {
  const route = useRoute()
  const hudId = route.params.hudId as string

  const { teams, fetchTeams } = useTeams()
  const { players, fetchPlayers } = usePlayers()
  const { matches, fetchMatches } = useMatches()

  const panel = ref<PanelSection[]>([])
  const config = ref<Record<string, Record<string, any>>>({})
  const sectionStatus = ref<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const activeTab = ref<string>('')
  const matEnabled = ref(false)
  const developerTestingEnabled = ref(false)
  const debugMapEndActive = ref(false)
  const debugMapEndBusy = ref(false)

  const activeSection = computed<PanelSection>(
    () => panel.value.find((s) => s.name === activeTab.value) ?? EMPTY_SECTION
  )

  const hasNonActionInputs = (section: PanelSection) =>
    section.inputs.some((i) => i.type !== 'action')

  const hasPlayerInput = (section: PanelSection) => section.inputs.some((i) => i.type === 'player')

  // --- Live player tracking ---
  const livePlayerSteamIds = ref<Set<string>>(new Set())
  const showOnlyActivePlayers = ref<Record<string, boolean>>({})

  const onGSIUpdate = (data: any) => {
    livePlayerSteamIds.value = data?.allplayers ? new Set(Object.keys(data.allplayers)) : new Set()
  }

  const onMatStatus = (status: { state?: string } | null) => {
    if (status?.state) matEnabled.value = status.state !== 'disabled'
  }

  const playersForSection = (sectionName: string) => {
    if (!showOnlyActivePlayers.value[sectionName] || livePlayerSteamIds.value.size === 0) {
      return players.value
    }
    return players.value.filter((p) => p.steamid && livePlayerSteamIds.value.has(p.steamid))
  }

  // --- Load ---
  const loadPanel = async () => {
    const res = await fetch(`${API_URL}/huds/${hudId}/panel`)
    if (!res.ok) return
    panel.value = await res.json()
  }

  const loadConfig = async () => {
    const res = await fetch(`${API_URL}/huds/${hudId}/config`)
    if (res.ok) config.value = await res.json()
  }

  const loadMatSettings = async () => {
    const res = await fetch(`${API_URL}/settings`)
    if (res.ok) {
      const settings = await res.json()
      matEnabled.value = settings.matEnabled === true
      developerTestingEnabled.value = settings.developerTestingEnabled === true
    }
  }

  const loadDebugMapEnd = async () => {
    if (!developerTestingEnabled.value) return
    const res = await fetch(`${API_URL}/settings/debug/map-end`)
    if (res.ok) debugMapEndActive.value = (await res.json()).enabled === true
  }

  const toggleDebugMapEnd = async () => {
    debugMapEndBusy.value = true
    try {
      const res = await fetch(`${API_URL}/settings/debug/map-end`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !debugMapEndActive.value })
      })
      if (res.ok) debugMapEndActive.value = (await res.json()).enabled === true
    } finally {
      debugMapEndBusy.value = false
    }
  }

  const seedConfig = () => {
    for (const section of panel.value) {
      if (!config.value[section.name]) config.value[section.name] = {}
      if (!(section.name in showOnlyActivePlayers.value)) {
        showOnlyActivePlayers.value[section.name] = false
      }
      for (const input of section.inputs) {
        if (input.type === 'action') continue
        if (config.value[section.name][input.name] === undefined) {
          config.value[section.name][input.name] =
            input.type === 'checkbox'
              ? input.default ?? false
              : input.type === 'images'
                ? []
                : ''
        }
      }
    }
  }

  onMounted(async () => {
    socket.on('update', onGSIUpdate)
    socket.on('mat:status', onMatStatus)
    await Promise.all([fetchTeams(), fetchPlayers(), fetchMatches(), loadMatSettings()])
    await loadPanel()
    if (panel.value.length) activeTab.value = panel.value[0].name
    seedConfig()
    await loadConfig()
    seedConfig()
    await loadDebugMapEnd()
  })

  onUnmounted(() => {
    socket.off('update', onGSIUpdate)
    socket.off('mat:status', onMatStatus)
  })

  // --- Save section config ---
  const saveSectionConfig = async (sectionName: string) => {
    sectionStatus.value[sectionName] = 'saving'
    try {
      const res = await fetch(`${API_URL}/huds/${hudId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.value)
      })
      sectionStatus.value[sectionName] = res.ok ? 'saved' : 'error'
    } catch {
      sectionStatus.value[sectionName] = 'error'
    } finally {
      setTimeout(() => {
        sectionStatus.value[sectionName] = 'idle'
      }, 2000)
    }
  }

  // --- Fire action ---
  const fireAction = async (actionName: string, valueName: string) => {
    await fetch(`${API_URL}/huds/${hudId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName, data: valueName })
    })
  }

  // --- Image helpers ---
  const uploadFile = async (file: File): Promise<{ url: string; filename: string } | null> => {
    const formData = new FormData()
    formData.append('image', file)
    const res = await fetch(`${API_URL}/huds/${hudId}/upload`, { method: 'POST', body: formData })
    if (!res.ok) return null
    const data = await res.json()
    return { url: `${HUD_BASE}${data.url}`, filename: data.filename }
  }

  const deleteFile = async (filename: string) => {
    await fetch(`${API_URL}/huds/${hudId}/upload/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    })
  }

  const filenameFromUrl = (url: string) => url.split('/').pop() ?? ''

  const uploadImage = async (sectionName: string, inputName: string, file: File) => {
    const existing = config.value[sectionName]?.[inputName]
    if (existing) await deleteFile(filenameFromUrl(existing))
    const result = await uploadFile(file)
    if (result) {
      if (!config.value[sectionName]) config.value[sectionName] = {}
      config.value[sectionName][inputName] = result.url
    }
  }

  const clearImage = async (sectionName: string, inputName: string) => {
    const existing = config.value[sectionName]?.[inputName]
    if (existing) await deleteFile(filenameFromUrl(existing))
    config.value[sectionName][inputName] = ''
  }

  const uploadImageToList = async (sectionName: string, inputName: string, file: File) => {
    const result = await uploadFile(file)
    if (result) {
      if (!Array.isArray(config.value[sectionName][inputName]))
        config.value[sectionName][inputName] = []
      config.value[sectionName][inputName].push(result.url)
    }
  }

  const removeImageFromList = async (sectionName: string, inputName: string, url: string) => {
    await deleteFile(filenameFromUrl(url))
    config.value[sectionName][inputName] = (
      config.value[sectionName][inputName] as string[]
    ).filter((u) => u !== url)
  }

  return {
    hudId,
    teams,
    players,
    matches,
    panel,
    config,
    sectionStatus,
    activeTab,
    activeSection,
    matEnabled,
    developerTestingEnabled,
    debugMapEndActive,
    debugMapEndBusy,
    hasNonActionInputs,
    hasPlayerInput,
    livePlayerSteamIds,
    showOnlyActivePlayers,
    playersForSection,
    saveSectionConfig,
    fireAction,
    toggleDebugMapEnd,
    uploadImage,
    clearImage,
    uploadImageToList,
    removeImageFromList
  }
}
