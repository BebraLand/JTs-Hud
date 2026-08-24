<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAutoDirector } from '../features/auto-director/composables/useAutoDirector'
import { API_URL } from '../index'
import { getRadarMapConfig, worldToRadar } from '../features/auto-director/radar'

const { status, loading, error } = useAutoDirector()
const selectedAnchorId = ref<string | null>(null)

type Point = { x: number; y: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

const debug = computed(() => status.value.cameraDebug)
const radarConfig = computed(() => getRadarMapConfig(debug.value.mapName))
const radarAssetUrl = computed(() => {
  const config = radarConfig.value
  return config ? `${API_URL.replace(/\/api$/, '')}/huds/default/assets/${config.asset}` : ''
})
const selectedAnchor = computed(() => {
  const anchors = debug.value.anchors
  return (
    anchors.find((anchor) => anchor.id === selectedAnchorId.value) ??
    anchors.find((anchor) => anchor.id === debug.value.activeAnchorId) ??
    anchors[0] ??
    null
  )
})
const alivePlayers = computed(() => debug.value.players.filter((player) => player.alive))
const bestAnchor = computed(() => debug.value.anchors[0] ?? null)

const bounds = computed<Bounds>(() => {
  const positions = [
    ...debug.value.players.flatMap((player) => (player.position ? [player.position] : [])),
    ...debug.value.anchors.map((anchor) => anchor.position)
  ]
  if (!positions.length) return { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 }
  const xs = positions.map((position) => position[0])
  const ys = positions.map((position) => position[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const paddingX = Math.max(300, (maxX - minX) * 0.12)
  const paddingY = Math.max(300, (maxY - minY) * 0.12)
  return { minX: minX - paddingX, maxX: maxX + paddingX, minY: minY - paddingY, maxY: maxY + paddingY }
})

const project = (position: readonly [number, number, number] | null): Point | null => {
  if (!position) return null
  const map = radarConfig.value
  if (map) {
    const [x, y] = worldToRadar(position, map)
    return { x, y }
  }
  const currentBounds = bounds.value
  return {
    x: 48 + ((position[0] - currentBounds.minX) / (currentBounds.maxX - currentBounds.minX)) * 904,
    y: 606 - ((position[1] - currentBounds.minY) / (currentBounds.maxY - currentBounds.minY)) * 540
  }
}

const conePoints = (position: readonly [number, number, number] | null, forward: readonly [number, number, number] | null, length = 92): string => {
  const center = project(position)
  if (!center || !forward) return ''
  const angle = Math.atan2(forward[1], forward[0])
  const halfFov = Math.PI / 4
  const left = { x: center.x + Math.cos(angle - halfFov) * length, y: center.y - Math.sin(angle - halfFov) * length }
  const right = { x: center.x + Math.cos(angle + halfFov) * length, y: center.y - Math.sin(angle + halfFov) * length }
  return `${center.x},${center.y} ${left.x},${left.y} ${right.x},${right.y}`
}

const anchorConePoints = (position: readonly [number, number, number], angles: readonly [number, number, number]): string =>
  conePoints(position, [Math.cos((angles[1] * Math.PI) / 180), Math.sin((angles[1] * Math.PI) / 180), 0], 132)

const playerById = computed(() => new Map(debug.value.players.map((player) => [player.steamId, player])))
const losEdges = computed(() => {
  const edges: Array<{ from: Point; to: Point; kind: 'visible' | 'occluded' }> = []
  for (const player of debug.value.players) {
    const from = project(player.position)
    if (!from) continue
    for (const targetId of player.visibleEnemySteamIds) {
      const to = project(playerById.value.get(targetId)?.position ?? null)
      if (to) edges.push({ from, to, kind: 'visible' })
    }
    if (player.nearestEnemySteamId && !player.nearestEnemyVisible) {
      const to = project(playerById.value.get(player.nearestEnemySteamId)?.position ?? null)
      if (to) edges.push({ from, to, kind: 'occluded' })
    }
  }
  return edges
})
const anchorEdges = computed(() => {
  const anchor = selectedAnchor.value
  if (!anchor) return []
  const from = project(anchor.position)
  if (!from) return []
  return [
    ...anchor.visibleSteamIds,
    ...anchor.occludedSteamIds
  ].flatMap((steamId) => {
    const to = project(playerById.value.get(steamId)?.position ?? null)
    if (!to) return []
    return [{ from, to, kind: anchor.visibleSteamIds.includes(steamId) ? 'visible' : 'occluded' as const }]
  })
})

const scoreWidth = (score: number) => `${Math.min(100, Math.max(3, score))}%`
const formatScore = (score: number) => score.toFixed(1)
const formatPosition = (position: readonly [number, number, number] | null) =>
  position ? `${Math.round(position[0])}, ${Math.round(position[1])}` : 'no position'
const teamClass = (team: string) => (team === 'CT' ? 'text-sky-300' : 'text-amber-300')
const selectAnchor = (id: string) => {
  selectedAnchorId.value = selectedAnchorId.value === id ? null : id
}
</script>

<template>
  <div class="min-h-full bg-[#0b0b11] p-6 text-zinc-100 xl:p-8">
    <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-3">
          <div class="grid size-10 place-items-center rounded-xl border border-violet-400/30 bg-violet-400/10 text-violet-300">
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <circle cx="12" cy="12" r="3" />
              <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
              <path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3" />
            </svg>
          </div>
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-violet-300">BebraLand Camera Intelligence</p>
            <h1 class="text-2xl font-bold tracking-tight">Camera Debug</h1>
          </div>
        </div>
        <p class="mt-2 text-sm text-zinc-500">Read-only radar for GSI players, static geometry LOS and calibrated Aerial cameras.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span :class="status.connected ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500'" class="rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wider">
          {{ status.connected ? 'GSI LIVE' : 'WAITING FOR GSI' }}
        </span>
        <span class="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-300">
          {{ debug.mapName ?? 'NO MAP' }}
        </span>
        <span :class="radarConfig ? 'border-emerald-500/25 text-emerald-300' : 'border-amber-500/25 text-amber-300'" class="rounded-full border bg-black/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
          {{ radarConfig ? 'RADAR MAP READY' : 'RADAR MAP UNKNOWN' }}
        </span>
      </div>
    </header>

    <div v-if="error" class="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{{ error }}</div>
    <div v-if="loading" class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-12 text-center text-sm text-zinc-500">Loading camera diagnostics…</div>

    <template v-else>
      <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Live state</p>
          <p class="mt-2 text-lg font-semibold text-white">{{ debug.summary }}</p>
        </div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Current POV</p>
          <p class="mt-2 truncate text-lg font-semibold text-cyan-300">{{ debug.players.find((player) => player.steamId === debug.currentPlayerSteamId)?.name ?? 'none' }}</p>
        </div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Best camera</p>
          <p class="mt-2 truncate text-lg font-semibold text-violet-300">{{ bestAnchor?.label ?? 'none' }}</p>
        </div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Evidence boundary</p>
          <p class="mt-2 text-xs leading-5 text-zinc-400">Static map geometry only. Smoke, doors and breakables remain runtime unknown.</p>
        </div>
      </div>

      <div class="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_390px]">
        <section class="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Live radar</h2>
              <p class="mt-1 text-xs text-zinc-600">Player direction, estimated visibility and selected Aerial coverage.</p>
            </div>
            <div class="flex flex-wrap gap-3 text-[10px] text-zinc-500">
              <span><i class="mr-1 inline-block size-2 rounded-full bg-cyan-300" />current</span>
              <span><i class="mr-1 inline-block size-2 rounded-full bg-violet-300" />Aerial</span>
              <span><i class="mr-1 inline-block size-2 rounded-full bg-emerald-400" />LOS</span>
              <span><i class="mr-1 inline-block size-2 rounded-full bg-red-400" />blocked</span>
            </div>
          </div>

          <div class="overflow-hidden rounded-xl border border-zinc-800 bg-[#090b12]">
            <svg :viewBox="radarConfig ? '0 0 1024 1024' : '0 0 1000 650'" :class="radarConfig ? 'aspect-square' : 'aspect-[1.52]'" class="block w-full" role="img" aria-label="Camera debug radar">
              <defs>
                <pattern id="radar-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(148,163,184,0.08)" stroke-width="1" />
                </pattern>
                <filter id="radar-glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>
              <rect v-if="!radarConfig" width="1000" height="650" fill="url(#radar-grid)" />
              <rect v-else width="1024" height="1024" fill="url(#radar-grid)" opacity="0.2" />
              <image v-if="radarAssetUrl" :href="radarAssetUrl" x="0" y="0" width="1024" height="1024" preserveAspectRatio="none" opacity="0.88" />
              <rect :x="radarConfig ? 12 : 16" :y="radarConfig ? 12 : 16" :width="radarConfig ? 1000 : 968" :height="radarConfig ? 1000 : 618" rx="14" fill="none" stroke="rgba(148,163,184,0.18)" />

              <g v-for="(edge, index) in losEdges" :key="`los-${index}`" opacity="0.38">
                <line :x1="edge.from.x" :y1="edge.from.y" :x2="edge.to.x" :y2="edge.to.y" :stroke="edge.kind === 'visible' ? '#34d399' : '#f87171'" stroke-width="1.5" stroke-dasharray="5 5" />
              </g>
              <g v-for="(edge, index) in anchorEdges" :key="`anchor-edge-${index}`" opacity="0.62">
                <line :x1="edge.from.x" :y1="edge.from.y" :x2="edge.to.x" :y2="edge.to.y" :stroke="edge.kind === 'visible' ? '#a78bfa' : '#fb923c'" stroke-width="2" />
              </g>

              <g v-for="anchor in debug.anchors" :key="anchor.id" class="cursor-pointer" @click="selectAnchor(anchor.id)">
                <polygon :points="anchorConePoints(anchor.position, anchor.angles)" :fill="selectedAnchor?.id === anchor.id ? 'rgba(167,139,250,0.12)' : 'rgba(167,139,250,0.04)'" :stroke="selectedAnchor?.id === anchor.id ? '#c4b5fd' : '#8b5cf6'" stroke-width="1" stroke-dasharray="6 5" />
                <circle :cx="project(anchor.position)?.x" :cy="project(anchor.position)?.y" r="9" fill="#171126" stroke="#a78bfa" stroke-width="2" />
                <text :x="(project(anchor.position)?.x ?? 0) + 14" :y="(project(anchor.position)?.y ?? 0) + 4" fill="#c4b5fd" font-size="12" font-weight="600">{{ anchor.label }}</text>
                <text :x="(project(anchor.position)?.x ?? 0) + 14" :y="(project(anchor.position)?.y ?? 0) + 19" fill="#8b5cf6" font-size="10">CAM {{ formatScore(anchor.cameraScore) }}</text>
              </g>

              <g v-for="player in debug.players" :key="player.steamId">
                <polygon v-if="player.alive" :points="conePoints(player.position, player.forward)" :fill="player.steamId === debug.currentPlayerSteamId ? 'rgba(34,211,238,0.12)' : 'rgba(148,163,184,0.04)'" :stroke="player.steamId === debug.currentPlayerSteamId ? '#22d3ee' : 'rgba(148,163,184,0.18)'" stroke-width="1" />
                <circle v-if="project(player.position)" :cx="project(player.position)?.x" :cy="project(player.position)?.y" :r="player.steamId === debug.currentPlayerSteamId ? 10 : 7" :fill="player.team === 'CT' ? '#0ea5e9' : '#f59e0b'" :opacity="player.alive ? 1 : 0.25" :stroke="player.steamId === debug.currentPlayerSteamId ? '#cffafe' : '#090b12'" stroke-width="3" filter="url(#radar-glow)" />
                <text v-if="project(player.position)" :x="(project(player.position)?.x ?? 0) + 13" :y="(project(player.position)?.y ?? 0) + 4" :fill="player.steamId === debug.currentPlayerSteamId ? '#cffafe' : player.team === 'CT' ? '#7dd3fc' : '#fcd34d'" font-size="13" font-weight="700" :opacity="player.alive ? 1 : 0.35">{{ player.name }}</text>
                <text v-if="project(player.position)" :x="(project(player.position)?.x ?? 0) + 13" :y="(project(player.position)?.y ?? 0) + 18" fill="#71717a" font-size="10">{{ player.alive ? `CAM ${formatScore(player.cameraScore)}` : 'DEAD' }}</text>
              </g>

              <text v-if="!debug.players.length && !debug.anchors.length" x="500" y="320" text-anchor="middle" fill="#71717a" font-size="16">Start CS2 or replay a GSI fixture to populate the radar.</text>
            </svg>
          </div>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-600">
            <span>{{ debug.geometryMessage }}</span>
            <span>Cones are approximate 90° horizontal FOV projections.</span>
          </div>
        </section>

        <aside class="space-y-5">
          <section class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Saved cameras</h2>
                <p class="mt-1 text-xs text-zinc-600">Coverage score is advisory only.</p>
              </div>
              <span class="text-xs text-zinc-500">{{ debug.anchors.length }} anchors</span>
            </div>
            <div v-if="!debug.anchors.length" class="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">No calibrated Aerial anchors for this map.</div>
            <div v-else class="space-y-2">
              <button v-for="anchor in debug.anchors" :key="anchor.id" @click="selectAnchor(anchor.id)" :class="selectedAnchor?.id === anchor.id ? 'border-violet-400/60 bg-violet-400/10' : 'border-zinc-800 bg-black/10 hover:border-zinc-700'" class="w-full rounded-xl border p-3 text-left transition-colors">
                <div class="flex items-center justify-between gap-3">
                  <span class="truncate text-sm font-semibold text-zinc-100">{{ anchor.label }}</span>
                  <span class="font-mono text-sm font-bold text-violet-300">{{ formatScore(anchor.cameraScore) }}</span>
                </div>
                <div class="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800"><div class="h-full rounded-full bg-violet-400" :style="{ width: scoreWidth(anchor.cameraScore) }" /></div>
                <div class="mt-2 flex items-center justify-between text-[10px] text-zinc-500"><span>{{ anchor.kind }} · {{ anchor.visibleSteamIds.length }} visible</span><span>{{ anchor.occludedSteamIds.length }} blocked</span></div>
              </button>
            </div>
          </section>

          <section class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Players</h2>
                <p class="mt-1 text-xs text-zinc-600">Nickname first, debug score second.</p>
              </div>
              <span class="text-xs text-zinc-500">{{ alivePlayers.length }} alive · {{ debug.players.length }} tracked</span>
            </div>
            <div class="space-y-2">
              <div v-for="player in debug.players" :key="player.steamId" :class="player.steamId === debug.currentPlayerSteamId ? 'border-cyan-400/50 bg-cyan-400/5' : 'border-zinc-800 bg-black/10'" class="rounded-xl border p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0 flex items-center gap-2"><span :class="teamClass(player.team)" class="text-[10px] font-bold">{{ player.team }}</span><span class="truncate text-sm font-semibold" :class="player.alive ? 'text-zinc-100' : 'text-zinc-600'">{{ player.name }}</span></div>
                  <span class="font-mono text-sm font-bold text-cyan-300">{{ formatScore(player.cameraScore) }}</span>
                </div>
                <div class="mt-2 flex items-center justify-between text-[10px] text-zinc-500"><span>priority {{ formatScore(player.priorityScore) }} · slot {{ player.observerSlot }}</span><span>{{ player.alive ? `${player.health} HP` : 'DEAD' }}</span></div>
                <div class="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800"><div class="h-full rounded-full bg-cyan-400" :style="{ width: scoreWidth(player.cameraScore) }" /></div>
              </div>
            </div>
          </section>

          <section class="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Camera explanation</h2>
                <p class="mt-1 text-xs text-zinc-500">{{ selectedAnchor?.label ?? 'Select an anchor' }}</p>
              </div>
              <span v-if="selectedAnchor" class="font-mono text-xl font-bold text-violet-200">{{ formatScore(selectedAnchor.cameraScore) }}</span>
            </div>
            <div v-if="selectedAnchor" class="mt-4 space-y-2 text-xs text-zinc-400">
              <p v-for="reason in selectedAnchor.reasons" :key="reason" class="flex gap-2"><span class="text-violet-300">+</span>{{ reason }}</p>
              <p class="border-t border-violet-400/10 pt-3 text-[10px] text-zinc-600">Position {{ formatPosition(selectedAnchor.position) }} · yaw {{ Math.round(selectedAnchor.angles[1]) }}°</p>
            </div>
            <p v-else class="mt-4 text-xs text-zinc-600">Live Aerial coverage reasons will appear here when anchors are loaded.</p>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>
