const DEFAULT_GSI_STATE_URL = 'http://127.0.0.1:23415/cs2/state'
const GSI_STATE_PATH = '/cs2/state'
const MAP_PATTERN = /^de_[a-z0-9_]+$/

const normalizeMapName = (value) => {
  if (typeof value !== 'string') return null
  const basename = value.trim().toLowerCase().split('/').pop()
  return MAP_PATTERN.test(basename) ? basename : null
}

const parseGsiMap = (payload) => {
  if (!payload || typeof payload !== 'object') return null
  return normalizeMapName(payload.map?.name ?? payload.mapName)
}

const validateGsiStateUrl = (value = DEFAULT_GSI_STATE_URL) => {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== GSI_STATE_PATH) {
    throw new Error(`JTs-Hud GSI state URL must end with ${GSI_STATE_PATH}`)
  }
  return url.toString()
}

module.exports = {
  DEFAULT_GSI_STATE_URL,
  GSI_STATE_PATH,
  MAP_PATTERN,
  normalizeMapName,
  parseGsiMap,
  validateGsiStateUrl
}
