const { io } = require('socket.io-client')

const url = process.argv[2]
if (!url) throw new Error('Usage: node wait-for-gsi-event.cjs <JTs-Hud URL>')

const socket = io(url, { transports: ['websocket'], timeout: 3000 })
const timer = setTimeout(() => {
  socket.close()
  console.error('Timed out waiting for the GSI fixture on the JTs-Hud socket')
  process.exit(1)
}, 5000)

socket.on('connect_error', (error) => {
  clearTimeout(timer)
  socket.close()
  console.error(`Could not connect to the JTs-Hud socket: ${error.message}`)
  process.exit(1)
})

socket.on('update', (payload) => {
  if (payload?.provider?.name !== 'MAT GSI fixture') return
  if (payload?.map?.name !== 'de_cache') throw new Error('Wrong GSI map payload')
  if (payload?.allplayers?.['76561198000000001']?.state?.health !== 87) {
    throw new Error('Live GSI player telemetry was not forwarded')
  }
  clearTimeout(timer)
  socket.close()
  console.log('GSI socket fixture passed: de_cache and live player health 87 forwarded')
  process.exit(0)
})
