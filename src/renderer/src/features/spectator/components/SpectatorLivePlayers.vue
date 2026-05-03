<script setup lang="ts">
import BaseBadge from '@renderer/components/base/BaseBadge.vue';
import type { LivePlayer } from '../composables/useSpectator';
import BaseButton from '@renderer/components/base/BaseButton.vue';

defineProps<{
  gameState: any;
  livePlayers: LivePlayer[];
  ctPlayers: LivePlayer[];
  tPlayers: LivePlayer[];
}>();

defineEmits<{
  (e: 'quick-assign', name: string): void;
}>();
</script>

<template>
  <div>
    <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
      Live Players
      <BaseBadge v-if="livePlayers.length" variant="zinc">{{ livePlayers.length }}</BaseBadge>
    </h2>

    <div v-if="!gameState" class="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-center">
      <div class="text-zinc-600 text-sm">Waiting for CS2 data…</div>
      <div class="text-zinc-700 text-xs mt-1">Join a Demo or Live Server as a spectator.</div>
      <div class="text-zinc-700 text-xs mt-1">Verify GSI config installation  path if not working.</div>
    </div>

    <div v-else-if="livePlayers.length === 0" class="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-center">
      <div class="text-zinc-600 text-sm">No players in game.</div>
    </div>

    <div v-else class="flex gap-4">
      <!-- CT side -->
      <div v-if="ctPlayers.length" class="flex-1">
        <div class="text-xs font-bold uppercase tracking-widest text-blue-500 mb-1.5 px-1">CT</div>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="p in ctPlayers"
            :key="p.steamid"
            @click="$emit('quick-assign', p.name)"
            title="Quick-assign to first empty slot"
            class="flex items-center gap-2 bg-zinc-800 hover:bg-blue-900/30 border border-zinc-700 hover:border-blue-700/50 rounded-lg px-3 py-2 text-sm text-left transition-colors group"
          >
            <div class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></div>
            <span class="flex-1 truncate text-zinc-200 group-hover:text-blue-300">{{ p.name }}</span>
            <span class="text-xs shrink-0 font-mono">slot: {{ p.observerSlot === 0 ? '10' : p.observerSlot }}</span>
          </button>
        </div>
      </div>

      <!-- T side -->
      <div v-if="tPlayers.length" class="flex-1">
        <div class="text-xs font-bold uppercase tracking-widest text-yellow-500 mb-1.5 px-1">T</div>
        <div class="grid grid-cols-2 gap-1.5">
          <BaseButton
            v-for="p in tPlayers"
            :key="p.steamid"
            @click="$emit('quick-assign', p.name)"
            title="Quick-assign to first empty slot"
            class="flex items-center gap-2 bg-zinc-800 hover:bg-yellow-900/30 border border-zinc-700 hover:border-yellow-700/50 rounded-lg px-3 py-2 text-sm text-left transition-colors group"
          >
            <div class="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0"></div>
            <span class="flex-1 truncate text-zinc-200 group-hover:text-yellow-300">{{ p.name }}</span>
            <span class="text-xs shrink-0 font-mono">slot: {{ p.observerSlot === 0 ? '10' : p.observerSlot }}</span>
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
