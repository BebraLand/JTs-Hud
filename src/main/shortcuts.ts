import { globalShortcut } from 'electron'
import { io } from './server/server'
import { getLastGSIState } from './server/integrations/gsi'
import { MatchService } from './server/domains/matches/match.service'

const matchService = new MatchService()

// HUD specific keybinds that will be unregistered when HUD is closed
const activeHudBinds: string[] = []

export function registerHudKeybinds(keybinds: { bind: string; action: string }[]): void {
  unregisterHudKeybinds()

  for (const { bind, action } of keybinds) {
    const ok = globalShortcut.register(bind, () => {
      io.emit('keybindAction', action)
      // console.log(`HUD keybind [${bind}] → action "${action}"`);
    })
    if (ok) {
      activeHudBinds.push(bind)
    } else {
      console.warn(`HUD keybind [${bind}] could not be registered (already in use?)`)
    }
  }
}

export function unregisterHudKeybinds(): void {
  for (const bind of activeHudBinds) {
    globalShortcut.unregister(bind)
  }
  activeHudBinds.length = 0
}

export function registerShortcuts(): void {
  // Global Alt+F: Refresh HUDs
  globalShortcut.register('Alt+F', () => {
    io.emit('refreshHUD')
    // console.log('Emitted refresh to all HUD clients')
  })

  // Global Alt+R: Toggle reverseSide on the current map veto of the active match
  globalShortcut.register('Alt+R', async () => {
    const gsi = getLastGSIState()
    if (!gsi?.map?.name) {
      console.warn('Alt+R: No GSI map data available yet')
      return
    }

    const mapName = gsi.map.name.substring(gsi.map.name.lastIndexOf('/') + 1)

    try {
      await matchService.toggleVetoReverseSide(mapName)
      io.emit('match')
      console.log(`Alt+R: Toggled reverseSide for map "${mapName}" and notified HUDs`)
    } catch (err: any) {
      console.error('Alt+R: Failed to toggle reverseSide —', err.message)
    }
  })
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
