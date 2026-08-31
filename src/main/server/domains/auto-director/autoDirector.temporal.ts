import type { DirectorPlayer } from './autoDirector.types'

export interface TemporalPlayerFeatures {
  speed500: number
  speed1500: number
  acceleration: number
  enemyClosingSpeed500: number
  aimTurnRate500: number
  movementAimAlignment: number
  historyMs: number
}

interface TemporalSample {
  at: number
  position: [number, number, number] | null
  forward: [number, number, number] | null
  nearestEnemyDistance: number | null
}

const distance = (
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number => Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])

const sampleForWindow = (
  samples: readonly TemporalSample[],
  at: number,
  windowMs: number
): TemporalSample | null => {
  const target = at - windowMs
  let selected = samples[0] ?? null
  for (const sample of samples) {
    if (sample.at > target) break
    selected = sample
  }
  return selected
}

const speedSince = (current: TemporalSample, previous: TemporalSample | null): number => {
  if (!current.position || !previous?.position || current.at <= previous.at) return 0
  return distance(current.position, previous.position) / ((current.at - previous.at) / 1000)
}

const nearestEnemyDistance = (player: DirectorPlayer, players: readonly DirectorPlayer[]) => {
  if (!player.position) return null
  let nearest: number | null = null
  for (const enemy of players) {
    if (!enemy.alive || !enemy.position || !enemy.team || enemy.team === player.team) continue
    const candidate = distance(player.position, enemy.position)
    if (nearest === null || candidate < nearest) nearest = candidate
  }
  return nearest
}

const aimTurnRate = (current: TemporalSample, previous: TemporalSample | null): number => {
  if (!current.forward || !previous?.forward || current.at <= previous.at) return 0
  const currentLength = Math.hypot(...current.forward)
  const previousLength = Math.hypot(...previous.forward)
  if (!currentLength || !previousLength) return 0
  const dot = Math.max(
    -1,
    Math.min(
      1,
      (current.forward[0] * previous.forward[0] +
        current.forward[1] * previous.forward[1] +
        current.forward[2] * previous.forward[2]) /
        (currentLength * previousLength)
    )
  )
  return (Math.acos(dot) * 180) / Math.PI / ((current.at - previous.at) / 1000)
}

const movementAimAlignment = (current: TemporalSample, previous: TemporalSample | null): number => {
  if (!current.position || !current.forward || !previous?.position) return 0
  const movement: [number, number, number] = [
    current.position[0] - previous.position[0],
    current.position[1] - previous.position[1],
    current.position[2] - previous.position[2]
  ]
  const movementLength = Math.hypot(...movement)
  const forwardLength = Math.hypot(...current.forward)
  if (!movementLength || !forwardLength) return 0
  return Math.max(
    -1,
    Math.min(
      1,
      (movement[0] * current.forward[0] +
        movement[1] * current.forward[1] +
        movement[2] * current.forward[2]) /
        (movementLength * forwardLength)
    )
  )
}

export class AutoDirectorTemporalTracker {
  private readonly samples = new Map<string, TemporalSample[]>()

  reset(): void {
    this.samples.clear()
  }

  update(players: DirectorPlayer[], at: number): Map<string, TemporalPlayerFeatures> {
    const result = new Map<string, TemporalPlayerFeatures>()
    for (const player of players) {
      const history = this.samples.get(player.steamId) ?? []
      const current: TemporalSample = {
        at,
        position: player.position,
        forward: player.forward,
        nearestEnemyDistance: nearestEnemyDistance(player, players)
      }
      history.push(current)
      while (history.length > 1 && history[0].at < at - 3000) history.shift()
      this.samples.set(player.steamId, history)

      const previous500 = sampleForWindow(history, at, 500)
      const previous1500 = sampleForWindow(history, at, 1500)
      const speed500 = speedSince(current, previous500)
      const speed1500 = speedSince(current, previous1500)
      const closingSeconds = previous500 ? (current.at - previous500.at) / 1000 : 0
      const enemyClosingSpeed500 =
        closingSeconds > 0 &&
        current.nearestEnemyDistance !== null &&
        previous500?.nearestEnemyDistance != null
          ? (previous500.nearestEnemyDistance - current.nearestEnemyDistance) / closingSeconds
          : 0
      result.set(player.steamId, {
        speed500,
        speed1500,
        acceleration: speed500 - speed1500,
        enemyClosingSpeed500,
        aimTurnRate500: aimTurnRate(current, previous500),
        movementAimAlignment: movementAimAlignment(current, previous500),
        historyMs: history.length > 1 ? at - history[0].at : 0
      })
    }
    return result
  }
}
