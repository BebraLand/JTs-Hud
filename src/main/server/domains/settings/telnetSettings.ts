export interface TelnetConnectionSettings {
  host: string
  port: number
}

export const DEFAULT_TELNET_SETTINGS: TelnetConnectionSettings = {
  host: '127.0.0.1',
  port: 2020
}

export const resolveTelnetSettings = (
  values: Record<string, string | undefined>
): TelnetConnectionSettings => {
  const port = Number(values.telnetPort)
  return {
    host: values.telnetHost?.trim() || DEFAULT_TELNET_SETTINGS.host,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_TELNET_SETTINGS.port
  }
}
