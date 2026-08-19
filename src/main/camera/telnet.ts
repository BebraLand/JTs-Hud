import net from 'net'

export interface TelnetCommandOptions {
  host?: string
  port?: number
  timeoutMs?: number
  requireAck?: boolean
}

export interface TelnetCommandResult {
  response: string
  acknowledged: boolean
}

export const sendTelnetCommands = (
  command: string,
  options: TelnetCommandOptions = {}
): Promise<TelnetCommandResult> => {
  const host = options.host ?? '127.0.0.1'
  const port = Number(options.port ?? 2020)
  const timeoutMs = options.timeoutMs ?? 4000
  const requireAck = options.requireAck ?? false
  const nonce = `jts_auto_director_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const lines = String(command)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) return Promise.reject(new Error('No Telnet commands supplied'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error(`Invalid Telnet port: ${port}`))
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    let response = ''
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      socket.destroy()
      if (error) reject(error)
      else resolve({ response, acknowledged: !requireAck || response.includes(nonce) })
    }
    const timeoutId = setTimeout(() => {
      finish(new Error(requireAck ? 'Telnet acknowledgement timeout' : 'Telnet timeout'))
    }, timeoutMs)

    socket.setTimeout(timeoutMs)
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      response = `${response}${chunk}`.slice(-16_384)
      if (requireAck && response.includes(nonce)) finish()
    })
    socket.on('connect', () => {
      const outbound = requireAck ? [...lines, `echo ${nonce}`] : lines
      let index = 0
      const writeNext = (): void => {
        if (index >= outbound.length) {
          if (!requireAck) finish()
          return
        }
        socket.write(`${outbound[index++]}\r\n`, () => setTimeout(writeNext, 10))
      }
      writeNext()
    })
    socket.on('timeout', () => finish(new Error('Telnet timeout')))
    socket.on('error', (error) => finish(error))
    socket.on('close', () => {
      if (!settled) {
        if (requireAck && !response.includes(nonce)) {
          finish(new Error('Telnet closed before acknowledgement'))
        } else {
          finish()
        }
      }
    })
  })
}
