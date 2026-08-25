import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from './autoDirector.config'
import type { AutoDirectorSettings } from './autoDirector.types'

export type AutoDirectorSettingsWriter = (settings: AutoDirectorSettings) => Promise<void>

export const sanitizeAerialPresentationPhases = (
  input: Partial<AutoDirectorSettings['aerialPresentationPhases']> | undefined,
  current = DEFAULT_AUTO_DIRECTOR_SETTINGS.aerialPresentationPhases
): AutoDirectorSettings['aerialPresentationPhases'] => ({
  ...current,
  ...(typeof input?.freezeTime === 'boolean' ? { freezeTime: input.freezeTime } : {}),
  ...(typeof input?.midRound === 'boolean' ? { midRound: input.midRound } : {}),
  ...(typeof input?.roundEnd === 'boolean' ? { roundEnd: input.roundEnd } : {})
})

export const persistSettingsCandidate = async (
  current: AutoDirectorSettings,
  update: Partial<AutoDirectorSettings>,
  write: AutoDirectorSettingsWriter
): Promise<AutoDirectorSettings> => {
  const candidate = { ...current, ...update }
  await write({ ...candidate, manualOverrideSteamId: null })
  return candidate
}
