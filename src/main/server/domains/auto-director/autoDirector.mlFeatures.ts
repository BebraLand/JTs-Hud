import type { PlayerGeometryFeatures } from './geometry/geometryFeatures'
import type { DirectorPlayer, PlayerScore, ScoreFactorKey } from './autoDirector.types'
import type { TemporalPlayerFeatures } from './autoDirector.temporal'

export const AUTO_DIRECTOR_ML_FEATURES = [
  'team_t',
  'health',
  'armor',
  'flashed',
  'ammo_clip',
  'round_kills',
  'round_damage',
  'has_bomb',
  'nearest_enemy_distance',
  'alive_teammates',
  'alive_enemies',
  'round_elapsed_ms',
  'rule_score',
  'geometry_available',
  'visible_enemy_count',
  'nearest_visible_enemy_distance',
  'nearest_enemy_has_los',
  'nearest_enemy_has_peek_potential',
  'peek_potential_enemy_count',
  'best_visible_aim_alignment',
  'speed_500',
  'speed_1500',
  'acceleration',
  'enemy_closing_speed_500',
  'aim_turn_rate_500',
  'movement_aim_alignment',
  'history_ms',
  'contact_imminence',
  'route_entry_relevance',
  'topology_route_distance',
  'topology_route_convergence',
  'topology_incoming_pressure',
  'topology_predicted_fight_ms',
  'topology_fight_confidence',
  'topology_portal_control',
  'topology_crossfire',
  'incoming_group_pressure',
  'pov_quality',
  'factor_base',
  'factor_objective',
  'factor_combat',
  'factor_damage',
  'factor_recentKill',
  'factor_proximity',
  'factor_aimAlignment',
  'factor_clutch',
  'factor_grenade',
  'factor_entry',
  'factor_retake',
  'factor_weaponPressure',
  'factor_bombCarrier',
  'factor_lowHealthDrama',
  'factor_flashPenalty',
  'weapon_pistol',
  'weapon_rifle',
  'weapon_sniperrifle',
  'weapon_submachine_gun',
  'weapon_shotgun',
  'weapon_machine_gun',
  'weapon_grenade',
  'weapon_knife',
  'weapon_c4'
] as const

const factorValue = (score: PlayerScore, key: ScoreFactorKey): number =>
  score.factors.find((factor) => factor.key === key)?.value ?? 0

const weaponFeature = (player: DirectorPlayer, type: string): number =>
  player.weaponType.toLowerCase().replaceAll(/[^a-z0-9]/g, '') ===
  type.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
    ? 1
    : 0

export const buildAutoDirectorMlFeatures = (
  player: DirectorPlayer,
  score: PlayerScore,
  players: DirectorPlayer[],
  roundElapsedMs: number,
  geometry: PlayerGeometryFeatures | null,
  geometryAvailable: boolean,
  temporal: TemporalPlayerFeatures | null = null,
  requestedFeatures: readonly string[] = AUTO_DIRECTOR_ML_FEATURES
): number[] => {
  const alivePlayers = players.filter((candidate) => candidate.alive)
  const aliveTeammates = Math.max(
    0,
    alivePlayers.filter((candidate) => candidate.team === player.team).length - 1
  )
  const aliveEnemies = alivePlayers.filter(
    (candidate) => candidate.team !== player.team && candidate.team !== ''
  ).length
  const values: Record<(typeof AUTO_DIRECTOR_ML_FEATURES)[number], number> = {
    team_t: player.team === 'T' ? 1 : 0,
    health: player.health,
    armor: player.armor,
    flashed: player.flashed,
    ammo_clip: player.ammoClip ?? -1,
    round_kills: player.roundKills,
    round_damage: player.roundDamage,
    has_bomb: player.hasBomb ? 1 : 0,
    nearest_enemy_distance: score.nearestEnemyDistance ?? -1,
    alive_teammates: aliveTeammates,
    alive_enemies: aliveEnemies,
    round_elapsed_ms: roundElapsedMs,
    rule_score: score.total,
    geometry_available: geometryAvailable ? 1 : 0,
    visible_enemy_count: geometry?.visibleEnemyCount ?? 0,
    nearest_visible_enemy_distance: geometry?.nearestVisibleEnemyDistance ?? -1,
    nearest_enemy_has_los: geometry?.nearestEnemyHasLineOfSight ? 1 : 0,
    nearest_enemy_has_peek_potential: geometry?.nearestEnemyHasPeekPotential ? 1 : 0,
    peek_potential_enemy_count: geometry?.peekPotentialEnemyCount ?? 0,
    best_visible_aim_alignment: geometry?.bestVisibleAimAlignment ?? 0,
    speed_500: temporal?.speed500 ?? 0,
    speed_1500: temporal?.speed1500 ?? 0,
    acceleration: temporal?.acceleration ?? 0,
    enemy_closing_speed_500: temporal?.enemyClosingSpeed500 ?? 0,
    aim_turn_rate_500: temporal?.aimTurnRate500 ?? 0,
    movement_aim_alignment: temporal?.movementAimAlignment ?? 0,
    history_ms: temporal?.historyMs ?? 0,
    contact_imminence: score.contactImminence ?? 0,
    route_entry_relevance: score.routeEntryRelevance ?? 0,
    topology_route_distance: score.topologyRouteDistance ?? -1,
    topology_route_convergence: score.topologyRouteConvergence ?? 0,
    topology_incoming_pressure: score.topologyIncomingRoutePressure ?? 0,
    topology_predicted_fight_ms: score.topologyPredictedFightMs ?? -1,
    topology_fight_confidence: score.topologyFightPredictionConfidence ?? 0,
    topology_portal_control: score.topologyPortalControlScore ?? 0,
    topology_crossfire: score.topologyCrossfirePotential ?? 0,
    incoming_group_pressure: score.incomingGroupPressure ?? 0,
    pov_quality: score.povQuality ?? 0,
    factor_base: factorValue(score, 'base'),
    factor_objective: factorValue(score, 'objective'),
    factor_combat: factorValue(score, 'combat'),
    factor_damage: factorValue(score, 'damage'),
    factor_recentKill: factorValue(score, 'recentKill'),
    factor_proximity: factorValue(score, 'proximity'),
    factor_aimAlignment: factorValue(score, 'aimAlignment'),
    factor_clutch: factorValue(score, 'clutch'),
    factor_grenade: factorValue(score, 'grenade'),
    factor_entry: factorValue(score, 'entry'),
    factor_retake: factorValue(score, 'retake'),
    factor_weaponPressure: factorValue(score, 'weaponPressure'),
    factor_bombCarrier: factorValue(score, 'bombCarrier'),
    factor_lowHealthDrama: factorValue(score, 'lowHealthDrama'),
    factor_flashPenalty: factorValue(score, 'flashPenalty'),
    weapon_pistol: weaponFeature(player, 'pistol'),
    weapon_rifle: weaponFeature(player, 'rifle'),
    weapon_sniperrifle: weaponFeature(player, 'sniper rifle'),
    weapon_submachine_gun: weaponFeature(player, 'submachine gun'),
    weapon_shotgun: weaponFeature(player, 'shotgun'),
    weapon_machine_gun: weaponFeature(player, 'machine gun'),
    weapon_grenade: weaponFeature(player, 'grenade'),
    weapon_knife: weaponFeature(player, 'knife'),
    weapon_c4: weaponFeature(player, 'C4')
  }
  return requestedFeatures.map((feature) => values[feature as keyof typeof values] ?? 0)
}
