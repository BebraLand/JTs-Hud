import type { Server } from 'socket.io'
import { dbGet } from './database/sqlite'

export type HudRefreshReason = 'player' | 'team' | 'match' | 'mat' | 'manual' | 'shortcut'

let refreshRevision = 0
let pendingRefresh: { reason: HudRefreshReason; revision: number } | null = null

export const getHudRefreshState = () => ({
  pending: pendingRefresh !== null,
  reason: pendingRefresh?.reason ?? null,
  revision: pendingRefresh?.revision ?? null
})

const isAutoRefreshEnabled = async (): Promise<boolean> => {
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', ['autoRefreshHuds'])
  return row?.value !== 'false'
}

export const refreshAllHuds = (io: Server, reason: HudRefreshReason = 'manual'): void => {
  const revision = ++refreshRevision
  pendingRefresh = null
  io.emit('refreshHUD', { reason, revision })
  io.emit('hud:refresh-applied', { reason, revision, automatic: reason !== 'manual' && reason !== 'shortcut' })
}

export const notifyHudDataChanged = async (
  io: Server,
  reason: Exclude<HudRefreshReason, 'manual' | 'shortcut'>
): Promise<void> => {
  const revision = ++refreshRevision
  pendingRefresh = { reason, revision }
  io.emit('hud:refresh-needed', { reason, revision })

  if (await isAutoRefreshEnabled()) {
    pendingRefresh = null
    io.emit('refreshHUD', { reason, revision })
    io.emit('hud:refresh-applied', { reason, revision, automatic: true })
  }
}
