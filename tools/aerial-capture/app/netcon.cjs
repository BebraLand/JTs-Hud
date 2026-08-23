const MAP_PATTERN = /^de_[a-z0-9_]+$/

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

const parseCurrentMap = (text) => {
  const match = String(text).match(/(?:\bmap\s*[:=]\s*|\bcurrent\s+map\s*[:=]?\s*)(de_[a-z0-9_]+)/i)
  const map = match?.[1]?.toLowerCase()
  return map && MAP_PATTERN.test(map) ? map : null
}

const formatPoseCommand = (pose) => {
  if (
    !pose ||
    !Array.isArray(pose.position) ||
    !Array.isArray(pose.angles) ||
    pose.position.length !== 3 ||
    pose.angles.length !== 3 ||
    [...pose.position, ...pose.angles].some((value) => !Number.isFinite(Number(value)))
  ) {
    throw new Error('Invalid anchor pose')
  }
  const position = pose.position.map((value) => String(Number(value))).join(' ')
  const angles = pose.angles.map((value) => String(Number(value))).join(' ')
  return `setpos_exact ${position}; setang_exact ${angles}`
}

module.exports = {
  MAP_PATTERN,
  parseCurrentMap,
  parseGetposOutput,
  formatPoseCommand
}
