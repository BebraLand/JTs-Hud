const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')
const { parseGetposOutput, formatPoseCommand } = require('./netcon.cjs')
const {
  MAP_PATTERN,
  createAerialBundle,
  getBundleManifests,
  isAerialBundle,
  isValidManifest
} = require('./manifest.cjs')
const { DEFAULT_GSI_STATE_URL, parseGsiMap, validateGsiStateUrl } = require('./gsi.cjs')
const draftSaveQueues = new Map()
const AERIAL_USER_DATA_DIR = 'JTs-Aerial-Capture'
const DEFAULT_HLAE_SOURCE_DIRECTORY =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64'
const DEFAULT_JTS_API_URL = 'http://127.0.0.1:1349/api'
let legacyUserDataPaths = []

const configureUserDataPath = () => {
  const defaultUserDataPath = app.getPath('userData')
  const stableUserDataPath = path.join(app.getPath('appData'), AERIAL_USER_DATA_DIR)
  legacyUserDataPaths = [
    ...new Set([
      defaultUserDataPath,
      path.join(app.getPath('appData'), 'jts-hud'),
      path.join(app.getPath('appData'), 'JTs Aerial Capture')
    ])
  ].filter((candidate) => candidate !== stableUserDataPath)
  app.setPath('userData', stableUserDataPath)
}

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 960,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#080a10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

const sendNetconCommand = ({ host, port, command, timeoutMs = 4000 }) =>
  new Promise((resolve, reject) => {
    const numericPort = Number(port)
    if (!host || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      reject(new Error('Invalid NetCon host or port'))
      return
    }

    const socket = net.createConnection({ host, port: numericPort })
    const nonce = `jts_aerial_app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    let response = ''
    let settled = false
    let idleTimeoutId
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      clearTimeout(idleTimeoutId)
      socket.destroy()
      if (error) reject(error)
      else resolve({ raw: response, host, port: numericPort, command, nonce })
    }

    const timeoutId = setTimeout(
      () => finish(new Error('NetCon timeout. Check CS2 -netconport and that the demo is open.')),
      timeoutMs
    )

    socket.setEncoding('utf8')
    socket.setTimeout(timeoutMs)
    socket.on('data', (chunk) => {
      response = `${response}${chunk}`.slice(-32768)
      if (response.includes(nonce)) finish()
      else {
        clearTimeout(idleTimeoutId)
        idleTimeoutId = setTimeout(() => {
          if (response) finish()
        }, 250)
      }
    })
    socket.on('connect', () => socket.write(`${command}\r\necho ${nonce}\r\n`))
    socket.on('timeout', () => finish(new Error('NetCon read timeout')))
    socket.on('error', finish)
    socket.on('close', () => {
      if (!settled) {
        if (response) finish()
        else finish(new Error('NetCon closed before command acknowledgement'))
      }
    })
  })

const normalizeCampathName = (value) => {
  const name = path.basename(String(value || '').trim()).replace(/\.xml$/i, '')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new Error('Campath name must use only letters, numbers, underscore, or hyphen.')
  }
  return name
}

const getHlaeLibraryPath = (map, name) =>
  path.join(app.getPath('userData'), 'hlae-campaths', map, `${name}.xml`)

const getHlaeIndexPath = () => path.join(app.getPath('userData'), 'hlae-campaths', 'index.json')

const readHlaeIndex = async () => {
  try {
    const value = JSON.parse(await fs.readFile(getHlaeIndexPath(), 'utf8'))
    return Array.isArray(value) ? value : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

const writeHlaeIndex = async (entries) => {
  const filePath = getHlaeIndexPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
}

const upsertHlaeIndexEntry = async (entry) => {
  const entries = await readHlaeIndex()
  const index = entries.findIndex((item) => item.map === entry.map && item.name === entry.name)
  const next = {
    ...(index >= 0 ? entries[index] : {}),
    ...entry,
    updatedAt: new Date().toISOString()
  }
  if (index >= 0) entries[index] = next
  else entries.push({ ...next, createdAt: next.updatedAt })
  await writeHlaeIndex(entries)
}

const waitForFreshFile = async (filePath, startedAt, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const stats = await fs.stat(filePath)
      if (stats.isFile() && stats.size > 0 && stats.mtimeMs >= startedAt - 1000) return stats
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`HLAE did not create a fresh campath file: ${filePath}`)
}

const captureGetpos = async (options) => {
  const result = await sendNetconCommand({ ...options, command: 'getpos' })
  const pose = parseGetposOutput(result.raw)
  if (!pose) {
    const error = new Error(`Could not parse getpos response:\n${result.raw.slice(-1800)}`)
    error.diagnostic = {
      transport: 'netcon',
      command: result.command,
      endpoint: `${result.host}:${result.port}`,
      responseTail: result.raw.slice(-1800)
    }
    throw error
  }
  return {
    pose,
    raw: result.raw,
    diagnostic: {
      transport: 'netcon',
      command: result.command,
      endpoint: `${result.host}:${result.port}`,
      responseTail: result.raw.slice(-1800)
    }
  }
}

const detectCurrentMap = async (options = {}) => {
  const errors = []
  const attempts = []
  const endpoint = validateGsiStateUrl(options.url || DEFAULT_GSI_STATE_URL)
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(2500) })
    if (response.status === 204) {
      errors.push('JTs-Hud has not received a CS2 GSI payload yet')
      attempts.push({ transport: 'jts-hud-gsi', endpoint, result: 'no-state' })
      return { map: null, source: null, errors, attempts }
    }
    const body = await response.text()
    if (!response.ok) throw new Error(`JTs-Hud GSI state returned HTTP ${response.status}`)
    const payload = JSON.parse(body)
    const map = parseGsiMap(payload)
    attempts.push({
      transport: 'jts-hud-gsi',
      endpoint,
      result: map || 'JTs-Hud payload has no supported de_* map',
      stateAt: response.headers.get('x-jts-gsi-state-at')
    })
    if (map) return { map, source: 'jts-hud-gsi', errors, attempts }
    errors.push('JTs-Hud payload has no supported de_* map')
  } catch (error) {
    errors.push(
      `Cannot read JTs-Hud GSI state at ${endpoint}: ${error instanceof Error ? error.message : String(error)}`
    )
    attempts.push({ transport: 'jts-hud-gsi', endpoint, result: 'request-failed' })
  }
  return { map: null, source: null, errors, attempts }
}

const startApplication = async () => {
  createWindow()
}

ipcMain.handle('capture-pose', async (_event, options) => captureGetpos(options))

ipcMain.handle('detect-map', async (_event, options) => {
  return detectCurrentMap(options)
})

ipcMain.handle('get-telnet-settings', async () => {
  const response = await fetch(`${DEFAULT_JTS_API_URL}/settings`, {
    signal: AbortSignal.timeout(2500)
  })
  if (!response.ok) throw new Error(`JTs-Hud settings returned HTTP ${response.status}`)
  const settings = await response.json()
  const host = typeof settings.telnetHost === 'string' ? settings.telnetHost.trim() : ''
  const port = Number(settings.telnetPort)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('JTs-Hud returned invalid Telnet settings')
  }
  return { host, port, source: `${DEFAULT_JTS_API_URL}/settings` }
})

ipcMain.handle('teleport-pose', async (_event, { options, pose }) => {
  const result = await sendNetconCommand({
    ...options,
    command: formatPoseCommand(pose)
  })
  return {
    acknowledged: result.raw.length > 0,
    diagnostic: {
      transport: 'netcon',
      command: result.command,
      endpoint: `${result.host}:${result.port}`,
      responseTail: result.raw.slice(-1800)
    }
  }
})

ipcMain.handle('save-hlae-campath', async (_event, options = {}) => {
  const map = typeof options.map === 'string' && MAP_PATTERN.test(options.map) ? options.map : null
  if (!map) throw new Error('Invalid map name')

  const name = normalizeCampathName(options.name)
  const sourceDirectory = path.resolve(
    String(options.sourceDirectory || DEFAULT_HLAE_SOURCE_DIRECTORY)
  )
  const sourcePath = path.join(sourceDirectory, `${name}.xml`)
  let previousMtime = 0
  try {
    previousMtime = (await fs.stat(sourcePath)).mtimeMs
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const startedAt = Date.now()
  const commandResult = await sendNetconCommand({
    host: options.host,
    port: options.port,
    command: `mirv_campath save ${name}.xml`,
    timeoutMs: 6000
  })
  await waitForFreshFile(sourcePath, Math.max(startedAt, previousMtime + 1), 5000)

  const targetPath = getHlaeLibraryPath(map, name)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(sourcePath, targetPath)
  await upsertHlaeIndexEntry({
    map,
    name,
    preset: typeof options.preset === 'string' ? options.preset : 'custom',
    label: typeof options.label === 'string' ? options.label : name
  })
  return {
    map,
    name,
    sourcePath,
    filePath: targetPath,
    diagnostic: {
      transport: 'netcon',
      command: commandResult.command,
      endpoint: `${commandResult.host}:${commandResult.port}`,
      responseTail: commandResult.raw.slice(-1800)
    }
  }
})

ipcMain.handle('list-hlae-campaths', async (_event, map) => {
  if (typeof map !== 'string' || !MAP_PATTERN.test(map)) throw new Error('Invalid map name')
  const directory = path.dirname(getHlaeLibraryPath(map, 'placeholder'))
  const indexEntries = (await readHlaeIndex()).filter((entry) => entry.map === map)
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.xml')) continue
      const filePath = path.join(directory, entry.name)
      const stats = await fs.stat(filePath)
      files.push({
        name: entry.name.slice(0, -4),
        preset:
          indexEntries.find((item) => item.name === entry.name.slice(0, -4))?.preset || 'custom',
        label:
          indexEntries.find((item) => item.name === entry.name.slice(0, -4))?.label ||
          entry.name.slice(0, -4),
        filePath,
        size: stats.size,
        updatedAt: stats.mtime.toISOString()
      })
    }
    return files.sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
})

ipcMain.handle('delete-hlae-campath', async (_event, { map, name }) => {
  if (typeof map !== 'string' || !MAP_PATTERN.test(map)) throw new Error('Invalid map name')
  const safeName = normalizeCampathName(name)
  const filePath = getHlaeLibraryPath(map, safeName)
  await fs.rm(filePath, { force: true })
  const entries = (await readHlaeIndex()).filter(
    (entry) => !(entry.map === map && entry.name === safeName)
  )
  await writeHlaeIndex(entries)
  return { map, name: safeName }
})

ipcMain.handle('import-hlae-campath', async (_event, options = {}) => {
  const map = typeof options.map === 'string' && MAP_PATTERN.test(options.map) ? options.map : null
  if (!map) throw new Error('Invalid map name')
  const result = await dialog.showOpenDialog({
    title: 'Import HLAE campath XML',
    properties: ['openFile'],
    filters: [{ name: 'HLAE campath', extensions: ['xml'] }]
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }

  const sourcePath = result.filePaths[0]
  const contents = await fs.readFile(sourcePath, 'utf8')
  if (contents.length > 10 * 1024 * 1024 || !/<campath\b/i.test(contents)) {
    throw new Error('The selected file does not look like an HLAE campath XML.')
  }
  const name = normalizeCampathName(
    options.name || path.basename(sourcePath, path.extname(sourcePath))
  )
  const targetPath = getHlaeLibraryPath(map, name)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(sourcePath, targetPath)
  await upsertHlaeIndexEntry({
    map,
    name,
    preset: typeof options.preset === 'string' ? options.preset : 'custom',
    label: typeof options.label === 'string' ? options.label : name
  })
  return { canceled: false, map, name, filePath: targetPath, sourcePath }
})

ipcMain.handle('load-hlae-campath', async (_event, options = {}) => {
  const map = typeof options.map === 'string' && MAP_PATTERN.test(options.map) ? options.map : null
  if (!map) throw new Error('Invalid map name')
  const name = normalizeCampathName(options.name)
  const sourceDirectory = path.resolve(
    String(options.sourceDirectory || DEFAULT_HLAE_SOURCE_DIRECTORY)
  )
  const libraryPath = getHlaeLibraryPath(map, name)
  const sourcePath = path.join(sourceDirectory, `${name}.xml`)
  await fs.access(libraryPath)
  await fs.mkdir(sourceDirectory, { recursive: true })
  if (path.resolve(libraryPath) !== path.resolve(sourcePath))
    await fs.copyFile(libraryPath, sourcePath)
  const commandResult = await sendNetconCommand({
    host: options.host,
    port: options.port,
    command: `mirv_campath load ${name}.xml`,
    timeoutMs: 6000
  })
  return {
    map,
    name,
    filePath: sourcePath,
    diagnostic: {
      transport: 'netcon',
      command: commandResult.command,
      endpoint: `${commandResult.host}:${commandResult.port}`,
      responseTail: commandResult.raw.slice(-1800)
    }
  }
})

ipcMain.handle('export-hlae-campaths', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose folder for HLAE campaths export',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }

  const sourceRoot = path.join(app.getPath('userData'), 'hlae-campaths')
  const targetRoot = path.join(result.filePaths[0], 'jts-hlae-campaths')
  let count = 0
  try {
    for (const mapEntry of await fs.readdir(sourceRoot, { withFileTypes: true })) {
      if (!mapEntry.isDirectory() || !MAP_PATTERN.test(mapEntry.name)) continue
      const sourceMap = path.join(sourceRoot, mapEntry.name)
      const targetMap = path.join(targetRoot, mapEntry.name)
      await fs.mkdir(targetMap, { recursive: true })
      for (const file of await fs.readdir(sourceMap)) {
        if (!file.toLowerCase().endsWith('.xml')) continue
        await fs.copyFile(path.join(sourceMap, file), path.join(targetMap, file))
        count += 1
      }
    }
    const index = await readHlaeIndex()
    await fs.writeFile(
      path.join(targetRoot, 'index.json'),
      `${JSON.stringify(index, null, 2)}\n`,
      'utf8'
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (!count) throw new Error('No saved HLAE campaths to export.')
  return { canceled: false, filePath: targetRoot, count }
})

const getDraftPath = (map) => {
  if (typeof map !== 'string' || !MAP_PATTERN.test(map)) throw new Error('Invalid map name')
  return path.join(app.getPath('userData'), 'aerial-drafts', `${map}.json`)
}

ipcMain.handle('load-draft', async (_event, map) => {
  const filePath = getDraftPath(map)
  const candidates = [
    filePath,
    ...legacyUserDataPaths.map((basePath) => path.join(basePath, 'aerial-drafts', `${map}.json`))
  ]
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(await fs.readFile(candidate, 'utf8'))
      if (!isValidManifest(manifest, map)) continue
      if (candidate !== filePath) {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.copyFile(candidate, filePath)
      }
      return { manifest, filePath }
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return { manifest: null, filePath }
})

ipcMain.handle('save-draft', async (_event, manifest) => {
  if (!isValidManifest(manifest)) {
    throw new Error('Invalid Aerial draft')
  }
  const previous = draftSaveQueues.get(manifest.map) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const filePath = getDraftPath(manifest.map)
      const directory = path.dirname(filePath)
      const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      await fs.rename(temporaryPath, filePath)
      return filePath
    })
  draftSaveQueues.set(manifest.map, next)
  try {
    const filePath = await next
    return { filePath }
  } finally {
    if (draftSaveQueues.get(manifest.map) === next) draftSaveQueues.delete(manifest.map)
  }
})

ipcMain.handle('create-bundle', (_event, manifests) => createAerialBundle(manifests))
ipcMain.handle('get-bundle-manifests', (_event, bundle) => getBundleManifests(bundle))
ipcMain.handle('is-bundle', (_event, value) => isAerialBundle(value))

ipcMain.handle('export-manifest', async (_event, { map, manifest, manifests, bundle }) => {
  const exportBundle =
    bundle || createAerialBundle(manifests || { [manifest?.map || map]: manifest })
  if (!isAerialBundle(exportBundle)) throw new Error('Invalid Aerial export bundle')
  const result = await dialog.showSaveDialog({
    title: 'Export Aerial anchors for all maps',
    defaultPath: 'jts-aerial-anchors.json',
    filters: [{ name: 'Aerial manifest', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await fs.writeFile(result.filePath, `${JSON.stringify(exportBundle, null, 2)}\n`, 'utf8')
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('import-manifest', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Aerial manifest',
    properties: ['openFile'],
    filters: [{ name: 'Aerial manifest', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  const filePath = result.filePaths[0]
  const manifest = JSON.parse(await fs.readFile(filePath, 'utf8'))
  return { canceled: false, filePath, manifest }
})

app.whenReady().then(() => {
  configureUserDataPath()
  void startApplication()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
