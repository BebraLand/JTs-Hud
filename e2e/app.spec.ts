import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import path from 'node:path'

const userDataRoot = path.join('/tmp', `jts-hud-auto-director-e2e-${process.pid}`)

const player = (
  name: string,
  team: 'CT' | 'T',
  observerSlot: number,
  position: string,
  forward: string
) => ({
  name,
  team,
  observer_slot: observerSlot,
  position,
  forward,
  state: {
    health: 100,
    armor: 100,
    flashed: 0,
    round_kills: 0,
    round_totaldmg: 0
  },
  match_stats: { kills: 0 },
  weapons: {
    weapon_0: {
      name: team === 'CT' ? 'weapon_m4a1' : 'weapon_ak47',
      type: 'Rifle',
      state: 'active',
      ammo_clip: 30
    }
  }
})

test.describe('Auto Director desktop smoke', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    app = await electron.launch({
      args: ['out/main/index.js', '--no-sandbox'],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: userDataRoot
      }
    })
    page = await app.firstWindow()
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('loads the panel and renders a live explainable decision', async () => {
    await page.locator('a[href="#/auto-director"]').click()

    await expect(page.getByText('BebraLand Broadcast Intelligence')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enable Director' })).toBeVisible()
    await expect(page.getByText('WAITING FOR GSI')).toBeVisible()
    await expect(
      page.getByText('Host and port are configured once in global Settings.')
    ).toBeVisible()
    await expect(
      page.getByRole('checkbox', { name: /Enable Windows key fallback/ })
    ).not.toBeChecked()
    await expect(page.locator('select option[value="auto"]')).toHaveCount(0)
    await expect(page.getByLabel('Telnet host')).toHaveCount(0)
    await expect(page.getByLabel('Telnet port')).toHaveCount(0)

    await page.getByTitle('Settings').first().click()
    await expect(page.getByText('Global CS2 Telnet Connection')).toBeVisible()
    await expect(
      page.getByText(
        'Shared by Spectator Binds, Auto Director, and all other CS2 console controls.'
      )
    ).toBeVisible()
    await expect(page.getByPlaceholder('127.0.0.1')).toHaveValue('127.0.0.1')
    await expect(page.getByPlaceholder('2020')).toHaveValue('2020')
    await page.getByRole('heading', { name: 'Settings' }).locator('..').locator('button').click()

    const unauthorized = await page.request.put(
      'http://127.0.0.1:1349/api/auto-director/settings',
      {
        data: { enabled: true }
      }
    )
    expect(unauthorized.status()).toBe(403)

    await page.getByRole('button', { name: 'Enable Director' }).click()

    const response = await page.request.post('http://127.0.0.1:23415/cs2/input', {
      data: {
        map: { round: 4, phase: 'live', team_ct: { score: 2 }, team_t: { score: 1 } },
        round: { phase: 'live' },
        phase_countdowns: { phase: 'live', phase_ends_in: '80.0' },
        allplayers: {
          ct: player('Anchor', 'CT', 1, '0, 0, 0', '1, 0, 0'),
          t: player('Entry', 'T', 6, '1000, 0, 0', '-1, 0, 0')
        }
      }
    })

    expect(response.ok()).toBe(true)
    await expect(page.getByText('GSI LIVE')).toBeVisible()
    await expect(page.getByText('Anchor', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Entry', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Player Priority Board')).toBeVisible()
  })
})
