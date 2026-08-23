const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')

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

const parseGetposOutput = (text) => {
  const number = '(-?\\d+(?:\\.\\d+)?)'
  const pattern = new RegExp(
    `setpos(?:_exact)?\\s+${number}\\s+${number}\\s+${number}\\s*;?\\s*setang(?:_exact)?\\s+${number}\\s+${number}\\s+${number}`,
    'i'
  )
  const match = text.match(pattern)
  if (!match) return null
  const values = match.slice(1).map(Number)
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) return null
  return {
    position: values.slice(0, 3),
    angles: values.slice(3, 6)
  }
}

const captureGetpos = ({ host, port }) =>
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
    const timeoutMs = 4000

    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      socket.destroy()
      if (error) reject(error)
      else {
        const pose = parseGetposOutput(response)
        if (!pose) {
          reject(new Error(`Could not parse getpos response:\n${response.slice(-1800)}`))
        } else {
          resolve({ pose, raw: response })
        }
      }
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
    })
    socket.on('connect', () => socket.write(`getpos\r\necho ${nonce}\r\n`))
    socket.on('timeout', () => finish(new Error('NetCon read timeout')))
    socket.on('error', finish)
    socket.on('close', () => {
      if (!settled) finish(new Error('NetCon closed before getpos acknowledgement'))
    })
  })

ipcMain.handle('capture-pose', async (_event, options) => captureGetpos(options))

ipcMain.handle('export-manifest', async (_event, { map, manifest }) => {
  const result = await dialog.showSaveDialog({
    title: `Export ${map} Aerial anchors`,
    defaultPath: `${map}.aerial.json`,
    filters: [{ name: 'Aerial manifest', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await fs.writeFile(result.filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
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
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
