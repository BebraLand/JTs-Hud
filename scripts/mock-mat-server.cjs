const http = require('node:http')

const token = process.env.MAT_HUD_TOKEN || 'fixture-token'
const port = Number(process.env.MOCK_MAT_PORT || 18491)

const player = {
  id: '76561198000000001',
  steamId: '76561198000000001',
  nickname: 'aurum',
  firstName: 'Aurimas',
  lastName: 'Operator',
  avatarUrl: null,
  photoUrl: `http://127.0.0.1:${port}/assets/aurum.webp`,
  countryCode: 'LT',
  teamId: 'team-a'
}
const team1 = {
  id: 'team-a',
  name: 'Bebra Team',
  tag: 'BEBRA',
  countryCode: 'LT',
  logoUrl: `http://127.0.0.1:${port}/assets/bebra.webp`,
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
const projection = {
  contract: 'bebraland-mat-hud',
  version: 1,
  revision: 'integration-fixture-1',
  generatedAt: new Date().toISOString(),
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
        { step: 1, teamId: 'team-a', type: 'pick', mapName: 'de_cache', side: null },
        { step: 2, teamId: 'team-b', type: 'side', mapName: 'de_cache', side: 'T' },
        { step: 3, teamId: null, type: 'decider', mapName: 'de_mirage', side: null }
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
        completedAt: new Date().toISOString()
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

let delayNextProjectionMs = 0

http
  .createServer(async (req, res) => {
    if (req.url?.startsWith('/__delay-next')) {
      delayNextProjectionMs =
        Number(new URL(req.url, `http://127.0.0.1:${port}`).searchParams.get('ms')) || 0
      res.writeHead(204)
      return res.end()
    }
    if (req.url === '/api/integrations/jts-hud/v1/current') {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: 'Unauthorized' }))
      }
      if (delayNextProjectionMs > 0) {
        const delay = delayNextProjectionMs
        delayNextProjectionMs = 0
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(projection))
    }
    if (req.url?.startsWith('/broadcast-assets/players/')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end('fixture-player-image')
    }
    res.writeHead(404)
    res.end()
  })
  .listen(port, '127.0.0.1', () => console.log(`Mock MAT listening on ${port}`))
