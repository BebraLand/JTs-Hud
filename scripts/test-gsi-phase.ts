import assert from 'node:assert/strict'
import { getHudPhase } from '../src/main/server/integrations/gsiPhase'

assert.equal(getHudPhase({ map: { phase: 'warmup' } } as never).warmup, true)
assert.equal(getHudPhase({ map: { phase: 'live' }, phase_countdowns: { phase: 'warmup' } } as never).warmup, true)
assert.equal(getHudPhase({ map: { phase: 'live' }, phase_countdowns: { phase: 'freezetime' } } as never).warmup, false)
console.log('GSI warmup phase checks passed')
