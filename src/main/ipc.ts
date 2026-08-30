import { shell, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { enforceOverlayOnTop } from './overlayUtils'
import { registerHudKeybinds, unregisterHudKeybinds } from './shortcuts'
import { getHudsDir, getHudDir } from './paths'
import { setActiveHudId } from './server/server'
import { sendTelnetCommands } from './camera/telnet'
import { getControlToken } from './server/controlToken'
import { getTelnetSettings } from './server/domains/settings/telnetSettings.repository'

const GSI_CFG_CONTENT = `"JTS_HUD_MANAGER"
{
	"uri"		"http://localhost:23415/cs2/input"
	"timeout"		"0.1"
	"buffer"		"0"
	"throttle"		"0"
	"output"
	{
	}
	"heartbeat"		"0.01"
	"data"
	{
		"provider"		"1"
		"map"		"1"
		"round"		"1"
		"player_id"		"1"
		"allplayers_id"		"1"
		"player_state"		"1"
		"allplayers_state"		"1"
		"allplayers_match_stats"		"1"
		"allplayers_weapons"		"1"
		"allplayers_position"		"1"
		"phase_countdowns"		"1"
		"allgrenades"		"1"
		"map_round_wins"		"1"
		"player_position"		"1"
		"bomb"		"1"
	}
}
`

const getCfgPath = (steamPath: string) =>
  path.join(
    steamPath,
    'steamapps',
    'common',
    'Counter-Strike Global Offensive',
    'game',
    'csgo',
    'cfg',
    'gamestate_integration_jts_hud_manager.cfg'
  )

let activeOverlay: BrowserWindow | null = null

export function registerIpcHandlers(): void {
  ipcMain.handle('get-control-token', () => getControlToken())

  ipcMain.on('open-hud', (_, hudUrl) => {
    // Ensure only one overlay window at a time
    if (activeOverlay && !activeOverlay.isDestroyed()) {
      activeOverlay.close()
      activeOverlay = null
    }

    // Extract HUD id from URL: http://localhost:PORT/huds/{id}/index.html
    const hudIdMatch = (hudUrl as string).match(/\/huds\/([^/]+)\//)
    const hudId = hudIdMatch ? hudIdMatch[1] : null

    // Tell the server which HUD is active so hud_config lookups use the correct id
    // regardless of what name the HUD client sends in its register event.
    setActiveHudId(hudId)

    // Load hud keybinds
    if (hudId) {
      const hudDir = getHudDir(hudId)
      const keybindsPath = path.join(hudDir, 'keybinds.json')
      if (fs.existsSync(keybindsPath)) {
        try {
          const keybinds: { bind: string; action: string }[] = JSON.parse(
            fs.readFileSync(keybindsPath, 'utf-8')
          )
          registerHudKeybinds(keybinds)
          console.log(`Loaded ${keybinds.length} keybind(s) for HUD "${hudId}"`)
        } catch (e) {
          console.error(`Failed to parse keybinds.json for HUD "${hudId}":`, e)
        }
      }
    }

    // TODO: May want to use hud name instead for the title
    const overlayWindow = new BrowserWindow({
      title: 'JTs Hud Manager Overlay',
      width: 1920,
      height: 1080,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      fullscreen: true,
      skipTaskbar: false,
      focusable: true,
      webPreferences: {
        sandbox: false,
        contextIsolation: true
      }
    })

    activeOverlay = overlayWindow
    overlayWindow.setIgnoreMouseEvents(true)
    overlayWindow.loadURL(hudUrl)
    enforceOverlayOnTop(overlayWindow)

    overlayWindow.on('closed', () => {
      activeOverlay = null
      setActiveHudId(null)
      unregisterHudKeybinds()
    })
  })

  ipcMain.on('open-huds-folder', () => {
    shell.openPath(getHudsDir())
  })

  // Open folder picker and return the selected path
  ipcMain.handle('select-folder', async (_, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Select Steam Folder',
      defaultPath: defaultPath || 'C:\\Program Files (x86)\\Steam',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Validate the steam path, then install/update the GSI cfg file
  ipcMain.handle(
    'install-gsi-cfg',
    async (_, steamPath: string): Promise<{ ok: boolean; message: string }> => {
      try {
        const cfgPath = getCfgPath(steamPath)
        const cfgDir = path.dirname(cfgPath)

        if (!fs.existsSync(cfgDir)) {
          return {
            ok: false,
            message: `CS2 cfg directory not found:\n${cfgDir}\n\nMake sure the selected path is your Steam root folder and CS2 is installed.`
          }
        }

        // Check if already up-to-date
        if (fs.existsSync(cfgPath)) {
          const existing = fs.readFileSync(cfgPath, 'utf-8')
          if (existing === GSI_CFG_CONTENT) {
            return { ok: true, message: 'GSI config is already installed and up to date.' }
          }
        }

        fs.writeFileSync(cfgPath, GSI_CFG_CONTENT, 'utf-8')
        return { ok: true, message: 'GSI config installed successfully!' }
      } catch (err: any) {
        return { ok: false, message: `Failed to install GSI config: ${err.message}` }
      }
    }
  )

  // Open a URL in the user's default browser
  ipcMain.handle('open-external', async (_, url: string) => {
    await shell.openExternal(url)
  })

  // Send one or more console commands to CS2 via telnet.
  // Commands separated by ; are sent sequentially with a small delay between each.
  ipcMain.handle('send-telnet', async (_, { command }: { command: string }): Promise<void> => {
    const saved = await getTelnetSettings()
    await sendTelnetCommands(command, {
      host: saved.host,
      port: saved.port
    })
  })
}
