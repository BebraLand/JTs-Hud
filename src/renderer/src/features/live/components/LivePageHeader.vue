<script setup lang="ts">
defineProps<{
  isConnected: boolean;
}>();
</script>

<template>
  <div class="flex justify-between items-center mb-6">
    <div>
      <h1 class="text-2xl font-bold text-text-main flex items-center gap-3">
        Live Game data
        <span
          v-if="isConnected"
          class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30"
        >Connected to GSI</span>
        <span
          v-else
          class="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full border border-red-500/30"
        >Disconnected</span>
      </h1>
      <p class="text-zinc-400 text-sm mt-1">View real-time game data and manage player information.</p>
    </div>
  </div>
</template>
