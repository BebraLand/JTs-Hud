<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { API_URL } from '../index'

defineProps<{ collapsed: boolean }>()

type SystemStats = {
  cpuPercent: number
  rssMb: number
  heapUsedMb: number
  heapTotalMb: number
  logicalCores: number
}

const stats = ref<SystemStats | null>(null)
const online = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const refresh = async () => {
  try {
    const response = await fetch(`${API_URL}/system/stats`)
    if (!response.ok) throw new Error('stats unavailable')
    stats.value = (await response.json()) as SystemStats
    online.value = true
  } catch {
    online.value = false
  }
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div v-if="!collapsed" class="mx-3 mb-2 rounded-xl border border-border bg-black/10 px-3 py-2">
    <div class="mb-1.5 flex items-center justify-between gap-2">
      <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500"
        >JTs-Hud load</span
      >
      <span
        :class="online ? 'text-emerald-400' : 'text-zinc-600'"
        class="text-[9px] font-semibold uppercase"
        >{{ online ? 'LIVE' : '—' }}</span
      >
    </div>
    <div v-if="stats" class="space-y-1 text-[10px] text-zinc-400">
      <div class="flex items-center justify-between">
        <span>CPU</span
        ><span class="font-mono text-zinc-200">{{ stats.cpuPercent.toFixed(1) }}%</span>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          class="h-full rounded-full bg-cyan-400 transition-[width]"
          :style="{ width: `${Math.max(2, stats.cpuPercent)}%` }"
        />
      </div>
      <div class="flex items-center justify-between">
        <span>RAM</span><span class="font-mono text-zinc-200">{{ stats.rssMb.toFixed(1) }} MB</span>
      </div>
      <div class="flex items-center justify-between">
        <span>Heap</span
        ><span class="font-mono text-zinc-200"
          >{{ stats.heapUsedMb.toFixed(1) }} / {{ stats.heapTotalMb.toFixed(1) }} MB</span
        >
      </div>
      <div class="flex items-center justify-between">
        <span>Logical cores</span><span class="font-mono text-zinc-200">{{ stats.logicalCores }}</span>
      </div>
    </div>
    <div v-else class="text-[10px] text-zinc-600">Reading process metrics…</div>
  </div>
  <div
    v-else
    class="mx-2 mb-2 rounded-lg border border-border py-2 text-center text-[9px] font-bold uppercase tracking-wider text-zinc-600"
    :title="
      stats
        ? `CPU ${stats.cpuPercent.toFixed(1)}% · RAM ${stats.rssMb.toFixed(1)} MB`
        : 'Reading process metrics'
    "
  >
    {{ stats ? `${stats.cpuPercent.toFixed(0)}%` : '—' }}
  </div>
</template>
