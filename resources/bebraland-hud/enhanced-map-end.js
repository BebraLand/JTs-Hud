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
  const cleanUrl = (value) => typeof value === 'string' && value.trim() ? value : ''

  let enabled = true
  let steamAvatars = false
  let projection = null
  let lastRendered = ''
  let projectionRequest = null
  let pending = false
  let retryTimer = null

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
    if (!enabled || !oldOverlay()) return clearEnhanced()
    pending = true
    document.documentElement.classList.remove('enhanced-map-end-active')
    document.documentElement.classList.add('enhanced-map-end-pending')
  }

  const updateEnabled = (config) => {
    const value = config?.display_settings?.use_enhanced_map_end_screen
    const nextEnabled = value !== false && value !== 'false' && value !== 0
    const changed = nextEnabled !== enabled
    enabled = nextEnabled
    if (!enabled) clearEnhanced()
    else if (changed && oldOverlay()) startMapEnd()
  }

  const loadConfig = () => fetch('/api/huds/bebraland/config', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then(updateEnabled)
    .catch(() => {
      enabled = false
      clearEnhanced()
    })

  const loadSettings = () => fetch('/api/settings', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((settings) => { steamAvatars = isTrue(settings?.matUseSteamAvatars) })
    .catch(() => undefined)

  const loadProjection = () => {
    if (!enabled) return Promise.resolve()
    if (projectionRequest) return projectionRequest
    projectionRequest = fetch('/api/settings/mat/projection', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { projection = value })
      .catch(() => { projection = null })
      .finally(() => { projectionRequest = null })
    return projectionRequest
  }

  const retryProjection = () => {
    if (!pending || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      loadProjection().then(render)
    }, 200)
  }

  const startMapEnd = () => {
    if (!enabled || !oldOverlay() || pending || document.documentElement.classList.contains('enhanced-map-end-active')) return
    holdEnhanced()
    loadProjection().then(render)
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
    return custom || steam || asset(side === 0 ? 'default_CT-cadc51be.png' : 'default_T-9ac0f200.png')
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
    return `<section class="enhanced-map-end-team ${winner ? 'winner' : 'opponent'}">
      <div class="enhanced-map-end-team-header">
        <div class="enhanced-map-end-team-title">
          <img src="${esc(cleanUrl(team.logoUrl) || asset(side === 0 ? 'logo_CT_default-98efc38d.png' : 'logo_T_default-e8ec7778.png'))}" alt="">
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
    const match = projection?.match
    if (!enabled || !oldOverlay()) return clearEnhanced()
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
    const teams = [match.team1, match.team2]
    const lines = map.playerStats || { team1: [], team2: [] }
    const players = teams.flatMap((team, side) => (team.players || []).map((player) => ({
      player, side, stats: statFor(player, lines[`team${side + 1}`]) , team
    })))
    const mvp = players.sort((a, b) => b.stats.rating - a.stats.rating || b.stats.kills - a.stats.kills)[0]
    const mapKey = String(map.name || '').replace(/^de_/, '')
    const seriesScore = match.seriesScore || { team1: 0, team2: 0 }
    const statsSignature = [...(lines.team1 || []), ...(lines.team2 || [])]
      .map((line) => `${line.steamId}:${line.kills}:${line.deaths}:${line.assists}:${line.damage}`)
      .join('|')
    const signature = `${match.id}:${map.number}:${score.team1}:${score.team2}:${winnerId || ''}:${seriesScore.team1}:${seriesScore.team2}:${mvp?.player.steamId || ''}:${statsSignature}`
    if (signature === lastRendered) {
      pending = false
      document.documentElement.classList.remove('enhanced-map-end-pending')
      document.documentElement.classList.add('enhanced-map-end-active')
      return
    }
    lastRendered = signature
    const winner = winnerId === match.team1.id ? match.team1 : winnerId === match.team2.id ? match.team2 : null
    const mvpImage = mvp ? playerImage(mvp.player, true, mvp.side) : asset('player_silhouette-6cb6fa39.png')
    root.style.setProperty('--map-bg', `url("${asset(mapAssets[mapKey] || mapAssets.ancient)}")`)
    root.innerHTML = `<main class="enhanced-map-end-shell">
      <header class="enhanced-map-end-scorebar">
        <div class="enhanced-map-end-scoreteam ${winnerId === match.team1.id ? 'winner' : ''}">
          <img src="${esc(cleanUrl(match.team1.logoUrl) || asset('logo_CT_default-98efc38d.png'))}" alt=""><div><small>${winnerId === match.team1.id ? 'Winner' : 'Opponent'}</small><strong>${esc(match.team1.name)}</strong></div>
        </div>
        <div class="enhanced-map-end-scorecenter"><small>Final score</small><div class="enhanced-map-end-score"><b>${score.team1}</b><span>:</span><b>${score.team2}</b></div><em>${esc(match.format.toUpperCase())} · Series ${seriesScore.team1}:${seriesScore.team2} · ${esc(mapLabel(map.name))}</em></div>
        <div class="enhanced-map-end-scoreteam ${winnerId === match.team2.id ? 'winner' : ''}">
          <div><small>${winnerId === match.team2.id ? 'Winner' : 'Opponent'}</small><strong>${esc(match.team2.name)}</strong></div><img src="${esc(cleanUrl(match.team2.logoUrl) || asset('logo_T_default-e8ec7778.png'))}" alt="">
        </div>
      </header>
      <div class="enhanced-map-end-teams">${renderTeam(match.team1, lines.team1, 0, winnerId === match.team1.id, mvp?.player.steamId)}${renderTeam(match.team2, lines.team2, 1, winnerId === match.team2.id, mvp?.player.steamId)}</div>
      <aside class="enhanced-map-end-mvp-side">
        ${mvp ? `<section class="enhanced-map-end-mvp"><span class="enhanced-map-end-mvp-badge">MVP</span><img class="enhanced-map-end-mvp-photo" src="${esc(mvpImage)}" alt=""><div class="enhanced-map-end-mvp-copy"><span class="enhanced-map-end-mvp-label">${esc(mvp.team.name)}</span><div class="enhanced-map-end-mvp-name">${esc(mvp.player.nickname)}</div><div class="enhanced-map-end-mvp-metrics"><div class="enhanced-map-end-metric"><span class="enhanced-map-end-kicker">Rating</span><strong>${mvp.stats.rating.toFixed(2)}</strong></div><div class="enhanced-map-end-metric"><span class="enhanced-map-end-kicker">K · D · A</span><strong>${mvp.stats.kills} · ${mvp.stats.deaths} · ${mvp.stats.assists}</strong></div></div></div></section>` : ''}
        ${mvp ? `<section class="enhanced-map-end-fragger"><span class="enhanced-map-end-kicker">Top fragger</span><div class="enhanced-map-end-fragger-name">${esc(mvp.player.nickname)}</div><div class="enhanced-map-end-fragger-metrics"><div><span class="enhanced-map-end-kicker">Kills</span><strong>${mvp.stats.kills}</strong></div><div><span class="enhanced-map-end-kicker">K/D</span><strong>${mvp.stats.deaths ? (mvp.stats.kills / mvp.stats.deaths).toFixed(2) : '∞'}</strong></div></div></section>` : ''}
      </aside>
    </main>`
    pending = false
    document.documentElement.classList.remove('enhanced-map-end-pending')
    document.documentElement.classList.add('enhanced-map-end-active')
  }

  loadConfig().then(() => loadSettings()).then(() => loadProjection().then(render))
  new MutationObserver(() => {
    if (oldOverlay()) startMapEnd()
    else clearEnhanced()
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
  setInterval(() => {
    loadConfig().then(loadSettings)
    if (pending) loadProjection().then(render)
  }, 1500)
})()
