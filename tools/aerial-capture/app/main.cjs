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

const getDraftPath = (map) => {
  if (typeof map !== 'string' || !MAP_PATTERN.test(map)) throw new Error('Invalid map name')
  return path.join(app.getPath('userData'), 'aerial-drafts', `${map}.json`)
}

ipcMain.handle('load-draft', async (_event, map) => {
  const filePath = getDraftPath(map)
  try {
    const manifest = JSON.parse(await fs.readFile(filePath, 'utf8'))
    return { manifest: isValidManifest(manifest, map) ? manifest : null, filePath }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { manifest: null, filePath }
    throw error
  }
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
  void startApplication()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
