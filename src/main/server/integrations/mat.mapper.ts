import type { Match, Veto } from '../domains/matches/match.types'
import type { Team } from '../domains/teams/team.types'
import type { Player } from '../domains/players/player.types'
import type { MatHudProjectionV1 } from './mat.types'

function resolveMatAssetUrl(url: string | null, matUrl?: string, cacheBust?: number): string {
  if (!url) return ''
  if (/^(?:data:|blob:)/i.test(url)) return url
  const resolved =
    /^(?:https?:)/i.test(url) || !matUrl ? url : new URL(url, matUrl + '/').toString()
  if (!cacheBust || !/^https?:/i.test(resolved)) return resolved
  const parsed = new URL(resolved)
  parsed.searchParams.set('jtsHud', String(cacheBust))
  return parsed.toString()
}

export function mapTeam(
  team: NonNullable<MatHudProjectionV1['match']>['team1'],
  matUrl?: string,
  cacheBust?: number
): Team {
  return {
    _id: team.id,
    name: team.name,
    country: team.countryCode || '',
    shortName: team.tag,
    logo: resolveMatAssetUrl(team.logoUrl, matUrl, cacheBust),
    extra: { source: 'mat' }
  }
}

export function mapPlayer(
  player: NonNullable<MatHudProjectionV1['match']>['team1']['players'][number],
  matUrl?: string
): Player {
  return {
    _id: player.id,
    firstName: player.firstName || '',
    lastName: player.lastName || '',
    username: player.nickname,
    avatar: resolveMatAssetUrl(player.photoUrl || player.avatarUrl, matUrl),
    country: player.countryCode || '',
    steamid: player.steamId,
    team: player.teamId,
    isCoach: false,
    extra: { source: 'mat' }
  }
}

export function mapMatch(projection: MatHudProjectionV1): Match | null {
  const source = projection.match
  if (!source) return null

  const vetoByMap = new Map<string, Veto>()
  for (const action of source.veto.actions) {
    if (action.type === 'side') {
      const existing = vetoByMap.get(action.mapName)
      if (existing && action.side) existing.side = action.side
      continue
    }
    vetoByMap.set(action.mapName, {
      teamId: action.teamId || '',
      mapName: action.mapName,
      side: action.side || 'NO',
      type: action.type,
      reverseSide: false,
      mapEnd: false
    })
  }

  for (const map of source.maps) {
    const veto = vetoByMap.get(map.name) || {
      teamId: map.pickedByTeamId || '',
      mapName: map.name,
      side: 'NO' as const,
      type: map.pickedByTeamId ? ('pick' as const) : ('decider' as const),
      reverseSide: false,
      mapEnd: false
    }
    veto.reverseSide = map.startingSideTeam1 === 'T'
    veto.mapEnd = map.score !== null
    if (map.score) {
      veto.score = {
        [source.team1.id]: map.score.team1,
        [source.team2.id]: map.score.team2
      }
    }
    if (map.winnerTeamId) veto.winner = map.winnerTeamId
    vetoByMap.set(map.name, veto)
  }

  return {
    id: `mat:${source.id}`,
    current: true,
    left: { id: source.team1.id, wins: source.seriesScore.team1 },
    right: { id: source.team2.id, wins: source.seriesScore.team2 },
    matchType: source.format,
    vetos: Array.from(vetoByMap.values())
  }
}
