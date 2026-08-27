import type { CSGORaw } from 'csgogsi'
import type { Player } from '../domains/players/player.types'
import type { Team } from '../domains/teams/team.types'

export interface ChallongeParticipant {
  id: string
  name: string
  misc?: string | null
  groupId?: string | null
}

export interface ChallongeMatch {
  id: string
  state: string
  round: number | null
  identifier: string | null
  stageName?: string | null
  winnerId: string | null
  player1Id: string | null
  player2Id: string | null
  groupId?: string | null
}

export interface ChallongeBracket {
  tournamentName: string
  tournamentType: string | null
  participants: ChallongeParticipant[]
  matches: ChallongeMatch[]
}

type PublicModuleMatch = {
  id?: number | string | null
  identifier?: number | string | null
  raw_identifier?: string | null
  round?: number | null
  state?: string | null
  winner_id?: number | string | null
  group_id?: number | string | null
  player1?: PublicModulePlayer | null
  player2?: PublicModulePlayer | null
}

type PublicModulePlayer = {
  id?: number | string | null
  display_name?: string | null
  name?: string | null
  misc?: string | null
}

type PublicModuleStore = {
  tournament?: {
    id?: number | string | null
    tournament_type?: string | null
  }
  rounds?: Array<{ number?: number | null; title?: string | null }>
  matches_by_round?: Record<string, PublicModuleMatch[]>
}

export interface ResolvedChallongeMatch {
  match: ChallongeMatch
  team1: ChallongeParticipant
  team2: ChallongeParticipant
  stage: string
}

type LiveSide = {
  name: string
  id: string
  clanNames: string[]
  steamIds: string[]
  teamIds: string[]
}

const normalize = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const namesForTeam = (team: Team): string[] => {
  const extra = team.extra || {}
  return [
    team.name,
    team.shortName,
    extra.challongeName,
    extra.challonge_name,
    extra.challongeTag,
    extra.challonge_tag
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

const nameMatches = (left: string, right: string): boolean => {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return false
  return a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)))
}

const buildLiveSide = (
  raw: CSGORaw,
  side: 'CT' | 'T',
  players: Player[],
  teams: Team[]
): LiveSide => {
  const rawTeam = side === 'CT' ? raw.map?.team_ct : raw.map?.team_t
  const livePlayers = Object.entries(raw.allplayers || {}).filter(
    ([, player]) => player.team === side
  )
  const playerBySteamId = new Map(players.map((player) => [player.steamid, player]))
  const teamIds = new Set<string>()
  const clanNames = new Set<string>()

  for (const [steamId, player] of livePlayers) {
    const profile = playerBySteamId.get(steamId)
    if (profile?.team) teamIds.add(profile.team)
    if (player.clan) clanNames.add(player.clan)
  }

  const teamNames = teams.filter((team) => teamIds.has(team._id)).flatMap(namesForTeam)

  return {
    name: rawTeam?.name || '',
    id: (rawTeam as { id?: string } | undefined)?.id || '',
    clanNames: [...clanNames, ...teamNames],
    steamIds: livePlayers.map(([steamId]) => steamId),
    teamIds: [...teamIds]
  }
}

const participantScore = (
  participant: ChallongeParticipant,
  live: LiveSide,
  teams: Team[]
): number => {
  const candidateNames = [live.name, live.id, ...live.clanNames]
  if (candidateNames.some((name) => nameMatches(name, participant.name))) return 100

  const mappedTeam = teams.find((team) => live.teamIds.includes(team._id))
  if (!mappedTeam) return 0
  if (namesForTeam(mappedTeam).some((name) => nameMatches(name, participant.name))) return 95

  const participantId = normalize(participant.misc)
  const teamId = normalize(mappedTeam.extra?.challongeParticipantId)
  return participantId && teamId && participantId === teamId ? 110 : 0
}

const stageLabel = (match: ChallongeMatch, tournamentType: string | null): string => {
  if (match.groupId)
    return `Group ${match.groupId}${match.identifier ? ` · Match ${match.identifier}` : ''}`
  if (match.round === null)
    return match.identifier ? `Match ${match.identifier}` : 'Tournament Match'
  if (match.stageName)
    return `${match.stageName}${match.identifier ? ` · Match ${match.identifier}` : ''}`
  if (match.round < 0) {
    return `Lower Bracket · Round ${Math.abs(match.round)}${match.identifier ? ` · Match ${match.identifier}` : ''}`
  }
  const prefix = tournamentType?.toLowerCase().includes('double') ? 'Upper Bracket · ' : ''
  return `${prefix}Round ${match.round}${match.identifier ? ` · Match ${match.identifier}` : ''}`
}

const matchPriority = (match: ChallongeMatch): number => {
  switch (match.state.toLowerCase()) {
    case 'underway':
    case 'in_progress':
      return 40
    case 'open':
      return 30
    case 'pending':
      return 20
    case 'complete':
      return 0
    default:
      return 10
  }
}

export const resolveChallongeMatch = (
  bracket: ChallongeBracket,
  raw: CSGORaw,
  players: Player[] = [],
  teams: Team[] = []
): ResolvedChallongeMatch | null => {
  const liveSides = [
    buildLiveSide(raw, 'CT', players, teams),
    buildLiveSide(raw, 'T', players, teams)
  ]
  const participantScores = new Map(
    bracket.participants.map((participant) => [
      participant.id,
      liveSides.map((live) => participantScore(participant, live, teams))
    ])
  )

  const candidates = bracket.matches
    .map((match) => {
      const first = match.player1Id ? participantScores.get(match.player1Id)?.[0] || 0 : 0
      const second = match.player2Id ? participantScores.get(match.player2Id)?.[1] || 0 : 0
      const swappedFirst = match.player1Id ? participantScores.get(match.player1Id)?.[1] || 0 : 0
      const swappedSecond = match.player2Id ? participantScores.get(match.player2Id)?.[0] || 0 : 0
      return { match, score: Math.max(first + second, swappedFirst + swappedSecond) }
    })
    .filter(({ match, score }) => match.player1Id && match.player2Id && score >= 190)
    .sort((a, b) => matchPriority(b.match) - matchPriority(a.match))

  const selected = candidates[0]
  if (!selected) return null
  const team1 = bracket.participants.find(
    (participant) => participant.id === selected.match.player1Id
  )
  const team2 = bracket.participants.find(
    (participant) => participant.id === selected.match.player2Id
  )
  if (!team1 || !team2) return null
  return {
    match: selected.match,
    team1,
    team2,
    stage: stageLabel(selected.match, bracket.tournamentType)
  }
}

export const normalizeChallongeResponseRecord = (record: any): any => {
  if (!record || typeof record !== 'object') return {}
  return record.attributes && typeof record.attributes === 'object'
    ? { ...record.attributes, id: record.id ?? record.attributes.id }
    : record
}

const readJsonObject = (source: string, start: number): unknown => {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}' && --depth === 0) return JSON.parse(source.slice(start, index + 1))
  }
  throw new Error('Challonge public bracket data is incomplete')
}

export const parseChallongeModule = (html: string, fallbackName = ''): ChallongeBracket => {
  const marker = "window._initialStoreState['TournamentStore']"
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) throw new Error('Challonge public bracket data was not found')
  const objectStart = html.indexOf('{', markerIndex)
  if (objectStart < 0) throw new Error('Challonge public bracket data was not found')

  const store = readJsonObject(html, objectStart) as PublicModuleStore
  const tournamentId = String(store.tournament?.id ?? 'public')
  const stageNames = new Map(
    (store.rounds || [])
      .filter((round) => round.number !== null && round.number !== undefined && round.title)
      .map((round) => [String(round.number), String(round.title)])
  )
  const participants = new Map<string, ChallongeParticipant>()
  const matches = Object.values(store.matches_by_round || {})
    .flat()
    .map((record, index): ChallongeMatch => {
      const addParticipant = (player: PublicModulePlayer | null | undefined): string | null => {
        if (player?.id === null || player?.id === undefined) return null
        const id = String(player.id)
        participants.set(id, {
          id,
          name: String(player.display_name || player.name || ''),
          misc: player.misc ?? null
        })
        return id
      }

      return {
        id: String(record.id ?? `${tournamentId}:${record.identifier ?? index}`),
        state: String(record.state || 'pending'),
        round: record.round === null || record.round === undefined ? null : Number(record.round),
        identifier:
          record.raw_identifier !== null && record.raw_identifier !== undefined
            ? String(record.raw_identifier)
            : record.identifier === null || record.identifier === undefined
              ? null
              : String(record.identifier),
        stageName: stageNames.get(String(record.round)) || null,
        winnerId:
          record.winner_id === null || record.winner_id === undefined
            ? null
            : String(record.winner_id),
        player1Id: addParticipant(record.player1),
        player2Id: addParticipant(record.player2),
        groupId:
          record.group_id === null || record.group_id === undefined ? null : String(record.group_id)
      }
    })

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const tournamentName = (title || '').replace(/\s*-\s*Challonge\s*$/i, '').trim() || fallbackName
  return {
    tournamentName,
    tournamentType: store.tournament?.tournament_type || null,
    participants: [...participants.values()],
    matches
  }
}

export const extractRelationshipId = (record: any, name: string): string | null => {
  const attributes = normalizeChallongeResponseRecord(record)
  const direct = attributes[`${name}Id`] ?? attributes[`${name}_id`]
  if (direct !== undefined && direct !== null) return String(direct)
  const relationship = attributes.relationships?.[name] ?? record?.relationships?.[name]
  const id = relationship?.data?.id
  return id === undefined || id === null ? null : String(id)
}
