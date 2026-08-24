import type {
  AutoDirectorMode,
  AutoDirectorProfile,
  AutoDirectorSettings
} from './autoDirector.types'

export const AUTO_DIRECTOR_PROFILES: Record<AutoDirectorMode, AutoDirectorProfile> = {
  balanced: {
    mode: 'balanced',
    minDwellMs: 2500,
    switchMargin: 14,
    combatSoftLockMs: 1400,
    postKillHoldMs: 1200,
    weights: {
      base: 5,
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
      weaponPressure: 14,
      bombCarrier: 10,
      lowHealthDrama: 8,
      continuity: 10,
      portalControl: 0,
      fightPrediction: 0,
      crossfire: 0
    }
  },
  reactive: {
    mode: 'reactive',
    minDwellMs: 1250,
    switchMargin: 7,
    combatSoftLockMs: 850,
    postKillHoldMs: 800,
    weights: {
      base: 4,
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
      weaponPressure: 15,
      bombCarrier: 8,
      lowHealthDrama: 7,
      continuity: 5,
      portalControl: 0,
      fightPrediction: 0,
      crossfire: 0
    }
  },
  calm: {
    mode: 'calm',
    minDwellMs: 4000,
    switchMargin: 22,
    combatSoftLockMs: 1900,
    postKillHoldMs: 1600,
    weights: {
      base: 5,
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
      weaponPressure: 12,
      bombCarrier: 14,
      lowHealthDrama: 10,
      continuity: 20,
      portalControl: 0,
      fightPrediction: 0,
      crossfire: 0
    }
  }
}

export const DEFAULT_AUTO_DIRECTOR_SETTINGS: AutoDirectorSettings = {
  enabled: false,
  paused: false,
  mode: 'balanced',
  autoFallback: false,
  rulesEnabled: true,
  sceneAdvisoryEnabled: true,
  geometryAdvisoryEnabled: true,
  mlAdvisoryEnabled: true,
  aerialPresentationEnabled: false,
  scoringIntervalMs: 100,
  manualOverrideSteamId: null,
  customWeights: {}
}

export const getProfile = (settings: AutoDirectorSettings): AutoDirectorProfile => {
  const base = AUTO_DIRECTOR_PROFILES[settings.mode]
  return {
    ...base,
    weights: { ...base.weights, ...settings.customWeights }
  }
}
