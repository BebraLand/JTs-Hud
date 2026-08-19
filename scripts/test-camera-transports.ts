import assert from 'node:assert/strict'
import net from 'node:net'
import { sendTelnetCommands } from '../src/main/camera/telnet'
import { simulateObserverSlotKey } from '../src/main/camera/keySimulation'
import { CameraController } from '../src/main/server/domains/auto-director/cameraController'
import { DEFAULT_AUTO_DIRECTOR_SETTINGS } from '../src/main/server/domains/auto-director/autoDirector.config'
import type { PlayerScore } from '../src/main/server/domains/auto-director/autoDirector.types'

const server = net.createServer((socket) => {
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith('echo jts_auto_director_')) {
        socket.write(`${line.slice(5)}\r\n`)
      }
    }
  })
})

const main = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const result = await sendTelnetCommands('spec_mode 1', {
      host: '127.0.0.1',
      port: address.port,
      timeoutMs: 1000,
      requireAck: true
    })
    assert.equal(result.acknowledged, true)
    assert.match(result.response, /jts_auto_director_/)

    await assert.rejects(
      sendTelnetCommands('', { host: '127.0.0.1', port: address.port }),
      /No Telnet commands/
    )
    await assert.rejects(sendTelnetCommands('status', { port: 70000 }), /Invalid Telnet port/)

    if (process.platform !== 'win32') {
      await assert.rejects(simulateObserverSlotKey(1), /available only on Windows/)
    }

    const player = { name: 'Shared Settings Player', observerSlot: 4 } as PlayerScore
    let observedHost = ''
    let observedPort = 0
    let keyboardCalls = 0
    const sharedSettingsController = new CameraController(
      async () => ({ host: '10.20.30.40', port: 31337 }),
      async (_commands, options) => {
        observedHost = options?.host ?? ''
        observedPort = options?.port ?? 0
        throw new Error('simulated Telnet failure')
      },
      async () => {
        keyboardCalls += 1
      }
    )

    const telnetOnly = await sharedSettingsController.switchTo(player, {
      ...DEFAULT_AUTO_DIRECTOR_SETTINGS,
      autoFallback: false
    })
    assert.equal(telnetOnly.ok, false)
    assert.equal(telnetOnly.transport, 'telnet')
    assert.equal(observedHost, '10.20.30.40')
    assert.equal(observedPort, 31337)
    assert.equal(keyboardCalls, 0)

    const fallback = await sharedSettingsController.switchTo(player, {
      ...DEFAULT_AUTO_DIRECTOR_SETTINGS,
      autoFallback: true
    })
    assert.equal(fallback.ok, true)
    assert.equal(fallback.transport, 'keyboard')
    assert.equal(keyboardCalls, 1)

    console.log(
      'Camera transport fixture passed: acknowledgement, shared settings, fallback opt-in and platform guard'
    )
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
