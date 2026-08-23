import net from 'node:net'

export interface TelnetCaptureOptions {
  host: string
  port: number
  timeoutMs?: number
}

export interface TelnetCaptureResult {
  response: string
  acknowledged: boolean
}

const makeNonce = (): string =>
  `jts_aerial_capture_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export const captureGetpos = (
  options: TelnetCaptureOptions
): Promise<TelnetCaptureResult> => {
  const timeoutMs = options.timeoutMs ?? 4000
  const port = Number(options.port)

  if (!options.host.trim()) return Promise.reject(new Error('Telnet host is required'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error(`Invalid Telnet port: ${port}`))
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: options.host, port })
    const nonce = makeNonce()
    let response = ''
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      socket.destroy()
      if (error) reject(error)
      else resolve({ response, acknowledged: response.includes(nonce) })
    }

    const timeoutId = setTimeout(
      () => finish(new Error('Telnet timeout while waiting for getpos output')),
      timeoutMs
    )

    socket.setEncoding('utf8')
    socket.setTimeout(timeoutMs)
    socket.on('data', (chunk: string) => {
      response = `${response}${chunk}`.slice(-32_768)
      if (response.includes(nonce)) finish()
    })
    socket.on('connect', () => {
      socket.write(`getpos\r\necho ${nonce}\r\n`)
    })
    socket.on('timeout', () => finish(new Error('Telnet timeout while reading getpos output')))
    socket.on('error', (error) => finish(error))
    socket.on('close', () => {
      if (!settled) finish(new Error('Telnet closed before getpos acknowledgement'))
    })
  })
}
