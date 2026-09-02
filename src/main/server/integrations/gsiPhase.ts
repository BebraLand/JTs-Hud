import type { CSGORaw } from 'csgogsi'

export type HudPhase = { warmup: boolean }

export const getHudPhase = (state: Pick<CSGORaw, 'map' | 'phase_countdowns'>): HudPhase => {
  const mapPhase = String(state.map?.phase ?? '').toLowerCase()
  const countdownPhase = String(state.phase_countdowns?.phase ?? '').toLowerCase()
  return { warmup: mapPhase === 'warmup' || countdownPhase === 'warmup' }
}
