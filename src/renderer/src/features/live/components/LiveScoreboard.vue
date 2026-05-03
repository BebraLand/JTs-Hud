<script setup lang="ts">
const props = defineProps<{
  ctScore: number;
  tScore: number;
  mapName: string;
  phaseEndsIn: number | string | undefined;
  phase: string | undefined;
}>();

const formatTime = (seconds: number | string | undefined): string => {
  if (!seconds) return '0:00';
  const num = parseFloat(seconds as string);
  if (isNaN(num)) return '0:00';
  const mins = Math.floor(num / 60);
  const secs = Math.floor(num % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
</script>

<template>
  <div class="bg-zinc-800 px-6 py-3 rounded-xl border border-zinc-700 flex justify-between items-center shadow-lg">
    <div class="flex flex-col items-center">
      <span class="text-blue-400 font-bold text-sm tracking-widest uppercase mb-1">Counter-Terrorists</span>
      <span class="text-5xl font-black text-text-main">{{ ctScore }}</span>
    </div>

    <div class="flex flex-col items-center px-8 border-x border-zinc-700">
      <span class="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-1">Map: {{ mapName }}</span>
      <span class="text-4xl font-bold text-text-main tracking-tight">
        {{ formatTime(phaseEndsIn) }}
      </span>
      <span class="text-zinc-500 text-xs uppercase mt-1">{{ phase || 'Waiting' }} Phase</span>
    </div>

    <div class="flex flex-col items-center">
      <span class="text-yellow-400 font-bold text-sm tracking-widest uppercase mb-1">Terrorists</span>
      <span class="text-5xl font-black text-text-main">{{ tScore }}</span>
    </div>
  </div>
</template>
