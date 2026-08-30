import assert from 'node:assert/strict'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import {
  persistSettingsCandidate,
  sanitizeAerialPresentationPhases
} from '../src/main/server/domains/auto-director/autoDirector.settings'
import {
  DEFAULT_TELNET_SETTINGS,
  resolveTelnetSettings
} from '../src/main/server/domains/settings/telnetSettings'

const main = async (): Promise<void> => {
  assert.equal(DEFAULT_AUTO_DIRECTOR_SETTINGS.autoFallback, false)
  assert.deepEqual(DEFAULT_AUTO_DIRECTOR_SETTINGS.customPresets, [])
  assert.deepEqual(resolveTelnetSettings({}), DEFAULT_TELNET_SETTINGS)
  assert.deepEqual(resolveTelnetSettings({ telnetHost: '10.0.0.5', telnetPort: '31337' }), {
    host: '10.0.0.5',
    port: 31337
  })
  assert.deepEqual(resolveTelnetSettings({ telnetHost: ' ', telnetPort: '70000' }), {
    host: '127.0.0.1',
    port: 2020
  })

  const current = { ...DEFAULT_AUTO_DIRECTOR_SETTINGS, enabled: false }
  let persistedEnabled: boolean | null = null

  await assert.rejects(
    persistSettingsCandidate(current, { enabled: true }, async (candidate) => {
      persistedEnabled = candidate.enabled
      throw new Error('simulated SQLite write failure')
    }),
    /simulated SQLite write failure/
  )

  assert.equal(current.enabled, false)
  assert.equal(persistedEnabled, true)

  const committed = await persistSettingsCandidate(
    current,
    { enabled: true, manualOverrideSteamId: '76561198000000000' },
    async (candidate) => {
      assert.equal(candidate.enabled, true)
      assert.equal(candidate.manualOverrideSteamId, null)
    }
  )

  assert.equal(committed.enabled, true)
  assert.equal(committed.manualOverrideSteamId, '76561198000000000')
  assert.equal(current.enabled, false)

  const preset = {
    id: 'aggressive-entry',
    name: 'Aggressive Entry',
    mode: 'reactive' as const,
    weights: { combat: 80, entry: 70 },
    minimumDwellOverrideMs: 1500,
    postDeathHoldMs: 1000
  }
  let persistedPresets: unknown
  const presetSettings = await persistSettingsCandidate(
    current,
    { customPresets: [preset] },
    async (candidate) => {
      persistedPresets = candidate.customPresets
    }
  )
  assert.deepEqual(persistedPresets, [preset])
  assert.deepEqual(presetSettings.customPresets, [preset])

  assert.deepEqual(
    sanitizeAerialPresentationPhases(
      { freezeTime: false },
      { freezeTime: true, midRound: false, roundEnd: false }
    ),
    {
      freezeTime: false,
      midRound: false,
      roundEnd: false
    }
  )

  console.log('Auto-director settings fixture passed: persistence succeeds before runtime commit')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
