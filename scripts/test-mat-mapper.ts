import assert from 'node:assert/strict'
import { mapMatch, mapPlayer, mapTeam } from '../src/main/server/integrations/mat.mapper'
import type { MatHudProjectionV1 } from '../src/main/server/integrations/mat.types'
import { resolveAssetUrl } from '../src/renderer/src/utils/assetUrl'

const player = {
  id: '76561198000000001',
  steamId: '76561198000000001',
  nickname: 'aurum',
  firstName: 'Aurimas',
  lastName: 'Operator',
  avatarUrl: 'https://mat.example/avatar.png',
  photoUrl: 'https://mat.example/photo.webp',
  countryCode: 'LT',
  teamId: 'team-a'
}

const team1 = {
  id: 'team-a',
  name: 'Bebra Team',
  tag: 'BEBRA',
  countryCode: 'LT',
  logoUrl: 'https://mat.example/team-a.webp',
  players: [player]
}

const team2 = {
  id: 'team-b',
  name: 'Fox Team',
  tag: 'FOX',
  countryCode: 'LV',
  logoUrl: null,
  players: []
}

const projection: MatHudProjectionV1 = {
  contract: 'bebraland-mat-hud',
  version: 1,
  revision: 'fixture-1',
  generatedAt: '2026-07-30T20:00:00.000Z',
  tournament: { id: '1', name: 'Bebra Cup', type: 'double_elimination', status: 'in_progress' },
  match: {
    id: '42',
    numericId: 42,
    slug: 'bebra-vs-fox',
    round: 2,
    roundLabel: 'Upper Bracket Final',
    bracket: 'WB',
    format: 'bo3',
    status: 'live',
    operatorState: 'queued',
    currentMap: 'de_mirage',
    currentMapNumber: 2,
    team1,
    team2,
    seriesScore: { team1: 1, team2: 0 },
    veto: {
      status: 'completed',
      actions: [
        { step: 1, teamId: 'team-b', type: 'ban', mapName: 'de_nuke', side: null },
        { step: 2, teamId: 'team-a', type: 'pick', mapName: 'de_cache', side: null },
        { step: 3, teamId: 'team-b', type: 'side', mapName: 'de_cache', side: 'T' },
        { step: 4, teamId: null, type: 'decider', mapName: 'de_mirage', side: null }
      ]
    },
    maps: [
      {
        number: 1,
        name: 'de_cache',
        pickedByTeamId: 'team-a',
        startingSideTeam1: 'T',
        score: { team1: 13, team2: 8 },
        winnerTeamId: 'team-a',
        completedAt: '2026-07-30T20:40:00.000Z'
      },
      {
        number: 2,
        name: 'de_mirage',
        pickedByTeamId: null,
        startingSideTeam1: 'CT',
        score: null,
        winnerTeamId: null,
        completedAt: null
      }
    ],
    simulation: false,
    confirmedWinnerTeamId: null
  }
}

const mappedPlayer = mapPlayer(player)
assert.equal(mappedPlayer.username, 'aurum')
assert.equal(mappedPlayer.avatar, player.photoUrl)
assert.equal(mapPlayer({ ...player, photoUrl: null }, undefined, true).avatar, player.avatarUrl)
assert.equal(mapPlayer({ ...player, photoUrl: null }).avatar, '')
assert.equal(mappedPlayer.country, 'LT')
assert.equal(mappedPlayer.team, 'team-a')
assert.equal(
  mapPlayer(
    { ...player, photoUrl: '/broadcast-assets/players/player.webp' },
    'http://localhost:3069'
  ).avatar,
  'http://localhost:3069/broadcast-assets/players/player.webp'
)

const mappedTeam = mapTeam(team1)
assert.equal(mappedTeam.shortName, 'BEBRA')
assert.equal(mappedTeam.logo, team1.logoUrl)
assert.equal(
  mapTeam({ ...team1, logoUrl: '/broadcast-assets/teams/team-a.webp' }, 'http://localhost:3069')
    .logo,
  'http://localhost:3069/broadcast-assets/teams/team-a.webp'
)

const match = mapMatch(projection)
if (!match) throw new Error('Expected MAT match to map')
assert.equal(match.matchType, 'bo3')
assert.deepEqual(match.left, { id: 'team-a', wins: 1 })
assert.deepEqual(match.right, { id: 'team-b', wins: 0 })
const cache = match.vetos.find((veto) => veto.mapName === 'de_cache')
if (!cache) throw new Error('Expected de_cache veto')
assert.equal(cache.type, 'pick')
assert.equal(cache.side, 'T')
assert.equal(cache.reverseSide, true)
assert.equal(cache.mapEnd, true)
assert.deepEqual(cache.score, { 'team-a': 13, 'team-b': 8 })
assert.equal(cache.winner, 'team-a')
assert.equal(match.vetos.find((veto) => veto.mapName === 'de_mirage')?.type, 'decider')
assert.equal(
  resolveAssetUrl(
    'https://mat.example/broadcast-assets/teams/team-a.webp',
    'http://localhost:1349'
  ),
  'https://mat.example/broadcast-assets/teams/team-a.webp'
)
assert.equal(
  resolveAssetUrl('/api/uploads/local-team.webp', 'http://localhost:1349'),
  'http://localhost:1349/api/uploads/local-team.webp'
)

console.log('MAT mapper fixture passed: profiles, veto, finished map and BO3 series 1:0')
