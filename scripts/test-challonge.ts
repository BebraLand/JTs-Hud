import assert from 'node:assert/strict'
import {
  parseChallongeModule,
  resolveChallongeMatch,
  resolveChallongeMatchByTeamNames,
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

const twoStageBracket = parseChallongeModule(`
  <title>Two Stage Test - Challonge</title>
  <script>
    window._initialStoreState [ "TournamentStore" ] = ${JSON.stringify({
      tournament: { id: 99, tournament_type: 'single elimination' },
      rounds: [
        { number: 1, title: 'Semifinals' },
        { number: 2, title: 'Finals' }
      ],
      matches_by_round: {
        '1': [
          {
            identifier: 1,
            raw_identifier: 'A',
            round: 1,
            state: 'pending',
            player1: null,
            player2: null
          }
        ],
        '2': [
          {
            identifier: 2,
            raw_identifier: 'B',
            round: 2,
            state: 'pending',
            player1: null,
            player2: null
          }
        ]
      },
      consolation_matches: [
        {
          id: 50,
          identifier: 3,
          raw_identifier: '3P',
          round: 0,
          state: 'pending',
          player1: { id: 30, display_name: 'falcons' },
          player2: { id: 31, display_name: 'furia' }
        }
      ],
      third_place_match: {
        id: 50,
        identifier: 3,
        raw_identifier: '3P',
        round: 0,
        state: 'pending',
        player1: { id: 30, display_name: 'falcons' },
        player2: { id: 31, display_name: 'furia' }
      },
      groups: [
        {
          name: 'Group A',
          tournament: { id: 100, tournament_type: 'swiss' },
          rounds: [
            { number: 1, title: 'Round 1' },
            { number: 2, title: 'Round 2' }
          ],
          matches_by_round: {
            '1': [
              {
                identifier: 1,
                raw_identifier: 'A',
                round: 1,
                group_id: 'A',
                state: 'open',
                player1: { id: 11, display_name: 'spirit' },
                player2: { id: 12, display_name: 'navi' }
              }
            ],
            '2': [
              {
                identifier: 2,
                raw_identifier: 'B',
                round: 2,
                state: 'pending',
                player1: { id: 13, display_name: 'faze' },
                player2: { id: 14, display_name: 'vitality' }
              }
            ]
          }
        }
      ]
    })};
  </script>
`)

assert.equal(twoStageBracket.matches.length, 5)
assert.equal(
  twoStageBracket.matches.find((match) => match.player1Id === '11' && match.player2Id === '12')
    ?.stageName,
  'Round 1'
)
assert.equal(
  twoStageBracket.matches.find((match) => match.identifier === '3P')?.stageName,
  '3rd Place'
)
assert.deepEqual(
  twoStageBracket.participants.map(({ name }) => name),
  ['falcons', 'furia', 'spirit', 'navi', 'faze', 'vitality']
)

const swissRaw = {
  map: { team_ct: { name: 'spirit' }, team_t: { name: 'navi' } },
  allplayers: {}
} as any
const swissResolved = resolveChallongeMatch(twoStageBracket, swissRaw)
assert.ok(swissResolved)
assert.equal(swissResolved.stage, 'Round 1 · Match A')

const ambiguousBracket: ChallongeBracket = {
  tournamentName: 'Ambiguous Test',
  tournamentType: 'single elimination',
  participants: [
    { id: '1', name: 'spirit' },
    { id: '2', name: 'navi' }
  ],
  matches: [
    {
      id: 'swiss-open',
      state: 'open',
      round: 1,
      identifier: 'A',
      stageName: 'Round 1',
      winnerId: null,
      player1Id: '1',
      player2Id: '2'
    },
    {
      id: 'playoff-open',
      state: 'open',
      round: 1,
      identifier: 'A',
      stageName: 'Semifinals',
      winnerId: null,
      player1Id: '1',
      player2Id: '2'
    }
  ]
}
assert.equal(resolveChallongeMatch(ambiguousBracket, swissRaw), null)
assert.equal(
  resolveChallongeMatchByTeamNames(twoStageBracket, ['faze'], ['vitality'])?.stage,
  'Round 2 · Match B'
)
assert.equal(
  resolveChallongeMatchByTeamNames(twoStageBracket, ['falcons'], ['furia'])?.stage,
  '3rd Place · Match 3P'
)
assert.equal(resolveChallongeMatchByTeamNames(ambiguousBracket, ['spirit'], ['navi']), null)
console.log(
  'Challonge two-stage fixture passed: nested Swiss, playoff and 3rd-place data are handled safely'
)
