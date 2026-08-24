import { app } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * Returns the path to the user-facing HUDs directory.
 * Stored in ~/jthm-huds so users can easily find and manage their HUDs.
 */
export const getHudsDir = (): string => {
  const dir = path.join(app.getPath('home'), 'jthm-huds')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Returns the path to the bundled default HUD inside the app package.
 * Tries multiple locations to support dev, packed, and unpacked scenarios.
 */
export const getBuiltinHudDir = (hudId = 'default'): string => {
  const candidates = [
    // Production packed build
    path.join(app.getAppPath(), `resources/${hudId}-hud`),
    // Unpacked build
    path.join(process.execPath, `../resources/${hudId}-hud`),
    // Development
    path.join(__dirname, `../../resources/${hudId}-hud`)
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  // Fallback to development path if none exist (will error at runtime if actually needed)
  return path.join(__dirname, `../../resources/${hudId}-hud`)
}

export const getHudDir = (hudId: string): string => {
  const builtinDir = getBuiltinHudDir(hudId)
  return fs.existsSync(path.join(builtinDir, 'hud.json'))
    ? builtinDir
    : path.join(getHudsDir(), hudId)
}

export const getAutoDirectorResourceDir = (): string => {
  const candidates = [
    path.join(app.getAppPath(), 'resources/auto-director'),
    path.join(process.execPath, '../resources/auto-director'),
    path.join(__dirname, '../../resources/auto-director')
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[2]
}
