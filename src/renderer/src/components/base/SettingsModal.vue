<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSettings } from '../../features/settings/composables/useSettings'
import BaseButton from './BaseButton.vue'
import BaseCheckbox from './BaseCheckbox.vue'
import SpectatorTelnetSettings from '../../features/spectator/components/SpectatorTelnetSettings.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const {
  settings,
  matStatus,
  error,
  isLoading,
  isSaving,
  isTesting,
  fetchSettings,
  saveSettings,
  saveMatSettings,
  testMatConnection,
  refreshMat
} = useSettings()

const matEnabled = ref(false)
const matUrl = ref('')
const matToken = ref('')
const matPollIntervalSeconds = ref(5)
const telnetHost = ref('127.0.0.1')
const telnetPort = ref(2020)
const telnetTesting = ref(false)
const telnetTestResult = ref<{ ok: boolean; message: string } | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await fetchSettings()
    matEnabled.value = settings.value.matEnabled
    matUrl.value = settings.value.matUrl
    matPollIntervalSeconds.value = settings.value.matPollIntervalSeconds
    matToken.value = ''
    telnetHost.value = settings.value.telnetHost
    telnetPort.value = settings.value.telnetPort
  }
)

const persistAutoSwitch = () => saveSettings({ autoSwitchSides: settings.value.autoSwitchSides })
const persistAutoRefresh = () => saveSettings({ autoRefreshHuds: settings.value.autoRefreshHuds })
const persistSidePlayerMetadata = () =>
  saveSettings({ showSidePlayerMetadata: settings.value.showSidePlayerMetadata })

const saveTelnet = async () => {
  const saved = await saveSettings({ telnetHost: telnetHost.value, telnetPort: telnetPort.value })
  telnetHost.value = settings.value.telnetHost
  telnetPort.value = settings.value.telnetPort
  return saved
}

const testTelnet = async () => {
  telnetTesting.value = true
  telnetTestResult.value = null
  try {
    if (!(await saveTelnet())) {
      throw new Error(error.value || 'Could not save the Telnet settings')
    }
    await window.electron.ipcRenderer.invoke('send-telnet', {
      command: 'echo JtsHudManager_ping'
    })
    telnetTestResult.value = { ok: true, message: 'Connected to CS2 Telnet.' }
  } catch (err) {
    telnetTestResult.value = {
      ok: false,
      message: err instanceof Error ? err.message : 'Connection failed'
    }
  } finally {
    telnetTesting.value = false
  }
}

const saveMat = async () => {
  const saved = await saveMatSettings({
    enabled: matEnabled.value,
    url: matUrl.value,
    token: matToken.value || undefined,
    pollIntervalSeconds: matPollIntervalSeconds.value
  })
  if (saved) matToken.value = ''
}

const testMat = async () => {
  await testMatConnection({ url: matUrl.value, token: matToken.value || undefined })
}

// --- GSI Config Installation ---
const steamPath = ref('C:\\Program Files (x86)\\Steam')
const gsiStatus = ref<{ ok: boolean; message: string } | null>(null)
const isInstallingGsi = ref(false)

const browseSteamFolder = async () => {
  const selected = await window.electron.ipcRenderer.invoke('select-folder', steamPath.value)
  if (selected) {
    steamPath.value = selected
    gsiStatus.value = null
  }
}

const installGsiCfg = async () => {
  isInstallingGsi.value = true
  gsiStatus.value = null
  try {
    gsiStatus.value = await window.electron.ipcRenderer.invoke('install-gsi-cfg', steamPath.value)
  } finally {
    isInstallingGsi.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-start"
        @click.self="emit('close')"
      >
        <div class="absolute inset-0 bg-black/50" @click="emit('close')" />

        <div
          class="relative z-10 ml-4 mb-16 w-[30rem] max-h-[85vh] overflow-y-auto bg-surface border border-zinc-700 rounded-xl shadow-2xl p-5 flex flex-col gap-5"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-text-main font-bold text-base">Settings</h2>
            <BaseButton @click="emit('close')" variant="ghost" size="sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </BaseButton>
          </div>

          <div v-if="isLoading" class="text-zinc-400 text-sm text-center py-4">Loading…</div>

          <template v-else>
            <div>
              <p class="mb-1 text-xs font-semibold capitalize text-zinc-500">
                Global CS2 Telnet Connection
              </p>
              <p class="mb-3 text-xs text-zinc-500">
                Shared by Spectator Binds, Auto Director, and all other CS2 console controls.
              </p>
              <SpectatorTelnetSettings
                v-model:host="telnetHost"
                v-model:port="telnetPort"
                :testing="telnetTesting"
                :test-result="telnetTestResult"
                :saving="isSaving"
                @test="testTelnet"
                @save="saveTelnet"
              />
            </div>

            <div class="border-t border-border pt-4">
              <div>
                <p class="text-xs font-semibold capitalize text-zinc-500 mb-3">Match Automation</p>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-zinc-200">Auto Switch Sides</p>
                    <p class="text-xs text-zinc-500 mt-0.5">
                      Automatically flip team sides at halftime in standalone mode
                    </p>
                  </div>
                  <BaseCheckbox
                    v-model="settings.autoSwitchSides"
                    :disabled="isSaving"
                    size="md"
                    class="text-primary"
                    @update:model-value="persistAutoSwitch"
                  />
                </div>
              </div>
              <div class="flex items-center justify-between mt-4">
                <div>
                  <p class="text-sm font-medium text-zinc-200">Auto Refresh HUDs</p>
                  <p class="text-xs text-zinc-500 mt-0.5">
                    Reload HUDs automatically after player, team, or match data is saved
                  </p>
                </div>
                <BaseCheckbox
                  v-model="settings.autoRefreshHuds"
                  :disabled="isSaving"
                  size="md"
                  class="text-primary"
                  @update:model-value="persistAutoRefresh"
                />
              </div>
              <div class="flex items-center justify-between mt-4">
                <div>
                  <p class="text-sm font-medium text-zinc-200">Show player details on side cards</p>
                  <p class="text-xs text-zinc-500 mt-0.5">
                    Show first name, last name, and country flag in the side player cards
                  </p>
                </div>
                <BaseCheckbox
                  v-model="settings.showSidePlayerMetadata"
                  :disabled="isSaving"
                  size="md"
                  class="text-primary"
                  @update:model-value="persistSidePlayerMetadata"
                />
              </div>
            </div>

            <div class="border-t border-border pt-4 flex flex-col gap-3">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs font-semibold capitalize text-zinc-500">BebraLand MAT</p>
                  <p class="text-xs text-zinc-500 mt-1">
                    Optional read-only tournament source. GSI remains the live telemetry source.
                  </p>
                </div>
                <BaseCheckbox v-model="matEnabled" size="md" class="text-primary" />
              </div>

              <div
                v-if="matStatus"
                class="text-xs rounded-lg px-3 py-2 border"
                :class="{
                  'bg-emerald-900/30 text-emerald-300 border-emerald-800/50':
                    matStatus.state === 'connected',
                  'bg-amber-900/30 text-amber-300 border-amber-800/50':
                    matStatus.state === 'connecting' || matStatus.state === 'stale',
                  'bg-red-900/30 text-red-300 border-red-800/50': matStatus.state === 'error',
                  'bg-zinc-800 text-zinc-400 border-zinc-700': matStatus.state === 'disabled'
                }"
              >
                <span class="font-semibold uppercase">{{ matStatus.state }}</span>
                <span class="ml-2">{{ matStatus.message }}</span>
                <div v-if="matStatus.currentMatchSlug" class="mt-1 text-zinc-400">
                  Match: {{ matStatus.currentMatchSlug }}
                </div>
              </div>

              <label class="flex flex-col gap-1">
                <span class="text-xs text-zinc-400">MAT URL</span>
                <input
                  v-model="matUrl"
                  type="url"
                  placeholder="https://mat.example.com"
                  class="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                />
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs text-zinc-400">
                  Read-only HUD token
                  <span v-if="settings.matTokenConfigured" class="text-emerald-400"
                    >• saved securely</span
                  >
                </span>
                <input
                  v-model="matToken"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="
                    settings.matTokenConfigured ? 'Leave blank to keep saved token' : 'mat_hud_…'
                  "
                  class="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                />
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs text-zinc-400">Polling fallback, seconds</span>
                <input
                  v-model.number="matPollIntervalSeconds"
                  type="number"
                  min="2"
                  max="60"
                  class="w-28 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                />
              </label>

              <div class="flex gap-2">
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :disabled="isTesting || !matUrl"
                  @click="testMat"
                >
                  {{ isTesting ? 'Testing…' : 'Test Connection' }}
                </BaseButton>
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :disabled="!settings.matTokenConfigured || isSaving"
                  @click="refreshMat"
                >
                  Sync Now
                </BaseButton>
                <BaseButton variant="primary" size="sm" :disabled="isSaving" @click="saveMat">
                  {{ isSaving ? 'Saving…' : 'Save MAT Settings' }}
                </BaseButton>
              </div>

              <div
                v-if="error"
                class="text-xs rounded-lg px-3 py-2 bg-red-900/40 text-red-400 border border-red-800/50"
              >
                {{ error }}
              </div>
            </div>

            <div class="border-t border-border pt-4">
              <p class="text-xs font-semibold capitalize text-zinc-500 mb-3">CS2 Integration</p>

              <div class="flex flex-col gap-2">
                <p class="text-sm font-medium text-zinc-200">Install GSI Config</p>
                <p class="text-xs text-zinc-500">
                  Select your Steam root folder. The config file will be written to your CS2 cfg
                  directory.
                </p>

                <div class="flex gap-2 mt-1">
                  <input
                    v-model="steamPath"
                    type="text"
                    placeholder="C:\Program Files (x86)\Steam"
                    class="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                  />
                  <BaseButton @click="browseSteamFolder" variant="secondary" size="sm">
                    Browse
                  </BaseButton>
                </div>

                <BaseButton
                  @click="installGsiCfg"
                  :disabled="isInstallingGsi || !steamPath"
                  variant="primary"
                  class="flex-1 justify-center"
                >
                  {{ isInstallingGsi ? 'Installing…' : 'Install GSI Config' }}
                </BaseButton>

                <div
                  v-if="gsiStatus"
                  class="text-xs rounded-lg px-3 py-2 whitespace-pre-wrap"
                  :class="
                    gsiStatus.ok
                      ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/50'
                      : 'bg-red-900/40 text-red-400 border border-red-800/50'
                  "
                >
                  {{ gsiStatus.message }}
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
