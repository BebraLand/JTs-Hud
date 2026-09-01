(() => {
  const root = document.createElement('div')
  root.id = 'enhanced-map-end-root'
  document.body.appendChild(root)

  const mapAssets = {
    ancient: 'de_ancient-43ae33ae.png',
    anubis: 'de_anubis-6514829b.png',
    cache: 'de_cache-6cd87872.png',
    dust2: 'de_dust2-542d56ad.png',
    inferno: 'de_inferno-84a6e857.png',
    mirage: 'de_mirage-9742e5e5.png',
    nuke: 'de_nuke-9f76977c.png',
    overpass: 'de_overpass-a21ce7f0.png',
    train: 'de_train-67fbe404.png',
    vertigo: 'de_vertigo-a1b19e07.png'
  }
  const asset = (file) => new URL(`./assets/${file}`, location.href).href
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char])
  const isTrue = (value) => value === true || value === 'true' || value === 1
  const mapLabel = (name) => String(name || 'UNKNOWN').replace(/^(de_|cs_|gg_|ar_)/, '').replace(/_/g, ' ')
  const bestOfNumber = (format) => {
    const bestOf = Number(String(format || '').replace(/^bo/i, ''))
    return bestOf > 0 ? bestOf : 1
  }
  const seriesPipCount = (format) => Math.ceil(bestOfNumber(format) / 2)
  const liveTeamState = (team) => {
    const name = String(team?.name || '').trim().toLowerCase()
    if (!name) return null
    for (const node of document.querySelectorAll('#matchbar .team')) {
      if (String(node.querySelector('.team-name')?.textContent || '').trim().toLowerCase() !== name) continue
      const side = node.classList.contains('T') ? 'T' : node.classList.contains('CT') ? 'CT' : null
      const slot = node.classList.contains('left') ? 0 : node.classList.contains('right') ? 1 : null
      return side ? { side, slot } : null
    }
    return null
  }
  const cleanUrl = (value) => typeof value === 'string' && value.trim() ? value : ''

  let enabled = true
  let steamAvatars = false
  let projection = null
  let lastRendered = ''
  let projectionRequest = null
  let pending = false
  let retryTimer = null
  let debugPreview = false

  const oldOverlay = () => document.querySelector('.eg-overlay')
  const clearEnhanced = () => {
    pending = false
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    document.documentElement.classList.remove('enhanced-map-end-active', 'enhanced-map-end-pending')
    root.replaceChildren()
    lastRendered = ''
  }

  const holdEnhanced = () => {
    if ((!enabled && !debugPreview) || (!debugPreview && !oldOverlay())) return clearEnhanced()
    pending = true
    document.documentElement.classList.remove('enhanced-map-end-active')
    document.documentElement.classList.add('enhanced-map-end-pending')
  }

  const updateEnabled = (config) => {
    const value = config?.display_settings?.use_enhanced_map_end_screen
    const nextEnabled = value !== false && value !== 'false' && value !== 0
    const changed = nextEnabled !== enabled
    enabled = nextEnabled
    if (!enabled && !debugPreview) clearEnhanced()
    else if (changed && oldOverlay()) startMapEnd()
  }

  const loadConfig = () => fetch('/api/huds/bebraland/config', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then(updateEnabled)
    .catch(() => {
      enabled = false
      if (!debugPreview) clearEnhanced()
    })

  const loadSettings = () => fetch('/api/settings', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((settings) => { steamAvatars = isTrue(settings?.matUseSteamAvatars) })
    .catch(() => undefined)

  const loadProjection = () => {
    if (!enabled && !debugPreview) return Promise.resolve()
    if (projectionRequest) return projectionRequest
    projectionRequest = fetch('/api/settings/mat/projection', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { projection = value })
      .catch(() => { projection = null })
      .finally(() => { projectionRequest = null })
    return projectionRequest
  }

  const loadDebugPreview = () => fetch('/api/settings/debug/map-end', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((value) => {
      const next = value?.enabled === true
      if (next === debugPreview) return
      debugPreview = next
      if (debugPreview) loadProjection().then(render)
      else clearEnhanced()
    })
    .catch(() => undefined)

  const retryProjection = () => {
    if (!pending || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      loadProjection().then(render)
    }, 200)
  }

  const startMapEnd = () => {
    if (debugPreview || !enabled || !oldOverlay() || pending || document.documentElement.classList.contains('enhanced-map-end-active')) return
    holdEnhanced()
    loadProjection().then(render)
  }

  const debugTeam = (team, fallbackId, fallbackName) => ({
    id: team?.id || fallbackId,
    name: team?.name || fallbackName,
    tag: team?.tag || null,
    logoUrl: team?.logoUrl || null,
    players: team?.players?.length ? team.players : [{ id: fallbackId, steamId: fallbackId, nickname: fallbackName }]
  })

  const debugStats = (team, kills, deaths, damage) => team.players.map((player, index) => ({
    steamId: player.steamId,
    name: player.nickname,
    kills: Math.max(0, kills - index * 2),
    deaths: Math.max(0, deaths + index),
    assists: Math.max(0, 3 - index),
    damage: Math.max(0, damage - index * 35),
    headshotKills: Math.max(0, kills - index * 3),
    kast: 70,
    mvps: index === 0 ? 2 : 0,
    score: Math.max(0, kills - index),
    roundsPlayed: 24
  }))

  const debugMatch = () => {
    const source = projection?.match
    const team1 = debugTeam(source?.team1, 'debug-team-1', 'Kailos Team')
    const team2 = debugTeam(source?.team2, 'debug-team-2', 'BebraLand Team')
    const previewMapNames = ['de_dust2', 'de_cache', 'de_ancient', 'de_anubis', 'de_inferno']
    const sourceMaps = Array.isArray(source?.maps) ? source.maps : []
    const maps = Array.from({ length: Math.max(bestOfNumber(source?.format), sourceMaps.length) }, (_, index) => ({
      number: index + 1,
      name: sourceMaps[index]?.name || previewMapNames[index] || 'de_ancient',
      score: null,
      completedAt: null,
      playerStats: null
    }))
    maps[0] = {
      ...maps[0],
      score: { team1: 16, team2: 12 },
      winnerTeamId: team1.id,
      completedAt: new Date().toISOString(),
      playerStats: {
        team1: debugStats(team1, 22, 14, 420),
        team2: debugStats(team2, 17, 17, 340)
      }
    }
    return {
      ...source,
      id: 'debug-map-end',
      format: source?.format || 'bo3',
      status: 'completed',
      currentMap: null,
      currentMapNumber: 1,
      team1,
      team2,
      seriesScore: { team1: 1, team2: 0 },
      maps
    }
  }

  const statFor = (player, lines) => {
    const playerId = String(player.steamId).toLowerCase()
    const line = (lines || []).find((item) => String(item.steamId).toLowerCase() === playerId)
    const kills = Number(line?.kills || 0)
    const deaths = Number(line?.deaths || 0)
    const assists = Number(line?.assists || 0)
    const damage = Number(line?.damage || 0)
    const rounds = Number(line?.roundsPlayed || 0)
    const rating = (kills + assists * 0.5) / Math.max(1, deaths)
    return {
      kills, deaths, assists, damage, rounds,
      adr: rounds ? damage / rounds : 0,
      kast: Number(line?.kast || 0),
      score: Number(line?.score || 0),
      rating,
      line
    }
  }

  const playerImage = (player, steamFallback, side) => {
    const custom = cleanUrl(player.photoUrl)
    const steam = steamAvatars && steamFallback ? cleanUrl(player.avatarUrl) : ''
    return custom || steam || asset(side === 'T' || side === 1 ? 'default_T-9ac0f200.png' : 'default_CT-cadc51be.png')
  }

  const renderPlayer = (player, stats, side, mvpSteamId) => {
    const image = playerImage(player, true, side)
    const rowClass = String(player.steamId) === String(mvpSteamId) ? ' mvp-row' : ''
    return `<div class="enhanced-map-end-player${rowClass}">
      <img src="${esc(image)}" alt="">
      <span>${esc(player.nickname)}</span>
    </div>
    <span class="enhanced-map-end-stat">${stats.kills}</span>
    <span class="enhanced-map-end-stat">${stats.deaths}</span>
    <span class="enhanced-map-end-stat">${stats.assists}</span>
    <span class="enhanced-map-end-stat">${stats.deaths ? (stats.kills / stats.deaths).toFixed(2) : stats.kills.toFixed(2)}</span>
    <span class="enhanced-map-end-stat">${stats.adr.toFixed(1)}</span>
    <span class="enhanced-map-end-stat rating">${stats.rating.toFixed(2)}</span>`
  }

  const renderTeam = (team, lines, side, winner, mvpSteamId) => {
    const players = (team.players || []).map((player) => ({
      player, stats: statFor(player, lines)
    })).sort((a, b) => b.stats.rating - a.stats.rating || b.stats.kills - a.stats.kills)
    const rows = players.map(({ player, stats }) => renderPlayer(player, stats, side, mvpSteamId)).join('')
    return `<section class="enhanced-map-end-team ${side} ${winner ? 'winner' : 'opponent'}">
      <div class="enhanced-map-end-team-header">
        <div class="enhanced-map-end-team-title">
          <img src="${esc(cleanUrl(team.logoUrl) || asset(side === 'T' ? 'logo_T_default-e8ec7778.png' : 'logo_CT_default-98efc38d.png'))}" alt="">
          <strong>${esc(team.name)}</strong>
        </div>
        <span class="enhanced-map-end-team-status">${winner ? 'Victory' : 'Opponent'}</span>
      </div>
      <div class="enhanced-map-end-table">
        <span class="enhanced-map-end-table-head">PLAYER</span><span class="enhanced-map-end-table-head">K</span><span class="enhanced-map-end-table-head">D</span><span class="enhanced-map-end-table-head">A</span><span class="enhanced-map-end-table-head">K/D</span><span class="enhanced-map-end-table-head">ADR</span><span class="enhanced-map-end-table-head">RATING</span>
        ${rows}
      </div>
    </section>`
  }

  const render = () => {
    const match = debugPreview ? debugMatch() : projection?.match
    if ((!enabled && !debugPreview) || (!debugPreview && !oldOverlay())) return clearEnhanced()
    if (!match) {
      holdEnhanced()
      retryProjection()
      return
    }

    const maps = match.maps || []
    const map = [...maps].reverse().find((item) => item.completedAt || item.score || item.playerStats)
    if (!map?.playerStats) {
      holdEnhanced()
      retryProjection()
      return
    }
    const score = map.score || { team1: 0, team2: 0 }
    const winnerId = map.winnerTeamId || (score.team1 === score.team2 ? null : score.team1 > score.team2 ? match.team1.id : match.team2.id)
    const lines = map.playerStats || { team1: [], team2: [] }
    const mapKey = String(map.name || '').replace(/^de_/, '')
    const seriesScore = match.seriesScore || { team1: 0, team2: 0 }
    const defaultTeam1Side = map.startingSideTeam1 === 'T' ? 'T' : 'CT'
    const team1Live = liveTeamState(match.team1)
    const team2Live = liveTeamState(match.team2)
    const team1Side = team1Live?.side || defaultTeam1Side
    const team2Side = team2Live?.side || (team1Side === 'CT' ? 'T' : 'CT')
    const team1 = { team: match.team1, lines: lines.team1, score: score.team1, series: seriesScore.team1, side: team1Side, winner: winnerId === match.team1.id }
    const team2 = { team: match.team2, lines: lines.team2, score: score.team2, series: seriesScore.team2, side: team2Side, winner: winnerId === match.team2.id }
    const [leftTeam, rightTeam] = team1Live?.slot === 1 || team2Live?.slot === 0 ? [team2, team1] : [team1, team2]
    const players = [team1, team2].flatMap(({ team, lines: teamLines, side }) => (team.players || []).map((player) => ({
      player, side, stats: statFor(player, teamLines), team
    })))
    const mvp = players.sort((a, b) => b.stats.rating - a.stats.rating || b.stats.kills - a.stats.kills)[0]
    const statsSignature = [...(lines.team1 || []), ...(lines.team2 || [])]
      .map((line) => `${line.steamId}:${line.kills}:${line.deaths}:${line.assists}:${line.damage}`)
      .join('|')
    const signature = `${match.id}:${map.number}:${score.team1}:${score.team2}:${winnerId || ''}:${seriesScore.team1}:${seriesScore.team2}:${team1Side}:${team2Side}:${team1Live?.slot ?? ''}:${team2Live?.slot ?? ''}:${mvp?.player.steamId || ''}:${statsSignature}`
    if (signature === lastRendered) {
      pending = false
      document.documentElement.classList.remove('enhanced-map-end-pending')
      document.documentElement.classList.add('enhanced-map-end-active')
      return
    }
    lastRendered = signature
    const winner = winnerId === match.team1.id ? match.team1 : winnerId === match.team2.id ? match.team2 : null
    const mvpImage = mvp ? playerImage(mvp.player, true, mvp.side) : asset('player_silhouette-6cb6fa39.png')
    const renderSeriesPips = (side, wins) => Array.from({ length: seriesPipCount(match.format) }, (_, index) => `<div class="wins_box${index < Number(wins || 0) ? ' win' : ''} ${side}"></div>`).join('')
    root.style.setProperty('--map-bg', `url("${asset(mapAssets[mapKey] || mapAssets.ancient)}")`)
    root.innerHTML = `<main class="enhanced-map-end-shell">
      <header class="enhanced-map-end-scorebar">
        <div class="enhanced-map-end-scoreteam ${leftTeam.side} ${leftTeam.winner ? 'winner' : ''}">
          <img src="${esc(cleanUrl(leftTeam.team.logoUrl) || asset(leftTeam.side === 'T' ? 'logo_T_default-e8ec7778.png' : 'logo_CT_default-98efc38d.png'))}" alt=""><div><small>${leftTeam.winner ? 'Winner' : 'Opponent'}</small><strong>${esc(leftTeam.team.name)}</strong></div>
        </div>
        <div class="enhanced-map-end-scorecenter">
          <div class="enhanced-map-end-score-context"><span>ROUND SCORE</span><i></i><span>MAP ${map.number || 1} · ${esc(mapLabel(map.name))}</span></div>
          <div class="enhanced-map-end-score">
            <div class="enhanced-map-end-score-side"><b class="${leftTeam.side}">${leftTeam.score}</b><div class="enhanced-map-end-score-pips"><div class="wins_box_container">${renderSeriesPips(leftTeam.side, leftTeam.series)}</div></div></div>
            <span>:</span>
            <div class="enhanced-map-end-score-side"><b class="${rightTeam.side}">${rightTeam.score}</b><div class="enhanced-map-end-score-pips"><div class="wins_box_container">${renderSeriesPips(rightTeam.side, rightTeam.series)}</div></div></div>
          </div>
        </div>
        <div class="enhanced-map-end-scoreteam ${rightTeam.side} ${rightTeam.winner ? 'winner' : ''}">
          <div><small>${rightTeam.winner ? 'Winner' : 'Opponent'}</small><strong>${esc(rightTeam.team.name)}</strong></div><img src="${esc(cleanUrl(rightTeam.team.logoUrl) || asset(rightTeam.side === 'T' ? 'logo_T_default-e8ec7778.png' : 'logo_CT_default-98efc38d.png'))}" alt="">
        </div>
      </header>
      <div class="enhanced-map-end-teams">${renderTeam(leftTeam.team, leftTeam.lines, leftTeam.side, leftTeam.winner, mvp?.player.steamId)}${renderTeam(rightTeam.team, rightTeam.lines, rightTeam.side, rightTeam.winner, mvp?.player.steamId)}</div>
      <aside class="enhanced-map-end-mvp-side">
        ${mvp ? `<section class="enhanced-map-end-mvp ${mvp.side}"><span class="enhanced-map-end-mvp-badge">MVP</span><img class="enhanced-map-end-mvp-photo" src="${esc(mvpImage)}" alt=""><div class="enhanced-map-end-mvp-copy"><span class="enhanced-map-end-mvp-label">${esc(mvp.team.name)}</span><div class="enhanced-map-end-mvp-name">${esc(mvp.player.nickname)}</div><div class="enhanced-map-end-mvp-metrics"><div class="enhanced-map-end-metric"><span class="enhanced-map-end-kicker">Rating</span><strong>${mvp.stats.rating.toFixed(2)}</strong></div><div class="enhanced-map-end-metric"><span class="enhanced-map-end-kicker">K · D · A</span><strong>${mvp.stats.kills} · ${mvp.stats.deaths} · ${mvp.stats.assists}</strong></div></div></div></section>` : ''}
        ${mvp ? `<section class="enhanced-map-end-fragger ${mvp.side}"><span class="enhanced-map-end-kicker">Top fragger</span><div class="enhanced-map-end-fragger-name">${esc(mvp.player.nickname)}</div><div class="enhanced-map-end-fragger-metrics"><div><span class="enhanced-map-end-kicker">Kills</span><strong>${mvp.stats.kills}</strong></div><div><span class="enhanced-map-end-kicker">K/D</span><strong>${mvp.stats.deaths ? (mvp.stats.kills / mvp.stats.deaths).toFixed(2) : '∞'}</strong></div></div></section>` : ''}
      </aside>
    </main>`
    pending = false
    document.documentElement.classList.remove('enhanced-map-end-pending')
    document.documentElement.classList.add('enhanced-map-end-active')
  }

  loadConfig().then(() => loadSettings()).then(() => loadProjection().then(render))
  new MutationObserver(() => {
    if (debugPreview) return
    if (oldOverlay()) startMapEnd()
    else clearEnhanced()
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
  setInterval(() => {
    loadConfig().then(loadSettings)
    loadDebugPreview()
    if (pending || debugPreview) loadProjection().then(render)
  }, 1500)
})()
