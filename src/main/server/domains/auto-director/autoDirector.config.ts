import type {
  AutoDirectorMode,
  AutoDirectorProfile,
  AutoDirectorSettings
} from './autoDirector.types'

export const AUTO_DIRECTOR_PROFILES: Record<AutoDirectorMode, AutoDirectorProfile> = {
  balanced: {
    mode: 'balanced',
    minDwellMs: 2400,
    switchMargin: 12,
    combatSoftLockMs: 800,
    postKillHoldMs: 700,
    weights: {
      base: 5,
      objective: 72,
      combat: 26,
      damage: 16,
      recentKill: 20,
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
      portalControl: 6,
      fightPrediction: 8,
      crossfire: 5
    }
  },
  reactive: {
    mode: 'reactive',
    minDwellMs: 1500,
    switchMargin: 8,
    combatSoftLockMs: 550,
    postKillHoldMs: 450,
    weights: {
      base: 4,
      objective: 76,
      combat: 34,
      damage: 22,
      recentKill: 24,
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
      portalControl: 5,
      fightPrediction: 10,
      crossfire: 4
    }
  },
  calm: {
    mode: 'calm',
    minDwellMs: 3400,
    switchMargin: 17,
    combatSoftLockMs: 950,
    postKillHoldMs: 850,
    weights: {
      base: 5,
      objective: 80,
      combat: 22,
      damage: 12,
      recentKill: 16,
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
      portalControl: 7,
      fightPrediction: 6,
      crossfire: 7
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
  storyPlannerEnabled: true,
  geometryAdvisoryEnabled: true,
  mlAdvisoryEnabled: true,
  aerialPresentationEnabled: false,
  aerialPresentationPhases: {
    freezeTime: true,
    midRound: true,
    roundEnd: true
  },
  minimumDwellOverrideMs: null,
  postDeathHoldMs: 1000,
  customPresets: [],
  scoringIntervalMs: 100,
  manualOverrideSteamId: null,
  customWeights: {}
}

export const getProfile = (settings: AutoDirectorSettings): AutoDirectorProfile => {
  const base = AUTO_DIRECTOR_PROFILES[settings.mode]
  return {
    ...base,
    minDwellMs: settings.minimumDwellOverrideMs ?? base.minDwellMs,
    weights: { ...base.weights, ...settings.customWeights }
  }
}
