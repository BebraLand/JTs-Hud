<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAutoDirector } from '../features/auto-director/composables/useAutoDirector'
import { API_URL } from '../index'
import { getRadarMapConfig, worldToRadar } from '../features/auto-director/radar'

const { status, loading, error, saving, updateSettings, launchHlaePath } = useAutoDirector()
const hlae = computed(() => status.value.hlae)
const durationDraft = ref<Record<string, string>>({})
const launchingPathId = ref<string | null>(null)

const phases = [
  ['freezeTime', 'Freeze-time', 'Spawn establishing shots'],
  ['midRound', 'Mid-round', 'Calm cinematic transitions'],
  ['roundEnd', 'Round end', 'Post-round cinematic']
] as const

const setPhase = (phase: (typeof phases)[number][0], enabled: boolean) =>
  void updateSettings({
    hlaePresentationPhases: {
      ...status.value.settings.hlaePresentationPhases,
      [phase]: enabled
    }
  })

const stateClass = computed(() => {
  if (hlae.value.state === 'ready')
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (hlae.value.state === 'checking') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  if (hlae.value.state === 'unavailable' || hlae.value.state === 'error') {
    return 'border-red-500/30 bg-red-500/10 text-red-300'
  }
  return 'border-zinc-700 bg-zinc-900 text-zinc-500'
})

const kindLabel = (kind: string) =>
  ({ spawn: 'Spawn', mid: 'Mid', route: 'Route', site: 'Site', postplant: 'Post-plant' })[kind] ??
  'Custom'

const radarConfig = computed(() => getRadarMapConfig(hlae.value.mapName))
const radarAssetUrl = computed(() => {
  const config = radarConfig.value
  return config ? `${API_URL.replace(/\/api$/, '')}/huds/default/assets/${config.asset}` : ''
})
const radarPlayers = computed(() => hlae.value.players)
const radarBounds = computed(() => {
  const positions = radarPlayers.value.flatMap((player) =>
    player.position ? [player.position] : []
  )
  if (!positions.length) return { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 }
  const xs = positions.map((position) => position[0])
  const ys = positions.map((position) => position[1])
  const padding = 500
  return {
    minX: Math.min(...xs) - padding,
    maxX: Math.max(...xs) + padding,
    minY: Math.min(...ys) - padding,
    maxY: Math.max(...ys) + padding
  }
})

const project = (position: readonly [number, number, number] | null) => {
  if (!position) return null
  if (radarConfig.value) {
    const [x, y] = worldToRadar(position, radarConfig.value)
    return { x, y }
  }
  const bounds = radarBounds.value
  return {
    x: 40 + ((position[0] - bounds.minX) / (bounds.maxX - bounds.minX)) * 920,
    y: 610 - ((position[1] - bounds.minY) / (bounds.maxY - bounds.minY)) * 570
  }
}

const cameraConePoints = computed(() => {
  const pose = hlae.value.activePose
  const center = project(pose?.position ?? null)
  if (!pose || !center) return ''
  const angle = (pose.angles[1] * Math.PI) / 180
  const length = 150
  const fov = Math.max(1, Math.min(179, pose.fov))
  const halfFov = (fov * Math.PI) / 360
  const left = {
    x: center.x + Math.cos(angle - halfFov) * length,
    y: center.y - Math.sin(angle - halfFov) * length
  }
  const right = {
    x: center.x + Math.cos(angle + halfFov) * length,
    y: center.y - Math.sin(angle + halfFov) * length
  }
  return `${center.x},${center.y} ${left.x},${left.y} ${right.x},${right.y}`
})

const playerVisibility = (steamId: string) =>
  hlae.value.visibleSteamIds.includes(steamId)
    ? 'visible'
    : hlae.value.occludedSteamIds.includes(steamId)
      ? 'occluded'
      : 'outside'

const beginDurationEdit = (pathId: string, value: number) => {
  durationDraft.value[pathId] ??= value.toFixed(1)
}

const updateDurationDraft = (pathId: string, value: string) => {
  durationDraft.value[pathId] = value
}

const setDuration = async (pathId: string, value: number) => {
  const mapName = hlae.value.mapName
  if (!mapName || !Number.isFinite(value)) return
  const duration = Math.max(0.5, Math.min(300, Math.round(value * 10) / 10))
  durationDraft.value[pathId] = duration.toFixed(1)
  await updateSettings({
    hlaeDurationOverrides: {
      ...status.value.settings.hlaeDurationOverrides,
      [`${mapName}/${pathId}`]: duration
    }
  })
  delete durationDraft.value[pathId]
}

const commitDuration = (pathId: string) => {
  const value = Number(durationDraft.value[pathId])
  if (Number.isFinite(value)) void setDuration(pathId, value)
}

const resetDuration = async (pathId: string, baseDuration: number) => {
  const mapName = hlae.value.mapName
  if (!mapName) return
  const overrides = { ...status.value.settings.hlaeDurationOverrides }
  delete overrides[`${mapName}/${pathId}`]
  durationDraft.value[pathId] = baseDuration.toFixed(1)
  await updateSettings({ hlaeDurationOverrides: overrides })
  delete durationDraft.value[pathId]
}

const launchPath = async (pathId: string) => {
  launchingPathId.value = pathId
  try {
    await launchHlaePath(pathId)
  } finally {
    launchingPathId.value = null
  }
}
</script>

<template>
  <div
    class="camera-debug-page flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface p-4 text-zinc-200 xl:p-5 2xl:p-6"
  >
    <header class="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-text-main">HLAE Cams</h1>
        <p class="mt-1 text-sm text-zinc-400">
          Dynamic cinematic campaths loaded from the current map library.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span
          :class="stateClass"
          class="rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
        >
          HLAE {{ hlae.state }}
        </span>
        <span
          class="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-300"
        >
          {{ hlae.mapName ?? 'NO MAP' }}
        </span>
      </div>
    </header>

    <div
      v-if="error"
      class="mb-4 rounded-lg border border-red-900/50 bg-red-900/20 px-4 py-2 text-xs text-red-300"
    >
      {{ error }}
    </div>
    <div
      v-if="loading"
      class="rounded-xl border border-zinc-700 bg-zinc-800 p-8 text-center text-sm text-zinc-400"
    >
      Loading HLAE camera library…
    </div>

    <template v-else>
      <section class="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">Runtime</p>
            <p class="mt-1 text-sm text-zinc-300">{{ hlae.message }}</p>
            <p class="mt-1 text-[10px] text-zinc-500">
              HLAE uses the same Telnet settings as Auto Director. When unavailable, normal player
              directing continues.
            </p>
          </div>
          <label class="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              :checked="status.settings.hlaePresentationEnabled"
              :disabled="saving || !status.settings.enabled || hlae.pathCount === 0"
              @change="
                updateSettings({
                  hlaePresentationEnabled: ($event.target as HTMLInputElement).checked
                })
              "
              class="accent-violet-400"
            />
            Enable HLAE presentation
          </label>
        </div>
        <div class="mt-3 grid gap-2 md:grid-cols-3">
          <label
            v-for="phase in phases"
            :key="phase[0]"
            class="flex items-start gap-2 rounded-lg border border-violet-500/15 bg-black/20 p-3 text-[10px] text-zinc-400"
          >
            <input
              type="checkbox"
              :checked="status.settings.hlaePresentationPhases[phase[0]]"
              :disabled="!status.settings.hlaePresentationEnabled"
              @change="setPhase(phase[0], ($event.target as HTMLInputElement).checked)"
              class="mt-0.5 accent-violet-400"
            />
            <span>
              <span class="block font-semibold text-violet-200">{{ phase[1] }}</span>
              <span class="mt-1 block text-zinc-600">{{ phase[2] }}</span>
            </span>
          </label>
        </div>
        <p class="mt-3 text-[10px] text-violet-300">
          {{ hlae.activePathLabel ? `LIVE: ${hlae.activePathLabel}` : 'No active campath' }}
        </p>
      </section>

      <div
        class="camera-debug-layout min-h-0 min-w-0 flex-1 grid gap-3 2xl:grid-cols-[minmax(0,1fr)_520px]"
      >
        <section
          class="camera-debug-radar-panel flex min-h-0 min-w-0 flex-col rounded-xl border border-zinc-700 bg-zinc-800 p-3 sm:p-4"
        >
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">
                Live camera debug
              </p>
              <p class="mt-1 text-sm text-zinc-300">{{ hlae.summary }}</p>
            </div>
            <div class="flex gap-3 text-[10px] text-zinc-500">
              <span class="text-emerald-300">{{ hlae.visibleSteamIds.length }} visible</span>
              <span class="text-red-300">{{ hlae.occludedSteamIds.length }} occluded</span>
              <span>{{ hlae.inFrustumSteamIds.length }} in frustum</span>
              <span v-if="hlae.activePose">FOV {{ hlae.activePose.fov.toFixed(1) }}°</span>
            </div>
          </div>
          <div
            class="camera-debug-radar-surface min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-700 bg-[#090b12]"
          >
            <svg
              :viewBox="radarConfig ? '0 0 1024 1024' : '0 0 1000 650'"
              preserveAspectRatio="xMidYMid meet"
              class="block h-full w-full"
              role="img"
              aria-label="HLAE camera visibility radar"
            >
              <defs>
                <pattern id="hlae-radar-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(148,163,184,0.08)" />
                </pattern>
                <filter id="hlae-radar-glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect v-if="!radarConfig" width="1000" height="650" fill="url(#hlae-radar-grid)" />
              <rect v-else width="1024" height="1024" fill="url(#hlae-radar-grid)" opacity="0.2" />
              <image
                v-if="radarAssetUrl"
                :href="radarAssetUrl"
                x="0"
                y="0"
                width="1024"
                height="1024"
                preserveAspectRatio="none"
                opacity="0.88"
              />
              <polygon
                v-if="cameraConePoints"
                :points="cameraConePoints"
                fill="rgba(196,181,253,0.14)"
                stroke="#c4b5fd"
                stroke-width="2"
                stroke-dasharray="8 6"
              />
              <circle
                v-if="hlae.activePose && project(hlae.activePose.position)"
                :cx="project(hlae.activePose.position)?.x"
                :cy="project(hlae.activePose.position)?.y"
                r="12"
                fill="#2e1065"
                stroke="#c4b5fd"
                stroke-width="3"
                filter="url(#hlae-radar-glow)"
              />
              <text
                v-if="hlae.activePose && project(hlae.activePose.position)"
                :x="(project(hlae.activePose.position)?.x ?? 0) + 16"
                :y="(project(hlae.activePose.position)?.y ?? 0) + 4"
                fill="#ddd6fe"
                font-size="13"
                font-weight="700"
              >
                HLAE CAMERA
              </text>
              <g v-for="player in radarPlayers" :key="player.steamId">
                <circle
                  v-if="project(player.position)"
                  :cx="project(player.position)?.x"
                  :cy="project(player.position)?.y"
                  :r="playerVisibility(player.steamId) === 'visible' ? 9 : 7"
                  :fill="player.team === 'CT' ? '#0ea5e9' : '#f59e0b'"
                  :opacity="player.alive ? 1 : 0.25"
                  :stroke="
                    playerVisibility(player.steamId) === 'visible'
                      ? '#34d399'
                      : playerVisibility(player.steamId) === 'occluded'
                        ? '#f87171'
                        : '#090b12'
                  "
                  stroke-width="3"
                  filter="url(#hlae-radar-glow)"
                />
                <text
                  v-if="project(player.position)"
                  :x="(project(player.position)?.x ?? 0) + 13"
                  :y="(project(player.position)?.y ?? 0) + 4"
                  :fill="player.team === 'CT' ? '#7dd3fc' : '#fcd34d'"
                  font-size="12"
                  font-weight="700"
                  :opacity="player.alive ? 1 : 0.35"
                >
                  {{ player.name }}
                </text>
              </g>
              <text
                v-if="!radarPlayers.length"
                x="500"
                y="320"
                text-anchor="middle"
                fill="#71717a"
                font-size="16"
              >
                Start CS2 or replay a GSI state to populate the radar.
              </text>
            </svg>
          </div>
          <p class="mt-2 text-[10px] text-zinc-600">
            Green outline = visible, red outline = inside the camera frustum but blocked by static
            map geometry.
          </p>
        </section>

        <section
          class="camera-debug-sidebar-panel min-h-0 overflow-auto rounded-xl border border-zinc-700 bg-zinc-800 p-3"
        >
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <p class="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                Current map library
              </p>
              <p class="mt-1 text-sm text-zinc-300">
                {{ hlae.pathCount }} campath{{ hlae.pathCount === 1 ? '' : 's' }}
              </p>
            </div>
            <span class="text-[10px] text-zinc-600"
              >Aerial and HLAE cannot own the camera at the same time.</span
            >
          </div>
          <div
            v-if="!hlae.paths.length"
            class="rounded-lg border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500"
          >
            No HLAE XML files found for this map.
          </div>
          <div v-else class="grid gap-2 grid-cols-1 sm:grid-cols-2">
            <article
              v-for="path in hlae.paths"
              :key="path.id"
              :class="
                path.id === hlae.activePathId
                  ? 'border-violet-400/60 bg-violet-400/10'
                  : 'border-zinc-800 bg-black/20'
              "
              class="rounded-lg border p-3"
            >
              <div class="flex items-start justify-between gap-2">
                <p class="truncate text-sm font-semibold text-zinc-200">{{ path.label }}</p>
                <span
                  class="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase text-zinc-500"
                >
                  {{ kindLabel(path.kind) }}
                </span>
              </div>
              <p class="mt-2 text-[10px] text-zinc-500">
                Duration {{ path.durationSeconds.toFixed(1) }}s
              </p>
              <label class="mt-2 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                <span>Live duration</span>
                <input
                  type="number"
                  min="0.5"
                  max="300"
                  step="0.1"
                  :value="durationDraft[path.id] ?? path.durationSeconds.toFixed(1)"
                  @focus="beginDurationEdit(path.id, path.durationSeconds)"
                  @input="updateDurationDraft(path.id, ($event.target as HTMLInputElement).value)"
                  @keydown.enter.prevent="commitDuration(path.id)"
                  @blur="commitDuration(path.id)"
                  class="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-xs text-zinc-200 outline-none focus:border-violet-400"
                />
              </label>
              <div class="mt-2 flex items-center justify-between gap-2">
                <p class="text-[9px] text-zinc-600">
                  Original {{ path.baseDurationSeconds.toFixed(1) }}s
                </p>
                <button
                  type="button"
                  @mousedown.prevent
                  @click="resetDuration(path.id, path.baseDurationSeconds)"
                  class="rounded border border-zinc-700 px-2 py-1 text-[9px] font-semibold text-zinc-500 hover:border-violet-400/50 hover:text-violet-300"
                >
                  Reset timing
                </button>
              </div>
              <p class="mt-2 text-[10px] text-zinc-600">
                Start visibility: {{ path.startVisibleCount }} · score
                {{ path.startScore.toFixed(1) }}
              </p>
              <button
                type="button"
                :disabled="
                  saving || launchingPathId !== null || status.aerial.activeAnchorId !== null
                "
                @click="void launchPath(path.id)"
                class="mt-3 w-full rounded border border-violet-400/50 px-2 py-1.5 text-[10px] font-semibold text-violet-300 hover:bg-violet-400/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {{
                  launchingPathId === path.id
                    ? 'Launching…'
                    : path.id === hlae.activePathId
                      ? 'Restart campath'
                      : 'Launch campath'
                }}
              </button>
              <p
                v-if="path.id === hlae.activePathId"
                class="mt-2 text-[10px] font-semibold text-violet-300"
              >
                ACTIVE
              </p>
            </article>
          </div>
          <div class="mt-4 border-t border-zinc-700 pt-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <div>
                <p class="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Players</p>
                <p class="mt-1 text-[10px] text-zinc-600">Visibility from the active HLAE pose.</p>
              </div>
              <span class="text-[10px] text-zinc-500"
                >{{ radarPlayers.filter((player) => player.alive).length }} alive</span
              >
            </div>
            <div class="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
              <div
                v-for="player in radarPlayers"
                :key="player.steamId"
                class="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-black/10 p-2"
              >
                <div class="min-w-0 flex items-center gap-2">
                  <span
                    :class="player.team === 'CT' ? 'text-sky-300' : 'text-amber-300'"
                    class="text-[9px] font-bold"
                    >{{ player.team }}</span
                  >
                  <span
                    class="truncate text-xs"
                    :class="player.alive ? 'text-zinc-200' : 'text-zinc-600'"
                    >{{ player.name }}</span
                  >
                </div>
                <span
                  :class="
                    playerVisibility(player.steamId) === 'visible'
                      ? 'text-emerald-300'
                      : playerVisibility(player.steamId) === 'occluded'
                        ? 'text-red-300'
                        : 'text-zinc-600'
                  "
                  class="shrink-0 text-[9px] font-semibold uppercase"
                >
                  {{ playerVisibility(player.steamId) }}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
@media (max-width: 1799px), (max-height: 899px) {
  .camera-debug-page {
    display: block !important;
    height: auto !important;
    min-height: 100% !important;
    overflow-y: auto !important;
  }

  .camera-debug-layout {
    display: grid !important;
    flex: none !important;
    grid-template-columns: minmax(0, 1fr) !important;
    min-height: auto !important;
  }

  .camera-debug-radar-panel {
    min-height: 620px !important;
  }

  .camera-debug-radar-surface {
    flex: 1 1 auto !important;
    min-height: 500px !important;
  }
}
</style>
