import type { AutoDirectorSettings } from './autoDirector.types'

export type AutoDirectorSettingsWriter = (settings: AutoDirectorSettings) => Promise<void>

export const persistSettingsCandidate = async (
  current: AutoDirectorSettings,
  update: Partial<AutoDirectorSettings>,
  write: AutoDirectorSettingsWriter
): Promise<AutoDirectorSettings> => {
  const candidate = { ...current, ...update }
  await write({ ...candidate, manualOverrideSteamId: null })
  return candidate
}
