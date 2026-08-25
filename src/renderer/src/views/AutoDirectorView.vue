<script setup lang="ts">
import { computed } from 'vue'
import { useAutoDirector } from '../features/auto-director/composables/useAutoDirector'
import type { AutoDirectorMode } from '../features/auto-director/types'

const {
  status,
  players,
  current,
  candidate,
  loading,
  saving,
  error,
  updateSettings,
  forcePlayer,
  testTransport
} = useAutoDirector()

const modes: { value: AutoDirectorMode; label: string; detail: string }[] = [
  { value: 'balanced', label: 'Balanced', detail: 'Broadcast-ready default' },
  { value: 'reactive', label: 'Reactive', detail: 'Fast combat response' },
  { value: 'calm', label: 'Calm / Story', detail: 'Longer POV narratives' }
]

const weightDefinitions = [
  ['objective', 'Plant / defuse'],
  ['combat', 'Active combat'],
  ['damage', 'Recent damage'],
  ['recentKill', 'Recent kill'],
  ['proximity', 'Enemy proximity'],
  ['aimAlignment', 'Aim alignment'],
  ['clutch', 'Clutch'],
  ['grenade', 'Grenade play'],
  ['entry', 'Entry pressure'],
  ['retake', 'Retake pressure'],
  ['weaponPressure', 'Weapon situation'],
  ['bombCarrier', 'Bomb carrier'],
  ['lowHealthDrama', 'Low-HP pressure'],
  ['continuity', 'Story continuity']
] as const

const profileDefaults: Record<AutoDirectorMode, Record<string, number>> = {
  balanced: {
    objective: 72,
    combat: 34,
    damage: 24,
    recentKill: 32,
    proximity: 24,
    aimAlignment: 18,
    clutch: 34,
    grenade: 10,
    entry: 12,
    retake: 18,
    weaponPressure: 10,
    bombCarrier: 10,
    lowHealthDrama: 8,
    continuity: 10
  },
  reactive: {
    objective: 76,
    combat: 46,
    damage: 32,
    recentKill: 36,
    proximity: 30,
    aimAlignment: 24,
    clutch: 30,
    grenade: 13,
    entry: 16,
    retake: 22,
    weaponPressure: 12,
    bombCarrier: 8,
    lowHealthDrama: 7,
    continuity: 5
  },
  calm: {
    objective: 80,
    combat: 28,
    damage: 18,
    recentKill: 24,
    proximity: 18,
    aimAlignment: 14,
    clutch: 40,
    grenade: 8,
    entry: 8,
    retake: 18,
    weaponPressure: 10,
    bombCarrier: 14,
    lowHealthDrama: 10,
    continuity: 20
  }
}

const effectiveWeight = (key: string): number =>
  status.value.settings.customWeights[key] ?? profileDefaults[status.value.settings.mode][key] ?? 0

const setWeight = (key: string, value: number) => {
  void updateSettings({
    customWeights: { ...status.value.settings.customWeights, [key]: value }
  })
}

const resetWeights = () => void updateSettings({ customWeights: {} })

const setAerialPhase = (phase: 'freezeTime' | 'midRound' | 'roundEnd', enabled: boolean) =>
  void updateSettings({
    aerialPresentationPhases: {
      ...status.value.settings.aerialPresentationPhases,
      [phase]: enabled
    }
  })

const lockRemaining = computed(() => {
  const until = status.value.decision?.lockUntil
  return until ? Math.max(0, until - Date.now()) : 0
})

const connectionLabel = computed(() => (status.value.connected ? 'GSI LIVE' : 'WAITING FOR GSI'))
const runningLabel = computed(() => {
  if (!status.value.settings.enabled) return 'DISABLED'
  if (status.value.settings.paused) return 'PAUSED'
  return status.value.running ? 'DIRECTING' : 'ARMED'
})

const formatTime = (at: number | null | undefined) =>
  at
    ? new Date(at).toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : 'never'

const scoreWidth = (score: number) => `${Math.min(100, Math.max(3, score / 1.6))}%`
const slotLabel = (slot: number) => (slot === 0 || slot === 10 ? '0' : String(slot))
const healthClass = (state: string) =>
  state === 'healthy'
    ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'
    : state === 'error' || state === 'unsupported'
      ? 'border-red-500/25 bg-red-500/5 text-red-300'
      : state === 'degraded'
        ? 'border-amber-500/25 bg-amber-500/5 text-amber-300'
        : 'border-zinc-800 bg-black/20 text-zinc-500'
</script>

<template>
  <div class="auto-director-page flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0b0b11] p-4 text-zinc-100 xl:p-5 2xl:p-6">
    <header class="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-3">
          <div
            class="size-10 rounded-xl border border-cyan-400/30 bg-cyan-400/10 grid place-items-center text-cyan-300"
          >
            <svg
              class="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
            </svg>
          </div>
          <div>
            <p class="text-[11px] uppercase tracking-[0.28em] text-cyan-400 font-semibold">
              BebraLand Broadcast Intelligence
            </p>
            <h1 class="text-2xl font-bold tracking-tight">Auto Director</h1>
          </div>
        </div>
        <p class="mt-1 text-xs text-zinc-500">
          Explainable first-person observer control. Telnet is the primary camera transport.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <span
          :class="
            status.connected
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-zinc-700 bg-zinc-900 text-zinc-500'
          "
          class="rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wider"
          >{{ connectionLabel }}</span
        >
        <span
          :class="
            status.running
              ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300'
              : status.settings.paused
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-500'
          "
          class="rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wider"
          >{{ runningLabel }}</span
        >
      </div>
    </header>

    <div
      v-if="error"
      class="mb-3 shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300"
    >
      {{ error }}
    </div>
    <div
      v-if="loading"
      class="min-h-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 text-center text-zinc-500"
    >
      Loading auto-director service…
    </div>

    <template v-else>
      <section class="auto-director-control-strip mb-3 min-w-0 shrink-0 grid gap-2 lg:grid-cols-[1fr_auto]">
        <div class="grid gap-2 sm:grid-cols-3">
          <button
            v-for="mode in modes"
            :key="mode.value"
            @click="updateSettings({ mode: mode.value })"
            :class="
              status.settings.mode === mode.value
                ? 'border-cyan-400/60 bg-cyan-400/10 text-white'
                : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:border-zinc-700'
            "
            class="rounded-xl border px-4 py-3 text-left transition-colors"
          >
            <span class="block text-sm font-semibold">{{ mode.label }}</span>
            <span class="mt-0.5 block text-xs text-zinc-500">{{ mode.detail }}</span>
          </button>
        </div>
        <div class="flex gap-2">
          <button
            @click="updateSettings({ paused: !status.settings.paused })"
            :disabled="saving || !status.settings.enabled"
            class="rounded-xl border border-zinc-700 bg-zinc-900 px-5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            {{ status.settings.paused ? 'Resume' : 'Pause' }}
          </button>
          <button
            @click="updateSettings({ enabled: !status.settings.enabled, paused: false })"
            :disabled="saving"
            :class="
              status.settings.enabled
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : 'border-cyan-400/50 bg-cyan-400 text-zinc-950'
            "
            class="rounded-xl border px-5 text-sm font-bold transition-colors disabled:opacity-50"
          >
            {{ status.settings.enabled ? 'Disable' : 'Enable Director' }}
          </button>
        </div>
      </section>

      <div class="auto-director-layout min-h-0 min-w-0 flex-1 grid gap-3 2xl:grid-cols-[minmax(430px,520px)_minmax(0,1fr)]">
        <aside class="auto-director-settings min-w-0 space-y-3 2xl:overflow-y-auto 2xl:pr-1">
          <section
            class="min-h-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3 shadow-2xl shadow-black/20"
          >
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400">
                Broadcast Focus
              </h2>
              <span class="text-[11px] text-zinc-600">{{ formatTime(status.decision?.at) }}</span>
            </div>

            <div
              class="rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-400/[0.09] to-transparent p-3"
            >
              <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Current first-person POV
              </p>
              <div class="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p class="text-2xl font-bold">{{ current?.name ?? 'No camera target' }}</p>
                  <p
                    class="mt-1 text-xs font-semibold"
                    :class="current?.team === 'CT' ? 'text-blue-400' : 'text-amber-400'"
                  >
                    {{ current?.team ?? 'WAITING' }}
                    <span v-if="current">· SLOT {{ slotLabel(current.observerSlot) }}</span>
                  </p>
                </div>
                <div v-if="current" class="text-right">
                  <p class="text-[10px] uppercase tracking-widest text-zinc-600">Score</p>
                  <p class="text-3xl font-black text-cyan-300">{{ current.total.toFixed(1) }}</p>
                </div>
              </div>
            </div>

            <div class="mt-3 space-y-2 text-xs">
              <div class="rounded-xl border border-zinc-800 bg-black/20 p-2">
                <p class="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Decision</p>
                <p class="mt-1 text-zinc-200">
                  {{ status.decision?.reason ?? 'Waiting for complete GSI player data' }}
                </p>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="rounded-xl border border-zinc-800 bg-black/20 p-2">
                  <p class="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                    Next candidate
                  </p>
                  <p class="mt-1 font-semibold text-zinc-200">{{ candidate?.name ?? 'None' }}</p>
                </div>
                <div class="rounded-xl border border-zinc-800 bg-black/20 p-2">
                  <p class="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                    Camera lock
                  </p>
                  <p class="mt-1 font-semibold text-zinc-200">
                    {{ status.decision?.lockKind ?? 'none' }}
                  </p>
                  <p v-if="lockRemaining" class="text-[11px] text-zinc-500">
                    {{ (lockRemaining / 1000).toFixed(1) }}s remaining
                  </p>
                </div>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-2">
                <div class="rounded-xl border border-zinc-800 bg-black/20 p-2">
                  <p class="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                    Dominant scene
                  </p>
                  <p class="mt-1 truncate font-semibold text-zinc-200">
                    {{ status.decision?.dominantSceneKey ?? 'none' }}
                  </p>
                  <p class="text-[11px] text-zinc-500">
                    score {{ status.decision?.dominantSceneScore?.toFixed(1) ?? '0.0' }} ·
                    {{ status.decision?.dominantScenePhase ?? 'forming' }} ·
                    {{ Math.round((status.decision?.dominantSceneConfidence ?? 0) * 100) }}%
                    confidence
                  </p>
                </div>
                <div class="rounded-xl border border-zinc-800 bg-black/20 p-2">
                  <p class="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                    POV scene
                  </p>
                  <p class="mt-1 truncate font-semibold text-zinc-200">
                    {{ status.decision?.currentSceneKey ?? 'none' }}
                  </p>
                  <p class="text-[11px] text-zinc-500">
                    score {{ status.decision?.currentSceneScore?.toFixed(1) ?? '0.0' }} ·
                    {{ status.decision?.currentScenePhase ?? 'none' }} ·
                    {{ Math.round((status.decision?.currentSceneConfidence ?? 0) * 100) }}%
                    confidence
                  </p>
                </div>
              </div>
              <div class="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2">
                <p class="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  Threat POV
                </p>
                <p class="mt-1 font-semibold text-zinc-200">
                  {{
                    current?.threatSceneExternal
                      ? 'External view into dominant scene'
                      : current?.threatSceneKey
                        ? 'Dominant-scene participant view'
                        : 'No dominant threat view'
                  }}
                </p>
                <p class="text-[11px] text-zinc-500">
                  {{ current?.threatSceneEnemiesInViewCone ?? 0 }} /
                  {{ current?.threatSceneTargetCount ?? 0 }} targets in cone ·
                  {{ Math.round((current?.threatSceneCoverage ?? 0) * 100) }}% direction ·
                  {{ current?.threatSceneVisibleCount ?? 0 }} visible +
                  {{ current?.threatScenePeekCount ?? 0 }} peekable ·
                  {{ Math.round((current?.threatSceneActionableCoverage ?? 0) * 100) }}% actionable
                  · entry {{ Math.round((current?.routeEntryRelevance ?? 0) * 100) }}% · incoming
                  {{ Math.round((current?.incomingGroupPressure ?? 0) * 100) }}%
                </p>
                <p class="mt-1 text-[11px] text-zinc-600">
                  {{ current?.topologyPlantSite ?? 'route' }} ·
                  {{ current?.topologyCallout ?? 'unknown area' }} ·
                  {{ current?.topologyRoutePortalChokepoint ? 'chokepoint' : 'portal' }}
                  {{ current?.topologyRoutePortalId ?? 'none' }} · control
                  {{ Math.round((current?.topologyPortalControlScore ?? 0) * 100) }}% ·
                  {{
                    current?.topologyPredictedFightMs !== null &&
                    current?.topologyPredictedFightMs !== undefined
                      ? `fight ~${Math.round(current.topologyPredictedFightMs)} ms`
                      : 'fight timing unknown'
                  }}
                </p>
              </div>
            </div>

            <button
              v-if="status.settings.manualOverrideSteamId"
              @click="forcePlayer(null)"
              class="mt-4 w-full rounded-lg border border-amber-500/30 bg-amber-500/10 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/15"
            >
              Release manual override
            </button>
          </section>

          <section class="min-h-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
            <h2 class="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
              Camera Transport
            </h2>
            <div class="mb-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-2">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold text-zinc-200">Advisory inputs</p>
                  <p class="mt-1 text-[10px] text-zinc-500">
                    Ranking advice only. Dwell, locks, hysteresis and Telnet safety rules remain in
                    control.
                  </p>
                </div>
                <span
                  :class="status.ml.modelLoaded ? 'text-emerald-300' : 'text-amber-300'"
                  class="text-[9px] font-bold uppercase"
                >
                  {{ status.ml.modelLoaded ? 'loaded' : 'fallback' }}
                </span>
              </div>
              <label class="mt-3 flex items-center gap-2 text-[10px] text-zinc-400">
                <input
                  type="checkbox"
                  :checked="status.settings.rulesEnabled"
                  @change="
                    updateSettings({
                      rulesEnabled: ($event.target as HTMLInputElement).checked
                    })
                  "
                  class="accent-amber-400"
                />
                Enable Rules scoring
              </label>
              <label class="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
                <input
                  type="checkbox"
                  :checked="status.settings.sceneAdvisoryEnabled"
                  @change="
                    updateSettings({
                      sceneAdvisoryEnabled: ($event.target as HTMLInputElement).checked
                    })
                  "
                  class="accent-emerald-400"
                />
                Enable Scene intelligence
              </label>
              <label class="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
                <input
                  type="checkbox"
                  :checked="status.settings.geometryAdvisoryEnabled"
                  :disabled="status.ml.geometry.state !== 'loaded'"
                  @change="
                    updateSettings({
                      geometryAdvisoryEnabled: ($event.target as HTMLInputElement).checked
                    })
                  "
                  class="accent-cyan-400"
                />
                Enable Geometry LOS advisory
              </label>
              <label class="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
                <input
                  type="checkbox"
                  :checked="status.settings.mlAdvisoryEnabled"
                  :disabled="!status.ml.modelLoaded"
                  @change="
                    updateSettings({
                      mlAdvisoryEnabled: ($event.target as HTMLInputElement).checked
                    })
                  "
                  class="accent-violet-400"
                />
                Enable ML advisory ranking
              </label>
              <label class="mt-2 flex items-start gap-2 text-[10px] text-zinc-400">
                <input
                  type="checkbox"
                  :checked="status.settings.aerialPresentationEnabled"
                  :disabled="
                    status.aerial.state !== 'loaded' || status.ml.geometry.state !== 'loaded'
                  "
                  @change="
                    updateSettings({
                      aerialPresentationEnabled: ($event.target as HTMLInputElement).checked
                    })
                  "
                  class="mt-0.5 accent-sky-400"
                />
                <span>
                  <span class="block font-semibold text-sky-300"
                    >Enable calibrated Aerial presentation</span
                  >
                  <span class="mt-0.5 block text-[10px] text-zinc-500">
                    Uses validated map anchors only in presentation-safe windows. First-person
                    locks, action switches and manual control always win.
                  </span>
                </span>
              </label>
              <div class="mt-2 grid gap-2 sm:grid-cols-3">
                <label
                  v-for="phase in [
                    ['freezeTime', 'Freeze-time', 'Always show T + CT spawns'],
                    ['midRound', 'Mid-round', 'Only calm, action-safe windows'],
                    ['roundEnd', 'Round end', 'Post-round establishing shot']
                  ] as const"
                  :key="phase[0]"
                  class="flex items-start gap-2 rounded border border-sky-500/15 bg-sky-500/[0.03] p-2 text-[10px] text-zinc-400"
                >
                  <input
                    type="checkbox"
                    :checked="status.settings.aerialPresentationPhases[phase[0]]"
                    :disabled="!status.settings.aerialPresentationEnabled"
                    @change="
                      setAerialPhase(
                        phase[0],
                        ($event.target as HTMLInputElement).checked
                      )
                    "
                    class="mt-0.5 accent-sky-400"
                  />
                  <span>
                    <span class="block font-semibold text-sky-200">{{ phase[1] }}</span>
                    <span class="mt-0.5 block text-[9px] text-zinc-600">{{ phase[2] }}</span>
                  </span>
                </label>
              </div>
              <p class="mt-2 text-[10px] text-zinc-600">
                {{ status.ml.modelMessage }} · {{ status.ml.geometry.message }}
              </p>
              <div class="mt-2 rounded border border-sky-500/15 bg-sky-500/[0.03] p-2 text-[10px]">
                <p class="font-semibold text-sky-200">
                  Aerial {{ status.aerial.state }} · {{ status.aerial.anchorCount }} anchors
                  <span v-if="status.aerial.mapName">· {{ status.aerial.mapName }}</span>
                </p>
                <p class="mt-1 text-zinc-500">{{ status.aerial.message }}</p>
                <p class="mt-1 text-zinc-400">{{ status.aerial.reason }}</p>
                <p v-if="status.aerial.activeAnchorLabel" class="mt-1 text-sky-300">
                  LIVE: {{ status.aerial.activeAnchorLabel }} · visible
                  {{ status.aerial.visibleSteamIds.length }} players
                </p>
              </div>
            </div>
            <div class="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
              <p class="text-xs font-semibold text-zinc-200">Telnet</p>
              <p class="mt-1 text-[10px] text-zinc-500">
                Always attempted first. Host and port are configured once in global Settings.
              </p>
            </div>
            <label
              class="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-zinc-400"
            >
              <input
                type="checkbox"
                :checked="status.settings.autoFallback"
                @change="
                  updateSettings({ autoFallback: ($event.target as HTMLInputElement).checked })
                "
                class="mt-0.5 accent-amber-400"
              />
              <span>
                <span class="block font-semibold text-amber-300">Enable Windows key fallback</span>
                <span class="mt-0.5 block text-[10px] text-zinc-500">
                  Advanced opt-in. Sends observer number keys and may bring CS2 to the foreground.
                </span>
              </span>
            </label>
            <div class="mt-4 grid grid-cols-2 gap-2">
              <div
                v-for="transport in ['telnet', 'keyboard'] as const"
                :key="transport"
                :class="healthClass(status.transportHealth[transport].state)"
                class="rounded-lg border p-3"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[10px] font-bold uppercase tracking-wider">{{
                    transport
                  }}</span>
                  <span class="text-[9px] font-bold uppercase">{{
                    status.transportHealth[transport].state
                  }}</span>
                </div>
                <p class="mt-1 line-clamp-2 text-[10px] opacity-70">
                  {{ status.transportHealth[transport].message }}
                </p>
              </div>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-2">
              <button
                @click="testTransport('telnet')"
                :disabled="saving"
                class="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
              >
                Test Telnet
              </button>
              <button
                @click="testTransport('keyboard', candidate?.observerSlot ?? 1)"
                :disabled="saving || status.transportHealth.keyboard.state === 'unsupported'"
                class="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
              >
                Test Keys
              </button>
            </div>
            <div
              v-if="status.lastCommand"
              :class="
                status.lastCommand.ok
                  ? 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5'
                  : 'text-red-300 border-red-500/20 bg-red-500/5'
              "
              class="mt-3 rounded-lg border p-3 text-xs"
            >
              <span class="font-bold uppercase">{{ status.lastCommand.transport }}</span
              >: {{ status.lastCommand.message }}
            </div>
          </section>

          <section class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
            <div class="mb-2 flex items-center justify-between">
              <div>
                <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                  Scoring Weights
                </h2>
                <p class="mt-1 text-xs text-zinc-600">Profile defaults plus local overrides</p>
              </div>
              <button @click="resetWeights" class="text-xs text-zinc-500 hover:text-cyan-300">
                Reset mode defaults
              </button>
            </div>
            <div class="auto-director-weight-list grid gap-2">
              <label v-for="[key, label] in weightDefinitions" :key="key" class="block">
                <span class="flex justify-between text-[11px] text-zinc-500"
                  ><span>{{ label }}</span
                  ><strong class="text-zinc-300">{{ effectiveWeight(key) }}</strong></span
                >
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  :value="effectiveWeight(key)"
                  @change="setWeight(key, Number(($event.target as HTMLInputElement).value))"
                  class="mt-1 w-full accent-cyan-400"
                />
              </label>
            </div>
          </section>
        </aside>

        <main class="auto-director-main min-h-0 min-w-0 grid grid-rows-[minmax(0,1fr)_150px] gap-3 overflow-hidden">
          <section class="auto-director-player-board min-h-0 flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400">
                  Player Priority Board
                </h2>
                <p class="mt-1 text-xs text-zinc-600">
                  Scores are explainable and recalculated from every GSI state update.
                </p>
              </div>
              <span class="text-xs text-zinc-500"
                >{{ players.filter((player) => player.alive).length }} alive ·
                {{ players.length }} tracked</span
              >
            </div>

            <div
              v-if="!players.length"
              class="rounded-xl border border-dashed border-zinc-800 py-16 text-center text-sm text-zinc-600"
            >
              Start CS2 or replay a GSI fixture to populate the board.
            </div>
            <div v-else class="auto-director-player-list grid min-h-0 min-w-0 grid-cols-1 gap-2 overflow-y-auto pr-1">
              <article
                v-for="(player, index) in players"
                :key="player.steamId"
                :class="[
                  player.steamId === status.decision?.currentSteamId
                    ? 'border-cyan-400/60 bg-cyan-400/[0.06]'
                    : 'border-zinc-800 bg-black/20',
                  !player.alive ? 'opacity-45' : ''
                ]"
                class="auto-director-player-card rounded-xl border p-2 transition-colors"
              >
                <div
                  class="auto-director-player-row grid items-center gap-3"
                >
                  <div
                    class="grid size-7 place-items-center rounded-lg bg-zinc-800 text-xs font-bold text-zinc-400"
                  >
                    {{ index + 1 }}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <p class="truncate font-bold text-zinc-100">{{ player.name }}</p>
                      <span
                        :class="
                          player.team === 'CT'
                            ? 'border-blue-500/30 text-blue-400'
                            : 'border-amber-500/30 text-amber-400'
                        "
                        class="rounded border px-1.5 py-0.5 text-[10px] font-bold"
                        >{{ player.team }}</span
                      >
                    </div>
                    <p class="mt-1 truncate font-mono text-[10px] text-zinc-600">
                      {{ player.steamId }} · SLOT {{ slotLabel(player.observerSlot) }}
                      <span v-if="player.nearestEnemyDistance !== null"
                        >· {{ player.nearestEnemyDistance }}u MAP DISTANCE
                        <span v-if="player.nearestEnemyHasLineOfSight"> · LOS</span>
                        <span v-else-if="player.nearestEnemyHasPeekPotential"> · PEEK</span>
                        <span v-else> · OCCLUDED</span></span
                      >
                      <span v-if="player.threatSceneTargetCount"
                        >· THREAT {{ player.threatSceneVisibleCount ?? 0 }} visible +
                        {{ player.threatScenePeekCount ?? 0 }} peekable /
                        {{ player.threatSceneTargetCount }}</span
                      >
                    </p>
                  </div>
                  <div>
                    <div class="flex items-baseline justify-between">
                      <span class="text-[10px] uppercase tracking-wider text-zinc-600">Score</span
                      ><span class="text-xl font-black text-cyan-300">{{
                        player.total.toFixed(1)
                      }}</span>
                    </div>
                    <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        class="h-full rounded-full bg-cyan-400 transition-all"
                        :style="{ width: scoreWidth(player.total) }"
                      ></div>
                    </div>
                  </div>
                  <div class="flex min-w-0 flex-wrap gap-1.5">
                    <span
                      v-for="factor in player.factors.slice(0, 6)"
                      :key="factor.key"
                      :title="factor.detail"
                      :class="
                        factor.value >= 0
                          ? 'border-zinc-700 bg-zinc-800/80 text-zinc-300'
                          : 'border-red-500/20 bg-red-500/5 text-red-300'
                      "
                      class="rounded-md border px-2 py-1 text-[10px]"
                    >
                      {{ factor.label }}
                      <strong :class="factor.value >= 0 ? 'text-cyan-300' : 'text-red-300'"
                        >{{ factor.value > 0 ? '+' : '' }}{{ factor.value }}</strong
                      >
                    </span>
                  </div>
                  <button
                    @click="
                      forcePlayer(
                        status.settings.manualOverrideSteamId === player.steamId
                          ? null
                          : player.steamId
                      )
                    "
                    :disabled="!player.alive || saving"
                    :class="
                      status.settings.manualOverrideSteamId === player.steamId
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                    "
                    class="rounded-lg border px-2 py-1.5 text-[10px] font-semibold disabled:opacity-30"
                  >
                    {{
                      status.settings.manualOverrideSteamId === player.steamId
                        ? 'Release'
                        : 'Force POV'
                    }}
                  </button>
                </div>
              </article>
            </div>
          </section>

          <section class="auto-director-bottom min-h-0 overflow-hidden">
            <div class="min-h-0 h-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
              <h2 class="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                Decision History
              </h2>
              <div class="auto-director-history h-full space-y-1 overflow-hidden pr-1">
                <div v-if="!status.history.length" class="py-12 text-center text-xs text-zinc-600">
                  No camera decisions yet.
                </div>
                <div
                  v-for="entry in status.history.slice(0, 50)"
                  :key="`${entry.at}-${entry.message}`"
                  class="flex gap-2 rounded-lg border border-zinc-800 bg-black/20 p-2 text-[10px]"
                >
                  <span class="shrink-0 font-mono text-zinc-600">{{ formatTime(entry.at) }}</span>
                  <div class="min-w-0">
                    <p
                      :class="
                        entry.type === 'transport-error'
                          ? 'text-red-300'
                          : entry.type === 'switch'
                            ? 'text-cyan-300'
                            : 'text-zinc-300'
                      "
                    >
                      {{ entry.message }}
                    </p>
                    <p v-if="entry.transport" class="mt-0.5 uppercase tracking-wider text-zinc-600">
                      {{ entry.transport }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.auto-director-control-strip > div:first-child {
  min-width: 0;
}

.auto-director-control-strip button {
  min-width: 0;
}

.auto-director-control-strip button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Compact mode is preserved for a tall/fullscreen viewport. A short window
   must remain a normal scrollable document instead of clipping diagnostics. */
@media (min-width: 1800px) and (min-height: 900px) {
  .auto-director-settings {
    min-height: 0;
  }

  .auto-director-player-board {
    min-width: 0;
  }

  .auto-director-player-list {
    flex: 1 1 auto;
    align-content: start;
    min-height: 0;
    overflow-y: auto;
  }

  .auto-director-player-card {
    min-width: 0;
  }

  .auto-director-player-row {
    grid-template-columns: 34px minmax(180px, 0.85fr) 130px minmax(220px, 1.5fr) auto;
  }

  .auto-director-history {
    height: auto;
    max-height: none;
    overflow-y: auto;
  }
}

@media (max-width: 1799px), (max-height: 899px) {
  .auto-director-page {
    display: block !important;
    height: auto !important;
    min-height: 100% !important;
    overflow-y: auto !important;
  }

  .auto-director-control-strip > div:first-child {
    min-width: 0;
  }

  .auto-director-control-strip button {
    min-width: 0;
  }

  .auto-director-control-strip button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .auto-director-control-strip {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .auto-director-control-strip > div:last-child {
    justify-content: flex-start;
  }

  .auto-director-layout {
    display: grid !important;
    flex: none !important;
    grid-template-columns: minmax(0, 1fr) !important;
    min-height: auto !important;
  }

  .auto-director-layout > aside {
    display: block !important;
    min-height: auto !important;
  }

  .auto-director-layout > aside > section,
  .auto-director-main > section {
    min-height: auto !important;
    overflow: visible !important;
  }

  .auto-director-main {
    display: block !important;
    min-height: auto !important;
    overflow: visible !important;
  }

  .auto-director-player-list {
    display: block !important;
    min-height: auto !important;
    overflow: visible !important;
  }

  .auto-director-bottom {
    min-height: auto !important;
    overflow: visible !important;
  }

  .auto-director-bottom > div {
    min-height: auto !important;
    overflow: visible !important;
  }

  .auto-director-history {
    height: auto !important;
    max-height: 18rem;
    overflow-y: auto !important;
  }
}
</style>
