import assert from 'node:assert/strict'
import {
  parseChallongeModule,
  resolveChallongeMatch,
  type ChallongeBracket
} from '../src/main/server/integrations/challonge.resolver'

const team = (id: string, name: string, shortName: string) => ({
  _id: id,
  name,
  shortName,
  country: '',
  logo: '',
  extra: {}
})

const player = (steamid: string, teamId: string) => ({
  _id: steamid,
  firstName: '',
  lastName: '',
  username: steamid,
  avatar: '',
  country: '',
  steamid,
  team: teamId,
  isCoach: false,
  extra: {}
})

const raw = {
  provider: {} as any,
  map: {
    team_ct: {
      name: 'Alpha',
      score: 0,
      consecutive_round_losses: 0,
      timeouts_remaining: 4,
      matches_won_this_series: 0
    },
    team_t: {
      name: 'Beta',
      score: 0,
      consecutive_round_losses: 0,
      timeouts_remaining: 4,
      matches_won_this_series: 0
    }
  },
  allplayers: {
    a1: { team: 'CT' },
    a2: { team: 'CT' },
    b1: { team: 'T' },
    b2: { team: 'T' }
  }
} as any

const bracket: ChallongeBracket = {
  tournamentName: 'Test Cup',
  tournamentType: 'double_elimination',
  participants: [
    { id: '1', name: 'Alpha' },
    { id: '2', name: 'Beta' }
  ],
  matches: [
    {
      id: 'old',
      state: 'complete',
      round: 1,
      identifier: 'A',
      winnerId: '1',
      player1Id: '1',
      player2Id: '2'
    },
    {
      id: 'live',
      state: 'open',
      round: -2,
      identifier: 'B',
      winnerId: null,
      player1Id: '1',
      player2Id: '2'
    }
  ]
}

const resolved = resolveChallongeMatch(
  bracket,
  raw,
  [player('a1', 'alpha'), player('a2', 'alpha'), player('b1', 'beta'), player('b2', 'beta')],
  [team('alpha', 'Alpha', 'A'), team('beta', 'Beta', 'B')]
)

assert.ok(resolved)
assert.equal(resolved.match.id, 'live')
assert.equal(resolved.stage, 'Lower Bracket · Round 2 · Match B')
console.log('Challonge resolver fixture passed: GSI roster selects the live lower-bracket match')

const moduleBracket = parseChallongeModule(`
  <title>Test Cup - Challonge</title>
  <script>
    window._initialStoreState['TournamentStore'] = ${JSON.stringify({
      tournament: { id: 42, tournament_type: 'single elimination' },
      rounds: [{ number: 1, title: 'Semifinals' }],
      matches_by_round: {
        '1': [
          {
            identifier: 1,
            raw_identifier: 'A',
            round: 1,
            state: 'open',
            player1: { id: 7, display_name: 'Alpha' },
            player2: { id: 8, display_name: 'Beta' }
          }
        ]
      }
    })};
  </script>
`)

assert.equal(moduleBracket.tournamentName, 'Test Cup')
assert.equal(moduleBracket.matches[0].stageName, 'Semifinals')
assert.equal(moduleBracket.matches[0].identifier, 'A')
assert.deepEqual(
  moduleBracket.participants.map(({ name }) => name),
  ['Alpha', 'Beta']
)
console.log('Challonge module fixture passed: public HTML becomes a bracket without credentials')
