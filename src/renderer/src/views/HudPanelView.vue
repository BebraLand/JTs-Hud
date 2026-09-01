<script setup lang="ts">
import { useHudPanelView } from '../features/huds/composables/useHudPanelView';
import HudPanelHeader from '../features/huds/components/HudPanelHeader.vue';
import HudPanelTabBar from '../features/huds/components/HudPanelTabBar.vue';
import HudPanelSection from '../features/huds/components/HudPanelSection.vue';
import BaseButton from '../components/base/BaseButton.vue';

const {
  hudId,
  teams,
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
  toggleDebugMapEnd,
  livePlayerSteamIds,
  showOnlyActivePlayers,
  playersForSection,
  saveSectionConfig,
  fireAction,
  uploadImage,
  clearImage,
  uploadImageToList,
  removeImageFromList,
} = useHudPanelView();
</script>

<template>
  <div class="flex flex-col h-full bg-surface text-zinc-200">
    <HudPanelHeader :hud-id="hudId" />

    <HudPanelTabBar
      v-if="panel.length > 0"
      :sections="panel"
      v-model:active-tab="activeTab"
    />

    <div class="flex-1 overflow-y-auto p-6">
      <div v-if="panel.length === 0" class="flex items-center justify-center h-full text-zinc-600 text-sm">
        No panel.json found for this HUD.
      </div>

      <div v-else-if="activeSection.name && config[activeSection.name]" class="max-w-3xl mx-auto">
        <div
          v-if="developerTestingEnabled && hudId === 'bebraland'"
          class="mb-4 rounded-xl border border-amber-800/60 bg-amber-950/20 p-4"
        >
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-semibold text-amber-200">Developer preview</p>
              <p class="mt-1 text-xs text-amber-300/70">
                Temporary only — does not change HUD settings or match data.
              </p>
            </div>
            <BaseButton
              variant="secondary"
              :disabled="debugMapEndBusy"
              @click="toggleDebugMapEnd"
            >
              {{ debugMapEndBusy ? 'Working…' : debugMapEndActive ? 'Hide preview' : 'Simulate map-end' }}
            </BaseButton>
          </div>
        </div>
        <HudPanelSection
          :section="activeSection"
          :section-config="config[activeSection.name]"
          :teams="teams"
          :players="playersForSection(activeSection.name)"
          :matches="matches"
          :show-only-active-players="showOnlyActivePlayers[activeSection.name] ?? false"
          :live-data-available="livePlayerSteamIds.size > 0"
          :status="sectionStatus[activeSection.name]"
          :mat-enabled="matEnabled"
          @save="saveSectionConfig(activeSection.name)"
          @fire-action="(name, val) => fireAction(name, val)"
          @upload-image="(inputName, file) => uploadImage(activeSection.name, inputName, file)"
          @clear-image="(inputName) => clearImage(activeSection.name, inputName)"
          @upload-image-to-list="(inputName, file) => uploadImageToList(activeSection.name, inputName, file)"
          @remove-image-from-list="(inputName, url) => removeImageFromList(activeSection.name, inputName, url)"
          @toggle-active-players="showOnlyActivePlayers[activeSection.name] = !showOnlyActivePlayers[activeSection.name]"
        />
      </div>
    </div>
  </div>
</template>
