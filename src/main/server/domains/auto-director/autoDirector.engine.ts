import { getProfile } from './autoDirector.config'
import type {
  AutoDirectorDecision,
  AutoDirectorSettings,
  DirectorPlayer,
  GsiLikePayload,
  PlayerScore,
  ScoreFactor
} from './autoDirector.types'
import { analyzeScenes, type SceneAnalysis, type SceneSummary } from './autoDirector.scene'
import type { PlayerGeometryFeatures } from './geometry/geometryFeatures'
import type { PlayerTopologyFeatures } from './topology/topologyFeatures'

type TemporalSignals = {
  shotUntil: number
  damageUntil: number
  killUntil: number
  deathUntil: number
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
  geometryAdvisory: 'Geometry LOS advisory',
  mlAdvisory: 'ML advisory',
  death: 'Dead',
  flashPenalty: 'Flash penalty',
  orientationPenalty: 'Looking away from nearest threat',
  sceneRelevance: 'Dominant scene relevance',
  groupCoverage: 'Enemy group coverage',
  routeEntry: 'Likely group entry',
  contactImminence: 'Contact imminence',
  incomingGroupPressure: 'Incoming group pressure',
  scenePovQuality: 'Scene POV quality',
  portalControl: 'Portal control',
  fightPrediction: 'Predicted fight window',
  crossfire: 'Crossfire potential',
  isolationPenalty: 'Isolated no-action penalty'
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

export type ScoreAdvisoryResult = {
  key: 'geometryAdvisory' | 'mlAdvisory'
  value: number
  detail: string
}

export type ScoreAdvisory = (
  player: DirectorPlayer,
  score: PlayerScore,
  players: DirectorPlayer[]
) => ScoreAdvisoryResult[]

export class AutoDirectorEngine {
  private previousPlayers = new Map<string, DirectorPlayer>()
  private signals = new Map<string, TemporalSignals>()
  private currentSteamId: string | null = null
  private switchedAt = 0
  private trackedSceneMembers = new Set<string>()
  private routeEntryStreaks = new Map<string, number>()
  private actionableRouteStreaks = new Map<string, number>()

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
    this.trackedSceneMembers.clear()
    this.routeEntryStreaks.clear()
    this.actionableRouteStreaks.clear()
  }

  private trackScene(analysis: SceneAnalysis): SceneSummary | null {
    const challenger = analysis.scenes[0] ?? null
    if (!challenger) {
      this.trackedSceneMembers.clear()
      return null
    }
    const tracked = analysis.scenes.find((scene) => {
      if (this.trackedSceneMembers.size === 0) return false
      const overlap = scene.members.filter((member) =>
        this.trackedSceneMembers.has(member.steamId)
      ).length
      return (
        overlap >=
        Math.max(1, Math.ceil(Math.min(scene.members.length, this.trackedSceneMembers.size) * 0.5))
      )
    })
    const selected =
      !tracked ||
      tracked.key === challenger.key ||
      challenger.score >= tracked.score + 10 ||
      tracked.members.length <= 1
        ? challenger
        : tracked
    this.trackedSceneMembers = new Set(selected.members.map((member) => member.steamId))
    return selected
  }

  evaluate(
    payload: GsiLikePayload,
    settings: AutoDirectorSettings,
    at = Date.now(),
    advisory?: ScoreAdvisory,
    geometryFeatures?: ReadonlyMap<string, PlayerGeometryFeatures>,
    topologyFeatures?: ReadonlyMap<string, PlayerTopologyFeatures>
  ): AutoDirectorDecision {
    const profile = getProfile(settings)
    const players = normalizePlayers(payload)
    const playersById = new Map(players.map((player) => [player.steamId, player]))
    const sceneAnalysis: SceneAnalysis = settings.sceneAdvisoryEnabled
      ? analyzeScenes(players, this.previousPlayers, geometryFeatures, topologyFeatures)
      : { scenes: [], dominantScene: null, playerFeatures: new Map() }
    const trackedScene = settings.sceneAdvisoryEnabled ? this.trackScene(sceneAnalysis) : null
    for (const scene of sceneAnalysis.playerFeatures.values()) {
      scene.dominantScene = Boolean(trackedScene && scene.sceneKey === trackedScene.key)
      scene.dominantSceneScore = trackedScene?.score ?? 0
      scene.sceneRelevance =
        !trackedScene || trackedScene.score <= 0
          ? 0
          : Math.max(0, Math.min(1, scene.sceneScore / trackedScene.score))
    }
    const highConfidenceDominantScene = Boolean(
      trackedScene &&
      trackedScene.hasOpposition &&
      trackedScene.members.length >= 4 &&
      trackedScene.score >= 24 &&
      trackedScene.confidence >= 0.55
    )
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
        deathUntil: 0,
        damageDelta: 0
      }
      const canFireProjectile =
        !/grenade|c4|knife|taser/i.test(player.weaponType) &&
        !/(grenade|flashbang|smokegrenade|hegrenade|molotov|incgrenade|decoy|weapon_c4|knife|taser)/i.test(
          player.weapon
        )
      const ammoDropped =
        canFireProjectile &&
        previous?.ammoClip !== null &&
        player.ammoClip !== null &&
        previous?.weapon === player.weapon &&
        player.ammoClip < previous.ammoClip
      const healthDropped = previous ? player.health < previous.health : false
      const damageDelta = previous ? Math.max(0, player.roundDamage - previous.roundDamage) : 0
      const newKill = previous
        ? player.kills > previous.kills || player.roundKills > previous.roundKills
        : false
      const newDeath = Boolean(previous?.alive && !player.alive)
      this.signals.set(player.steamId, {
        shotUntil: ammoDropped ? at + 700 : existing.shotUntil,
        damageUntil: healthDropped || damageDelta > 0 ? at + 1100 : existing.damageUntil,
        killUntil: newKill ? at + 1600 : existing.killUntil,
        deathUntil: newDeath ? at + settings.postDeathHoldMs : existing.deathUntil,
        damageDelta:
          damageDelta > 0 ? damageDelta : existing.damageUntil > at ? existing.damageDelta : 0
      })
    }

    const bombState = String(payload.bomb?.state ?? '').toLowerCase()
    const objectiveActive = bombState === 'planting' || bombState === 'defusing'
    const objectiveSteamId = objectiveActive ? String(payload.bomb?.player ?? '') || null : null
    const bombPosition = parseVector(payload.bomb?.position)
    const objectivePlayer = objectiveSteamId ? playersById.get(objectiveSteamId) : null
    const objectiveOpponentNearBomb = Boolean(
      bombPosition &&
      objectivePlayer &&
      players.some(
        (player) =>
          player.alive &&
          player.team !== objectivePlayer.team &&
          player.position &&
          distance(player.position, bombPosition) <= 1600
      )
    )

    const scores = players
      .map((player): PlayerScore => {
        const factors: ScoreFactor[] = []
        const signal = this.signals.get(player.steamId)!
        const scene = sceneAnalysis.playerFeatures.get(player.steamId)
        const sceneBroadcastRelevant = Boolean(
          scene && (scene.sceneMemberCount >= 3 || scene.opposingSceneMemberCount >= 1)
        )
        const sceneThreatViewActive = Boolean(
          scene &&
          scene.threatSceneTargetCount >= 2 &&
          (scene.threatSceneActionableTargetCount > 0 ||
            (scene.incomingGroupPressure >= 0.35 &&
              scene.threatSceneCoverage >= 0.35 &&
              !scene.isolatedNoAction))
        )
        const localGroupViewAllowed = Boolean(
          scene && (!scene.dominantScene || scene.opposingSceneMemberCount > 0)
        )
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
        const playerGeometry = geometryFeatures?.get(player.steamId)
        const geometryAware = Boolean(playerGeometry)
        const nearestCanEngage =
          !geometryAware ||
          Boolean(
            playerGeometry?.nearestEnemyHasLineOfSight ||
            playerGeometry?.nearestEnemyHasPeekPotential
          )
        const directionFocus = Math.max(0, Math.min(1, (alignment - 0.5) * 2))
        const rawProximityIntensity =
          nearestDistance === null ? 0 : Math.max(0, Math.min(1, 1 - nearestDistance / 1800))
        const proximityEvidence = !geometryAware
          ? 1
          : playerGeometry?.nearestEnemyHasLineOfSight
            ? 1
            : playerGeometry?.nearestEnemyHasPeekPotential
              ? 0.45
              : 0.12
        const proximityIntensity = rawProximityIntensity * proximityEvidence
        const activeCombat =
          signal.shotUntil > at ||
          signal.damageUntil > at ||
          (nearestCanEngage &&
            nearestDistance !== null &&
            nearestDistance < 850 &&
            alignment > 0.62)
        const recentCombatSignal = signal.shotUntil > at || signal.damageUntil > at
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
        } else if (settings.rulesEnabled) {
          add('base', profile.weights.base, 'Alive first-person candidate')
          if (settings.sceneAdvisoryEnabled && scene && scene.sceneKey) {
            if (
              scene.dominantScene &&
              sceneBroadcastRelevant &&
              scene.opposingSceneMemberCount > 0
            ) {
              add(
                'sceneRelevance',
                Math.min(9, 5 + scene.sceneRelevance * 4),
                `Dominant scene: ${scene.sceneMemberCount} players; opposition ${scene.opposingSceneMemberCount}`
              )
            } else if (
              highConfidenceDominantScene &&
              scene.dominantSceneScore > scene.sceneScore * 1.45 &&
              scene.sceneScore < scene.dominantSceneScore * 0.7 &&
              !sceneThreatViewActive
            ) {
              add(
                'sceneRelevance',
                -Math.min(12, 3 + (1 - scene.sceneRelevance) * 9),
                `Disconnected from dominant scene (${scene.sceneMemberCount} nearby players)`
              )
            }
            const groupViewCount = sceneThreatViewActive
              ? scene.threatSceneActionableTargetCount
              : localGroupViewAllowed
                ? geometryAware
                  ? scene.threatSceneActionableTargetCount
                  : scene.enemiesInViewCone
                : 0
            const groupViewCoverage = sceneThreatViewActive
              ? scene.threatSceneActionableCoverage
              : geometryAware
                ? scene.threatSceneActionableCoverage
                : scene.enemyGroupCoverage
            if (
              groupViewCount > 0 &&
              (sceneThreatViewActive ||
                (((scene.dominantScene && sceneBroadcastRelevant) || scene.nearbyEnemyCount >= 2) &&
                  localGroupViewAllowed))
            ) {
              add(
                'groupCoverage',
                Math.min(
                  10,
                  groupViewCount * 2 + groupViewCoverage * 5 + (scene.threatSceneExternal ? 1.5 : 0)
                ),
                sceneThreatViewActive
                  ? `Actionable threat view covers ${scene.threatSceneVisibleCount} visible + ${scene.threatScenePeekCount} peekable/${scene.threatSceneTargetCount}`
                  : `View cone covers ${groupViewCount}/${scene.nearbyEnemyCount} nearby enemies`
              )
            }
            const actionableRouteEvidence =
              scene.threatSceneActionableTargetCount > 0 ||
              (scene.incomingGroupPressure >= 0.35 && scene.threatSceneCoverage >= 0.35) ||
              (scene.topologyIncomingRoutePressure >= 0.35 && scene.topologyPeekPotential)
            if (
              scene.routeEntryRelevance > 0.08 &&
              scene.routeEntryTargetCount >= 3 &&
              actionableRouteEvidence
            ) {
              add(
                'routeEntry',
                Math.min(12, scene.routeEntryRelevance * 12),
                `Likely group entry: ${scene.routeEntryTargetCount} targets; ${scene.topologyCallout ?? 'unknown area'}; ${scene.topologyRoutePortalId ?? 'no portal'}; relevance ${Math.round(scene.routeEntryRelevance * 100)}%`
              )
            }
            if (
              scene.incomingGroupPressure > 0.05 &&
              scene.threatSceneTargetCount >= 2 &&
              scene.threatSceneCoverage >= 0.35 &&
              !scene.isolatedNoAction
            ) {
              add(
                'incomingGroupPressure',
                Math.min(14, scene.incomingGroupPressure * 14),
                `Incoming group ${scene.incomingGroupCount}/${scene.threatSceneTargetCount}; heading toward held angle`
              )
            }
            if (
              scene.povQuality > 0.05 &&
              !scene.isolatedNoAction &&
              (sceneThreatViewActive ||
                (scene.dominantScene && sceneBroadcastRelevant) ||
                scene.nearbyEnemyCount >= 2)
            ) {
              add(
                'scenePovQuality',
                Math.min(8, scene.povQuality * 8 * Math.max(0.5, scene.sceneConfidence)),
                sceneThreatViewActive
                  ? `Threat POV: ${groupViewCount}/${scene.threatSceneTargetCount} dominant-scene enemies in view`
                  : `Informative POV: ${Math.round(scene.povQuality * 100)}%; phase ${scene.scenePhase ?? 'forming'}`
              )
            }
            const sceneContactImminence =
              scene.dominantScene && scene.opposingSceneMemberCount === 0
                ? 0
                : scene.contactImminence
            if (
              sceneContactImminence > 0.05 &&
              !scene.isolatedNoAction &&
              (sceneThreatViewActive ||
                (scene.dominantScene && sceneBroadcastRelevant) ||
                scene.nearbyEnemyCount >= 2)
            ) {
              add(
                'contactImminence',
                Math.min(12, sceneContactImminence * 12),
                `Pre-contact pressure ${Math.round(sceneContactImminence * 100)}%`
              )
            }
            if (scene.isolatedNoAction) {
              const emptyThreatAngle =
                scene.threatSceneTargetCount >= 3 && scene.threatSceneActionableTargetCount === 0
              add(
                'isolationPenalty',
                emptyThreatAngle ? -24 : -12,
                emptyThreatAngle
                  ? `Empty threat angle: ${scene.threatSceneTargetCount} enemies in cone, no LOS/peek or incoming route`
                  : 'Isolated player without nearby enemy, objective or recent combat'
              )
            }
            if (
              !scene.isolatedNoAction &&
              scene.topologyRouteAdvisoryAllowed &&
              scene.topologyPortalControlScore >= 0.25 &&
              scene.routeEntryTargetCount >= 1
            ) {
              add(
                'portalControl',
                Math.min(
                  profile.weights.portalControl,
                  scene.topologyPortalControlScore * profile.weights.portalControl
                ),
                `${scene.topologyPlantSite ?? 'route'} ${scene.topologyCallout ?? 'area'} controls ${scene.topologyRoutePortalChokepoint ? 'chokepoint' : 'portal'} ${scene.topologyRoutePortalId ?? 'unknown'}`
              )
            }
            if (
              !scene.isolatedNoAction &&
              scene.topologyRouteAdvisoryAllowed &&
              scene.topologyPredictedFightMs !== null &&
              scene.topologyPredictedFightMs <= 2000 &&
              scene.topologyFightPredictionConfidence >= 0.25
            ) {
              add(
                'fightPrediction',
                Math.min(
                  profile.weights.fightPrediction,
                  (1 - scene.topologyPredictedFightMs / 2000) *
                    profile.weights.fightPrediction *
                    scene.topologyFightPredictionConfidence
                ),
                `Predicted route fight in ~${Math.round(scene.topologyPredictedFightMs)} ms; confidence ${Math.round(scene.topologyFightPredictionConfidence * 100)}%`
              )
            }
            if (scene.topologyRouteAdvisoryAllowed && scene.topologyCrossfirePotential >= 0.25) {
              add(
                'crossfire',
                Math.min(
                  profile.weights.crossfire,
                  scene.topologyCrossfirePotential * profile.weights.crossfire
                ),
                `Crossfire potential on ${scene.topologyCallout ?? 'route portal'}: ${Math.round(scene.topologyCrossfirePotential * 2)} partner(s)`
              )
            }
          }
          if (objectiveSteamId === player.steamId && !objectiveOpponentNearBomb) {
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
          if (
            nearestEnemy &&
            nearestDistance !== null &&
            nearestDistance < 1500 &&
            directionFocus < 0.25 &&
            signal.shotUntil <= at &&
            signal.damageUntil <= at
          ) {
            add(
              'orientationPenalty',
              -Math.min(10, (0.25 - directionFocus) * 40),
              `Looking away from nearest threat (${Math.round(directionFocus * 100)}% directional focus)`
            )
          }
          if (alignment > 0.5 && nearestEnemy) {
            add(
              'aimAlignment',
              profile.weights.aimAlignment * ((alignment - 0.5) * 2) * proximityEvidence,
              `Facing ${nearestEnemy.name} (${Math.round(alignment * 100)}% alignment proxy)`
            )
          }
          if (clutch) {
            add('clutch', profile.weights.clutch, `Last alive versus ${enemyAlive}`)
          }
          const grenadeHasMeaningfulContext = Boolean(
            recentCombatSignal ||
            objectiveSteamId === player.steamId ||
            (nearestCanEngage &&
              nearestDistance !== null &&
              nearestDistance < 900 &&
              alignment > 0.45) ||
            (scene && !scene.isolatedNoAction && scene.threatSceneActionableTargetCount > 0)
          )
          if (grenadeActive && grenadeHasMeaningfulContext) {
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
          if (player.steamId === this.currentSteamId && !scene?.isolatedNoAction) {
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

        const score: PlayerScore = {
          steamId: player.steamId,
          name: player.name,
          team: player.team,
          observerSlot: player.observerSlot,
          alive: player.alive,
          total: Math.round(factors.reduce((sum, factor) => sum + factor.value, 0) * 10) / 10,
          factors: factors.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
          nearestEnemyDistance: nearestDistance === null ? null : Math.round(nearestDistance),
          nearestEnemyHasLineOfSight: playerGeometry?.nearestEnemyHasLineOfSight,
          nearestEnemyHasPeekPotential: playerGeometry?.nearestEnemyHasPeekPotential,
          sceneKey: scene?.sceneKey ?? null,
          sceneScore: scene?.sceneScore ?? 0,
          sceneRelevance: scene?.sceneRelevance ?? 0,
          sceneMemberCount: scene?.sceneMemberCount ?? 0,
          opposingSceneMemberCount: scene?.opposingSceneMemberCount ?? 0,
          enemiesInViewCone: scene?.enemiesInViewCone ?? 0,
          nearbyEnemyCount: scene?.nearbyEnemyCount ?? 0,
          enemyGroupAlignment: scene?.enemyGroupAlignment ?? 0,
          enemyGroupCoverage: scene?.enemyGroupCoverage ?? 0,
          contactImminence: scene?.contactImminence ?? 0,
          routeEntryRelevance: scene?.routeEntryRelevance ?? 0,
          routeEntryTargetCount: scene?.routeEntryTargetCount ?? 0,
          topologyCallout: scene?.topologyCallout ?? null,
          topologyTacticalRoles: scene?.topologyTacticalRoles ?? [],
          topologyPlantSite: scene?.topologyPlantSite ?? null,
          topologyRoutePortalId: scene?.topologyRoutePortalId ?? null,
          topologyRouteDistance: scene?.topologyRouteDistance ?? null,
          topologyRoutePortalChokepoint: scene?.topologyRoutePortalChokepoint ?? false,
          topologyPortalControlScore: scene?.topologyPortalControlScore ?? 0,
          topologyDefensiveAngleScore: scene?.topologyDefensiveAngleScore ?? 0,
          topologyCrossfirePotential: scene?.topologyCrossfirePotential ?? 0,
          topologyRouteConvergence: scene?.topologyRouteConvergence ?? 0,
          topologyPeekPotential: scene?.topologyPeekPotential ?? false,
          topologyPeekPortalCount: scene?.topologyPeekPortalCount ?? 0,
          topologyIncomingRoutePressure: scene?.topologyIncomingRoutePressure ?? 0,
          topologyPredictedFightMs: scene?.topologyPredictedFightMs ?? null,
          topologyFightPredictionConfidence: scene?.topologyFightPredictionConfidence ?? 0,
          topologyVerticalSeparation: scene?.topologyVerticalSeparation ?? null,
          topologyRouteAdvisoryAllowed: scene?.topologyRouteAdvisoryAllowed ?? false,
          incomingGroupPressure: scene?.incomingGroupPressure ?? 0,
          scenePhase: scene?.scenePhase ?? null,
          sceneConfidence: scene?.sceneConfidence ?? 0,
          movementMagnitude: scene?.movementMagnitude ?? 0,
          approachPressure: scene?.approachPressure ?? 0,
          povQuality: scene?.povQuality ?? 0,
          threatSceneKey: scene?.threatSceneKey ?? null,
          threatSceneTargetCount: scene?.threatSceneTargetCount ?? 0,
          threatSceneEnemiesInViewCone: scene?.threatSceneEnemiesInViewCone ?? 0,
          threatSceneAlignment: scene?.threatSceneAlignment ?? 0,
          threatSceneCoverage: scene?.threatSceneCoverage ?? 0,
          threatSceneActionableTargetCount: scene?.threatSceneActionableTargetCount ?? 0,
          threatSceneActionableCoverage: scene?.threatSceneActionableCoverage ?? 0,
          threatSceneVisibleCount: scene?.threatSceneVisibleCount ?? 0,
          threatScenePeekCount: scene?.threatScenePeekCount ?? 0,
          threatSceneExternal: scene?.threatSceneExternal ?? false,
          isolatedNoAction: scene?.isolatedNoAction ?? false,
          switchEligible: player.alive && player.observerSlot >= 0 && player.observerSlot <= 9
        }
        const advisoryResults = player.alive ? (advisory?.(player, score, players) ?? []) : []
        for (const advisoryResult of advisoryResults) {
          if (!Number.isFinite(advisoryResult.value)) continue
          const value = Math.max(-18, Math.min(18, advisoryResult.value))
          if (Math.abs(value) >= 0.05) {
            score.factors.push({
              key: advisoryResult.key,
              label: FACTOR_LABELS[advisoryResult.key],
              value: Math.round(value * 10) / 10,
              detail: advisoryResult.detail
            })
            score.total = Math.round((score.total + value) * 10) / 10
            score.factors.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
          }
        }
        return score
      })
      .sort(
        (a, b) =>
          b.total - a.total || a.observerSlot - b.observerSlot || a.steamId.localeCompare(b.steamId)
      )

    for (const score of scores) {
      const currentStreak = this.routeEntryStreaks.get(score.steamId) ?? 0
      this.routeEntryStreaks.set(
        score.steamId,
        score.routeEntryRelevance !== undefined && score.routeEntryRelevance >= 0.55
          ? Math.min(3, currentStreak + 1)
          : 0
      )
      const actionableRouteStreak = this.actionableRouteStreaks.get(score.steamId) ?? 0
      this.actionableRouteStreaks.set(
        score.steamId,
        (score.routeEntryRelevance ?? 0) >= 0.25 &&
          (score.routeEntryTargetCount ?? 0) >= 3 &&
          (score.threatSceneActionableTargetCount ?? 0) > 0
          ? Math.min(3, actionableRouteStreak + 1)
          : 0
      )
    }

    const currentScore = scores.find((score) => score.steamId === this.currentSteamId) ?? null
    const ranked =
      settings.rulesEnabled || advisory ? scores.filter((score) => score.switchEligible) : []
    const requestedOverride = settings.manualOverrideSteamId
      ? (ranked.find((score) => score.steamId === settings.manualOverrideSteamId) ?? null)
      : null
    const objectiveScore =
      objectiveSteamId && !objectiveOpponentNearBomb
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
    } else if (
      objectiveSteamId &&
      playersById.get(objectiveSteamId)?.alive &&
      !objectiveOpponentNearBomb
    ) {
      shouldSwitch = objectiveSteamId !== this.currentSteamId
      const objectivePlayer = scores.find((score) => score.steamId === objectiveSteamId)
      reason = shouldSwitch
        ? `Hard objective lock: ${bombState} by ${objectivePlayer?.name ?? objectiveSteamId}`
        : `Holding ${bombState} objective action`
      lockKind = 'objective'
    } else if (!currentScore) {
      shouldSwitch = best.steamId !== this.currentSteamId
      reason = `Initial target: ${best.name}`
    } else if (!currentScore.alive) {
      const deathUntil = this.signals.get(currentScore.steamId)?.deathUntil ?? 0
      if (deathUntil > at) {
        reason = `Post-death hold on ${currentScore.name}`
        lockKind = 'post-death'
        lockUntil = deathUntil
      } else {
        shouldSwitch = best.steamId !== this.currentSteamId
        reason = `${currentScore.name} died; selecting ${best.name}`
      }
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
      const staleCombatOnEmptyAngle =
        currentScore.isolatedNoAction &&
        currentScore.threatSceneActionableTargetCount === 0 &&
        !currentScore.nearestEnemyHasLineOfSight &&
        !currentScore.nearestEnemyHasPeekPotential
      const mlValue = (score: PlayerScore): number =>
        score.factors.find((factor) => factor.key === 'mlAdvisory')?.value ?? 0
      const predictiveTransition = mlValue(best) >= 6 && mlValue(best) >= mlValue(currentScore) + 4
      const predictiveDwellReleased =
        at >= this.switchedAt + Math.min(900, Math.round(profile.minDwellMs * 0.4))

      if (postKillUntil > at) {
        reason = `Post-kill hold on ${currentScore.name}`
        lockKind = 'post-kill'
        lockUntil = postKillUntil
      } else if (combatUntil > at && !staleCombatOnEmptyAngle && !predictiveTransition) {
        reason = `Combat soft lock on ${currentScore.name}`
        lockKind = 'combat'
        lockUntil = combatUntil
      } else if (dwellUntil > at && !(predictiveTransition && predictiveDwellReleased)) {
        reason = `Minimum dwell on ${currentScore.name}`
        lockKind = 'minimum-dwell'
        lockUntil = dwellUntil
      } else {
        const routeEntryTransition =
          (best.routeEntryRelevance ?? 0) >= 0.55 &&
          (best.routeEntryRelevance ?? 0) >= (currentScore.routeEntryRelevance ?? 0) + 0.3 &&
          (best.routeEntryTargetCount ?? 0) >= 3 &&
          (this.routeEntryStreaks.get(best.steamId) ?? 0) >= 2
        const emptyAngleRecovery =
          Boolean(currentScore.isolatedNoAction) &&
          (best.routeEntryRelevance ?? 0) >= 0.25 &&
          (best.routeEntryTargetCount ?? 0) >= 3 &&
          (best.threatSceneActionableTargetCount ?? 0) > 0 &&
          (this.actionableRouteStreaks.get(best.steamId) ?? 0) >= 2
        const effectiveSwitchMargin = predictiveTransition
          ? Math.max(4, profile.switchMargin * 0.35)
          : routeEntryTransition || emptyAngleRecovery
            ? Math.max(5, profile.switchMargin * 0.45)
            : profile.switchMargin
        if (best.total >= currentScore.total + effectiveSwitchMargin) {
          shouldSwitch = true
          reason = predictiveTransition
            ? `${best.name} has a stronger pre-contact prediction and leads ${currentScore.name} by ${(best.total - currentScore.total).toFixed(1)} points`
            : emptyAngleRecovery
              ? `${best.name} recovered an actionable group route while ${currentScore.name} holds an empty angle and leads by ${(best.total - currentScore.total).toFixed(1)} points`
              : routeEntryTransition
                ? `${best.name} owns a stable group-entry route and leads ${currentScore.name} by ${(best.total - currentScore.total).toFixed(1)} points`
                : `${best.name} leads ${currentScore.name} by ${(best.total - currentScore.total).toFixed(1)} points`
        } else {
          reason = `${best.name} does not clear the ${effectiveSwitchMargin}-point switch margin`
        }
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
      lockUntil,
      dominantSceneKey: trackedScene?.key ?? null,
      dominantSceneScore: trackedScene?.score ?? 0,
      currentSceneKey: currentScore?.sceneKey ?? null,
      currentSceneScore: currentScore?.sceneScore ?? 0,
      dominantScenePhase: trackedScene?.phase ?? null,
      dominantSceneConfidence: trackedScene?.confidence ?? 0,
      currentScenePhase: currentScore?.scenePhase ?? null,
      currentSceneConfidence: currentScore?.sceneConfidence ?? 0
    }
  }
}
