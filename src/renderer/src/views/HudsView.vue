<script setup lang="ts">
import { useHudsView } from '../features/huds/composables/useHudsView';
import HudsPageHeader from '../features/huds/components/HudsPageHeader.vue';
import HudCard from '../features/huds/components/HudCard.vue';

const { huds, isLoading, fetchHuds, deleteHud, importing, importError, handleZipImport } = useHudsView();
</script>

<template>
  <div class="p-6 bg-surface text-zinc-200 min-h-screen">
    <HudsPageHeader
      :importing="importing"
      :import-error="importError"
      @import-file="handleZipImport"
      @refresh="fetchHuds"
    />

    <div class="bg-zinc-800 p-6 rounded-xl border border-zinc-700">
      <div v-if="isLoading" class="text-center py-12 text-zinc-400">Scanning for HUDs...</div>

      <div v-else-if="huds.length === 0" class="text-center py-12 flex flex-col items-center">
        <div class="text-zinc-400 mb-2">No HUDs found in the directory.</div>
        <div class="text-sm text-zinc-500">Extract a React HUD into the `huds/` folder to get started.</div>
      </div>

      <div v-else class="grid gap-4">
        <HudCard v-for="hud in huds" :key="hud.id" :hud="hud" @delete="deleteHud" />
      </div>
    </div>
  </div>
</template>
