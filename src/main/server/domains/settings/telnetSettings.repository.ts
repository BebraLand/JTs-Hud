import { dbAll } from '../../database/sqlite'
import { resolveTelnetSettings, type TelnetConnectionSettings } from './telnetSettings'

export const getTelnetSettings = async (): Promise<TelnetConnectionSettings> => {
  const rows: { key: string; value: string }[] = await dbAll(
    "SELECT key, value FROM settings WHERE key IN ('telnetHost', 'telnetPort')"
  )
  return resolveTelnetSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])))
}
