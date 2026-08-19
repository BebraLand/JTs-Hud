import { getProfile } from './autoDirector.config'
import type {
  AutoDirectorDecision,
  AutoDirectorSettings,
  DirectorPlayer,
  GsiLikePayload,
  PlayerScore,
  ScoreFactor
} from './autoDirector.types'

type TemporalSignals = {
  shotUntil: number
  damageUntil: number
  killUntil: number
  damageDelta: number
}

const FACTOR_LABELS: Record<ScoreFactor['key'], string> = {
  base: 'Base',
  objective: 'Plant / defuse',
  combat: 'Active combat',
  damage: 'Recent damage',
  recentKill: 'Recent kill',
  proximity: 'Enemy proximity',
  aimAlignment: 'Aim alignment',
  clutch: 'Clutch',
  grenade: 'Grenade play',
  entry: 'Entry contact',
  retake: 'Retake pressure',
  weaponPressure: 'Weapon setup',
  bombCarrier: 'Bomb carrier',
  lowHealthDrama: 'Low-HP pressure',
  continuity: 'Story continuity',
  death: 'Dead',
  flashPenalty: 'Flash penalty'
}

const parseVector = (value: unknown): [number, number, number] | null => {
  if (Array.isArray(value) && value.length >= 3) {
    const parsed = value.slice(0, 3).map(Number)
    return parsed.every(Number.isFinite) ? (parsed as [number, number, number]) : null
  }
  if (typeof value !== 'string') return null
  const parsed = value.split(',').map((part) => Number(part.trim()))
  return parsed.length >= 3 && parsed.slice(0, 3).every(Number.isFinite)
    ? (parsed.slice(0, 3) as [number, number, number])
    : null
}

const distance = (a: [number, number, number], b: [number, number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const aimAlignment = (
  origin: [number, number, number] | null,
  forward: [number, number, number] | null,
  target: [number, number, number] | null
): number => {
  if (!origin || !forward || !target) return 0
  const delta: [number, number, number] = [
    target[0] - origin[0],
    target[1] - origin[1],
    target[2] - origin[2]
  ]
  const deltaLength = Math.hypot(...delta)
  const forwardLength = Math.hypot(...forward)
  if (!deltaLength || !forwardLength) return 0
  const dot =
    (delta[0] * forward[0] + delta[1] * forward[1] + delta[2] * forward[2]) /
    (deltaLength * forwardLength)
  return Math.max(0, Math.min(1, (dot + 1) / 2))
}

const activeWeapon = (raw: any): any => {
  const weapons = Object.values(raw?.weapons ?? {}) as any[]
  return weapons.find((weapon) => weapon?.state === 'active') ?? weapons[0] ?? {}
}

export const normalizePlayers = (payload: GsiLikePayload): DirectorPlayer[] =>
  Object.entries(payload.allplayers ?? {}).map(([steamId, raw]: [string, any]) => {
    const weapon = activeWeapon(raw)
    const state = raw?.state ?? {}
    const stats = raw?.match_stats ?? {}
    const inventory = Object.values(raw?.weapons ?? {}) as any[]
    return {
      steamId,
      name: String(raw?.name ?? steamId),
      team: String(raw?.team ?? ''),
      observerSlot: Number(raw?.observer_slot ?? -1),
      health: Number(state.health ?? 0),
      armor: Number(state.armor ?? 0),
      alive: Number(state.health ?? 0) > 0,
      flashed: Number(state.flashed ?? 0),
      position: parseVector(raw?.position),
      forward: parseVector(raw?.forward),
      weapon: String(weapon?.name ?? ''),
      weaponType: String(weapon?.type ?? ''),
      ammoClip: Number.isFinite(Number(weapon?.ammo_clip)) ? Number(weapon.ammo_clip) : null,
      kills: Number(stats.kills ?? 0),
      roundKills: Number(state.round_kills ?? 0),
      roundDamage: Number(state.round_totaldmg ?? 0),
      hasBomb: inventory.some((item) =>
        String(item?.name ?? '')
          .toLowerCase()
          .includes('c4')
      )
    }
  })

export class AutoDirectorEngine {
  private previousPlayers = new Map<string, DirectorPlayer>()
  private signals = new Map<string, TemporalSignals>()
  private currentSteamId: string | null = null
  private switchedAt = 0

  confirmSwitch(steamId: string, at: number): void {
    this.currentSteamId = steamId
    this.switchedAt = at
  }

  setCurrent(steamId: string | null, at = Date.now()): void {
    this.currentSteamId = steamId
    this.switchedAt = at
  }

  getCurrent(): string | null {
    return this.currentSteamId
  }

  reset(): void {
    this.previousPlayers.clear()
    this.signals.clear()
    this.currentSteamId = null
    this.switchedAt = 0
  }

  evaluate(
    payload: GsiLikePayload,
    settings: AutoDirectorSettings,
    at = Date.now()
  ): AutoDirectorDecision {
    const profile = getProfile(settings)
    const players = normalizePlayers(payload)
    const playersById = new Map(players.map((player) => [player.steamId, player]))
    const aliveByTeam = new Map<string, number>()
    for (const player of players.filter((candidate) => candidate.alive)) {
      aliveByTeam.set(player.team, (aliveByTeam.get(player.team) ?? 0) + 1)
    }

    for (const player of players) {
      const previous = this.previousPlayers.get(player.steamId)
      const existing = this.signals.get(player.steamId) ?? {
        shotUntil: 0,
        damageUntil: 0,
        killUntil: 0,
        damageDelta: 0
      }
      const ammoDropped =
        previous?.ammoClip !== null &&
        player.ammoClip !== null &&
        previous?.weapon === player.weapon &&
        player.ammoClip < previous.ammoClip
      const healthDropped = previous ? player.health < previous.health : false
      const damageDelta = previous ? Math.max(0, player.roundDamage - previous.roundDamage) : 0
      const newKill = previous
        ? player.kills > previous.kills || player.roundKills > previous.roundKills
        : false
      this.signals.set(player.steamId, {
        shotUntil: ammoDropped ? at + 700 : existing.shotUntil,
        damageUntil: healthDropped || damageDelta > 0 ? at + 1100 : existing.damageUntil,
        killUntil: newKill ? at + 1600 : existing.killUntil,
        damageDelta:
          damageDelta > 0 ? damageDelta : existing.damageUntil > at ? existing.damageDelta : 0
      })
    }

    const bombState = String(payload.bomb?.state ?? '').toLowerCase()
    const objectiveActive = bombState === 'planting' || bombState === 'defusing'
    const objectiveSteamId = objectiveActive ? String(payload.bomb?.player ?? '') || null : null

    const scores = players
      .map((player): PlayerScore => {
        const factors: ScoreFactor[] = []
        const signal = this.signals.get(player.steamId)!
        const enemies = players.filter(
          (enemy) => enemy.alive && enemy.team && player.team && enemy.team !== player.team
        )
        let nearestEnemy: DirectorPlayer | null = null
        let nearestDistance: number | null = null
        if (player.position) {
          for (const enemy of enemies) {
            if (!enemy.position) continue
            const candidateDistance = distance(player.position, enemy.position)
            if (nearestDistance === null || candidateDistance < nearestDistance) {
              nearestDistance = candidateDistance
              nearestEnemy = enemy
            }
          }
        }
        const alignment = aimAlignment(
          player.position,
          player.forward,
          nearestEnemy?.position ?? null
        )
        const proximityIntensity =
          nearestDistance === null ? 0 : Math.max(0, Math.min(1, 1 - nearestDistance / 1800))
        const activeCombat =
          signal.shotUntil > at ||
          signal.damageUntil > at ||
          (nearestDistance !== null && nearestDistance < 850 && alignment > 0.62)
        const ownAlive = aliveByTeam.get(player.team) ?? 0
        const enemyAlive = enemies.length
        const clutch = player.alive && ownAlive === 1 && enemyAlive >= 1
        const grenadeActive =
          /grenade/i.test(player.weaponType) ||
          /(flashbang|smokegrenade|hegrenade|molotov|incgrenade|decoy)/i.test(player.weapon) ||
          Object.values(payload.grenades ?? {}).some(
            (grenade) => String(grenade?.owner ?? '') === player.steamId
          )
        const roundPhase = String(payload.round?.phase ?? payload.phase_countdowns?.phase ?? '')
        const entryWindow = roundPhase === 'live' && Number(payload.map?.round ?? 0) >= 0
        const retake = bombState === 'planted' && player.team === 'CT'
        const sniperSightline =
          nearestDistance !== null &&
          /(awp|ssg08|scar20|g3sg1)/i.test(player.weapon) &&
          nearestDistance >= 500 &&
          alignment > 0.65
        const closeRangeSetup =
          nearestDistance !== null &&
          /(mp9|mac10|nova|xm1014|mag7|sawedoff)/i.test(player.weapon) &&
          nearestDistance < 700
        const weaponPressure = sniperSightline || closeRangeSetup

        const add = (key: ScoreFactor['key'], value: number, detail: string): void => {
          if (Math.abs(value) < 0.05) return
          factors.push({
            key,
            label: FACTOR_LABELS[key],
            value: Math.round(value * 10) / 10,
            detail
          })
        }

        if (!player.alive) {
          add('death', -1000, 'Player is dead')
        } else {
          add('base', profile.weights.base, 'Alive first-person candidate')
          if (objectiveSteamId === player.steamId) {
            add('objective', profile.weights.objective, `${bombState} in progress`)
          }
          if (activeCombat) {
            add('combat', profile.weights.combat, 'Shot, damage or imminent duel detected')
          }
          if (signal.damageUntil > at) {
            const intensity = Math.max(0.35, Math.min(1, signal.damageDelta / 80))
            add(
              'damage',
              profile.weights.damage * intensity,
              `${signal.damageDelta || 'Recent'} damage delta`
            )
          }
          if (signal.killUntil > at) {
            add('recentKill', profile.weights.recentKill, 'Kill detected from GSI stat delta')
          }
          if (proximityIntensity > 0) {
            add(
              'proximity',
              profile.weights.proximity * proximityIntensity,
              `Nearest enemy ${Math.round(nearestDistance!)} units away`
            )
          }
          if (alignment > 0.5 && nearestEnemy) {
            add(
              'aimAlignment',
              profile.weights.aimAlignment * ((alignment - 0.5) * 2),
              `Facing ${nearestEnemy.name} (${Math.round(alignment * 100)}% alignment proxy)`
            )
          }
          if (clutch) {
            add('clutch', profile.weights.clutch, `Last alive versus ${enemyAlive}`)
          }
          if (grenadeActive && nearestDistance !== null && nearestDistance < 1800) {
            add('grenade', profile.weights.grenade, 'Active grenade near potential contact')
          }
          if (entryWindow && ownAlive >= 4 && proximityIntensity > 0.25) {
            add('entry', profile.weights.entry * proximityIntensity, 'Early-round contact pressure')
          }
          if (retake) {
            add('retake', profile.weights.retake, 'CT retake while bomb is planted')
          }
          if (weaponPressure) {
            add(
              'weaponPressure',
              profile.weights.weaponPressure,
              sniperSightline
                ? `${player.weapon} sniper sightline proxy (scope state unavailable in GSI)`
                : `${player.weapon} in its close-range contact window`
            )
          }
          if (player.hasBomb) {
            add('bombCarrier', profile.weights.bombCarrier, 'Carrying C4')
          }
          if (player.health <= 35 && (activeCombat || clutch)) {
            add(
              'lowHealthDrama',
              profile.weights.lowHealthDrama * (1 - player.health / 36),
              `${player.health} HP under pressure`
            )
          }
          if (player.steamId === this.currentSteamId) {
            add('continuity', profile.weights.continuity, 'Current POV story continuity')
          }
          if (player.flashed > 80) {
            add(
              'flashPenalty',
              -Math.min(20, player.flashed / 12),
              `${player.flashed} flash amount`
            )
          }
        }

        return {
          steamId: player.steamId,
          name: player.name,
          team: player.team,
          observerSlot: player.observerSlot,
          alive: player.alive,
          total: Math.round(factors.reduce((sum, factor) => sum + factor.value, 0) * 10) / 10,
          factors: factors.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
          nearestEnemyDistance: nearestDistance === null ? null : Math.round(nearestDistance),
          switchEligible: player.alive && player.observerSlot >= 0 && player.observerSlot <= 9
        }
      })
      .sort(
        (a, b) =>
          b.total - a.total || a.observerSlot - b.observerSlot || a.steamId.localeCompare(b.steamId)
      )

    const currentScore = scores.find((score) => score.steamId === this.currentSteamId) ?? null
    const ranked = scores.filter((score) => score.switchEligible)
    const requestedOverride = settings.manualOverrideSteamId
      ? (ranked.find((score) => score.steamId === settings.manualOverrideSteamId) ?? null)
      : null
    const objectiveScore = objectiveSteamId
      ? (ranked.find((score) => score.steamId === objectiveSteamId) ?? null)
      : null
    const best = requestedOverride ?? objectiveScore ?? ranked[0] ?? null
    const runnerUp = ranked.find((score) => score.steamId !== best?.steamId) ?? null
    let shouldSwitch = false
    let reason = 'No eligible living players'
    let lockKind: AutoDirectorDecision['lockKind'] = 'none'
    let lockUntil: number | null = null
    const roundPhase = String(payload.round?.phase ?? payload.phase_countdowns?.phase ?? '')
    const mapPhase = String(payload.map?.phase ?? '')
    const liveRound = mapPhase === 'live' && roundPhase === 'live'

    if (requestedOverride) {
      shouldSwitch = requestedOverride.steamId !== this.currentSteamId
      reason = shouldSwitch
        ? `Operator forced ${requestedOverride.name}`
        : `Operator holds ${requestedOverride.name}`
      lockKind = 'manual'
    } else if (!best) {
      shouldSwitch = false
    } else if (!settings.enabled) {
      reason = 'Auto-director disabled'
    } else if (settings.paused) {
      reason = 'Auto-director paused by operator'
    } else if (!liveRound) {
      reason = `Waiting for live round (${roundPhase || mapPhase || 'no phase'})`
    } else if (objectiveSteamId && playersById.get(objectiveSteamId)?.alive) {
      shouldSwitch = objectiveSteamId !== this.currentSteamId
      const objectivePlayer = scores.find((score) => score.steamId === objectiveSteamId)
      reason = shouldSwitch
        ? `Hard objective lock: ${bombState} by ${objectivePlayer?.name ?? objectiveSteamId}`
        : `Holding ${bombState} objective action`
      lockKind = 'objective'
    } else if (!currentScore || !currentScore.alive) {
      shouldSwitch = best.steamId !== this.currentSteamId
      reason = currentScore
        ? `${currentScore.name} died; selecting ${best.name}`
        : `Initial target: ${best.name}`
    } else if (best.steamId === currentScore.steamId) {
      reason = `${currentScore.name} remains highest priority`
    } else {
      const currentSignal = this.signals.get(currentScore.steamId)
      const dwellUntil = this.switchedAt + profile.minDwellMs
      const postKillUntil = currentSignal?.killUntil
        ? currentSignal.killUntil - 1600 + profile.postKillHoldMs
        : 0
      const combatUntil = currentSignal
        ? Math.max(
            currentSignal.shotUntil - 700 + profile.combatSoftLockMs,
            currentSignal.damageUntil - 1100 + profile.combatSoftLockMs
          )
        : 0

      if (postKillUntil > at) {
        reason = `Post-kill hold on ${currentScore.name}`
        lockKind = 'post-kill'
        lockUntil = postKillUntil
      } else if (combatUntil > at) {
        reason = `Combat soft lock on ${currentScore.name}`
        lockKind = 'combat'
        lockUntil = combatUntil
      } else if (dwellUntil > at) {
        reason = `Minimum dwell on ${currentScore.name}`
        lockKind = 'minimum-dwell'
        lockUntil = dwellUntil
      } else if (best.total >= currentScore.total + profile.switchMargin) {
        shouldSwitch = true
        reason = `${best.name} leads ${currentScore.name} by ${(best.total - currentScore.total).toFixed(1)} points`
      } else {
        reason = `${best.name} does not clear the ${profile.switchMargin}-point switch margin`
      }
    }

    this.previousPlayers = new Map(players.map((player) => [player.steamId, player]))

    return {
      at,
      scores,
      currentSteamId: this.currentSteamId,
      currentName: currentScore?.name ?? null,
      candidateSteamId: best?.steamId ?? null,
      candidateName: best?.name ?? null,
      runnerUpSteamId: runnerUp?.steamId ?? null,
      runnerUpName: runnerUp?.name ?? null,
      shouldSwitch,
      reason,
      lockKind,
      lockUntil
    }
  }
}
