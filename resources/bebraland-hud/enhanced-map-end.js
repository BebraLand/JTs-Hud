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
  const matMapImage = (name) => {
    const mapName = String(name || '')
    return mapName === 'de_cache'
      ? 'https://raw.githubusercontent.com/auuruum/matchzy-auto-tournament/main/map_thumbnails/de_cache.webp'
      : `https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails/${encodeURIComponent(mapName)}.webp`
  }
  const bestOfNumber = (format) => {
    const bestOf = Number(String(format || '').replace(/^bo/i, ''))
    return bestOf > 0 ? bestOf : 1
  }
  const seriesPipCount = (format) => Math.ceil(bestOfNumber(format) / 2)
  const seconds = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 600) : 30
  }
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
  let showVeto = false
  let vetoPosition = 'right'
  let ratingModel = 'five_factor'
  let lastMapSeconds = 30
  let projection = null
  let lastRendered = ''
  let projectionRequest = null
  let pending = false
  let retryTimer = null
  let debugPreview = false
  let debugSeriesPreview = false
  let presentationKey = ''
  let presentationStartedAt = 0
  let seriesEndActive = false
  let seriesEndMatch = null
  let phaseTimer = null

  const oldOverlay = () => document.querySelector('.eg-overlay')
  const clearEnhanced = () => {
    pending = false
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    if (phaseTimer) clearTimeout(phaseTimer)
    phaseTimer = null
    seriesEndActive = false
    seriesEndMatch = null
    document.documentElement.classList.remove('enhanced-map-end-active', 'enhanced-map-end-pending')
    root.replaceChildren()
    lastRendered = ''
  }

  const holdEnhanced = () => {
  if ((!enabled && !debugPreview && !debugSeriesPreview) || (!debugPreview && !debugSeriesPreview && !oldOverlay() && !pending && !seriesEndActive)) return clearEnhanced()
    pending = true
    document.documentElement.classList.remove('enhanced-map-end-active')
    document.documentElement.classList.add('enhanced-map-end-pending')
  }

  const updateEnabled = (config) => {
    const value = config?.display_settings?.use_enhanced_map_end_screen
    const nextEnabled = value !== false && value !== 'false' && value !== 0
    const nextShowVeto = isTrue(config?.display_settings?.show_map_end_veto)
    const nextVetoPosition = config?.display_settings?.map_end_veto_position === 'left' ? 'left' : 'right'
    const nextRatingModel = config?.display_settings?.map_end_rating_model === 'hltv_like' ? 'hltv_like' : 'five_factor'
    const nextLastMapSeconds = seconds(config?.display_settings?.map_end_last_map_seconds)
    const changed = nextEnabled !== enabled || nextShowVeto !== showVeto || nextVetoPosition !== vetoPosition || nextRatingModel !== ratingModel || nextLastMapSeconds !== lastMapSeconds
    enabled = nextEnabled
    showVeto = nextShowVeto
    vetoPosition = nextVetoPosition
    ratingModel = nextRatingModel
    lastMapSeconds = nextLastMapSeconds
    if (!enabled && !debugPreview && !debugSeriesPreview) clearEnhanced()
    else if (changed && (debugPreview || debugSeriesPreview || oldOverlay() || seriesEndActive)) {
      lastRendered = ''
      loadProjection().then(render)
    }
  }

  const loadConfig = () => fetch('/api/huds/bebraland/config', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then(updateEnabled)
    .catch(() => {
      enabled = false
      if (!debugPreview && !debugSeriesPreview) clearEnhanced()
    })

  const loadSettings = () => fetch('/api/settings', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((settings) => { steamAvatars = isTrue(settings?.matUseSteamAvatars) })
    .catch(() => undefined)

  const loadProjection = () => {
    if (!enabled && !debugPreview && !debugSeriesPreview) return Promise.resolve()
    if (projectionRequest) return projectionRequest
    projectionRequest = fetch('/api/settings/mat/projection', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { projection = value })
      .catch(() => { projection = null })
      .finally(() => { projectionRequest = null })
    return projectionRequest
  }

  const loadDebugPreview = () => Promise.all([
    fetch('/api/settings/debug/map-end', { cache: 'no-store' }),
    fetch('/api/settings/debug/series-end', { cache: 'no-store' })
  ]).then(async ([mapEnd, seriesEnd]) => {
      const nextMap = mapEnd.ok && (await mapEnd.json()).enabled === true
      const nextSeries = seriesEnd.ok && (await seriesEnd.json()).enabled === true
      if (nextMap === debugPreview && nextSeries === debugSeriesPreview) return
      debugPreview = nextMap
      debugSeriesPreview = nextSeries
      presentationKey = ''
      presentationStartedAt = 0
      seriesEndActive = false
      seriesEndMatch = null
      if (debugPreview || debugSeriesPreview) loadProjection().then(render)
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
    if (debugPreview || debugSeriesPreview || !enabled || !oldOverlay() || pending || document.documentElement.classList.contains('enhanced-map-end-active')) return
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
    flashAssists: Math.max(0, 2 - index),
    damage: Math.max(0, damage - index * 35),
    utilityDamage: Math.max(0, 80 - index * 15),
    enemiesFlashed: Math.max(0, 4 - index),
    headshotKills: Math.max(0, kills - index * 3),
    kast: 70,
    mvps: index === 0 ? 2 : 0,
    score: Math.max(0, kills - index),
    roundsPlayed: 24
  }))

  const debugMatch = (series = false) => {
    const source = projection?.match
    const team1 = debugTeam(source?.team1, 'debug-team-1', 'Kailos Team')
    const team2 = debugTeam(source?.team2, 'debug-team-2', 'BebraLand Team')
    const format = series && bestOfNumber(source?.format) === 1 ? 'bo3' : source?.format || 'bo3'
    const previewMapNames = ['de_dust2', 'de_cache', 'de_ancient', 'de_anubis', 'de_inferno', 'de_mirage', 'de_nuke']
    const sourceMaps = Array.isArray(source?.maps) ? source.maps : []
    const maps = Array.from({ length: Math.max(bestOfNumber(format), sourceMaps.length) }, (_, index) => ({
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
      completedAt: '2026-01-01T00:00:00.000Z',
      playerStats: {
        team1: debugStats(team1, 22, 14, 420),
        team2: debugStats(team2, 17, 17, 340)
      }
    }
    const winsNeeded = seriesPipCount(format)
    if (series) {
      for (let index = 1; index < winsNeeded; index += 1) {
        maps[index] = {
          ...maps[index],
          score: { team1: 13 + index, team2: 9 + index },
          winnerTeamId: team1.id,
          completedAt: `2026-01-01T00:00:0${index}.000Z`,
          playerStats: {
            team1: debugStats(team1, 19 + index, 12 + index, 380 + index * 20),
            team2: debugStats(team2, 14 + index, 17 + index, 310 + index * 20)
          }
        }
      }
    }
    const veto = source?.veto?.actions?.length ? source.veto : {
      status: 'completed',
      actions: [
        ...previewMapNames.filter((name) => !maps.some((map) => map.name === name)).map((mapName, index) => ({ step: index + 1, teamId: index % 2 ? team2.id : team1.id, type: 'ban', mapName, side: null })),
        ...maps.map((map, index) => ({ step: previewMapNames.length - maps.length + index + 1, teamId: index === maps.length - 1 ? null : index % 2 ? team2.id : team1.id, type: index === maps.length - 1 ? 'decider' : 'pick', mapName: map.name, side: null }))
      ]
    }
    return {
      ...source,
      id: series ? 'debug-series-end' : 'debug-map-end',
      format,
      status: 'completed',
      currentMap: null,
      currentMapNumber: series ? winsNeeded : 1,
      team1,
      team2,
      seriesScore: { team1: series ? winsNeeded : 1, team2: 0 },
      veto,
      maps
    }
  }

  const statFor = (player, lines) => {
    const playerId = String(player.steamId).toLowerCase()
    const line = (lines || []).find((item) => String(item.steamId).toLowerCase() === playerId)
    const kills = Number(line?.kills || 0)
    const deaths = Number(line?.deaths || 0)
    const assists = Number(line?.assists || 0)
    const flashAssists = Number(line?.flashAssists || 0)
    const damage = Number(line?.damage || 0)
    const utilityDamage = Number(line?.utilityDamage || 0)
    const enemiesFlashed = Number(line?.enemiesFlashed || 0)
    const headshotKills = Number(line?.headshotKills || 0)
    const mvps = Number(line?.mvps || 0)
    const rounds = Number(line?.roundsPlayed || 0)
    const kast = Number(line?.kast || 0)
    const perRound = (value) => value / Math.max(1, rounds)
    const relative = (value, baseline) => Math.max(0, value / baseline)
    const kill = relative(perRound(kills), 0.68)
    const survival = relative(Math.max(0, 1 - perRound(deaths)), 0.36)
    const consistency = relative(kast, 70)
    const damageRating = relative(perRound(damage), 75)
    const simpleImpact = relative(perRound(kills + assists * 0.5), 0.82)
    // ponytail: HLTV's opening, multikill, clutch, and traded-death inputs are not in the HUD contract; add them here if MAT exposes them.
    const advancedImpact = relative(
      perRound(kills + assists * 0.5 + flashAssists * 0.35 + headshotKills * 0.1 + mvps * 0.3) + perRound(utilityDamage) / 100 + perRound(enemiesFlashed) * 0.03,
      0.95
    )
    const rating = rounds <= 0 ? 0 : ratingModel === 'hltv_like'
      ? kill * 0.25 + survival * 0.15 + consistency * 0.2 + advancedImpact * 0.3 + damageRating * 0.1
      : (kill + survival + consistency + simpleImpact + damageRating) / 5
    return {
      kills, deaths, assists, flashAssists, damage, utilityDamage, enemiesFlashed, headshotKills, mvps, rounds,
      adr: rounds ? damage / rounds : 0,
      kast,
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

  const vetoEntries = (match) => {
    const entries = new Map()
    const ensure = (mapName) => {
      if (!entries.has(mapName)) entries.set(mapName, { mapName, step: 1000 + entries.size, type: 'decider', teamId: null, side: null, map: null })
      return entries.get(mapName)
    }
    for (const action of [...(match.veto?.actions || [])].sort((a, b) => a.step - b.step)) {
      const entry = ensure(action.mapName)
      if (action.type === 'side') entry.side = action.side
      else Object.assign(entry, action)
    }
    for (const map of match.maps || []) {
      const entry = ensure(map.name)
      entry.map = map
      entry.step = Math.min(entry.step, 500 + Number(map.number || 0))
      if (!entry.type) entry.type = map.pickedByTeamId ? 'pick' : 'decider'
      if (!entry.teamId) entry.teamId = map.pickedByTeamId
    }
    return [...entries.values()].sort((a, b) => a.step - b.step)
  }

  const renderVeto = (match) => {
    const entries = vetoEntries(match)
    if (!entries.length) return ''
    const teamFor = (id) => id === match.team1.id ? match.team1 : id === match.team2.id ? match.team2 : null
    const actionLabel = (entry) => entry.type === 'ban' ? 'BAN' : entry.type === 'pick' ? 'PICK' : 'DECIDER'
    return `<aside class="enhanced-map-end-veto ${vetoPosition}">
      <div class="enhanced-map-end-veto-header"><span>MAP VETO</span><small>${esc(String(match.format || 'bo1').toUpperCase())}</small></div>
      <div class="enhanced-map-end-veto-list">${entries.map((entry) => {
        const team = teamFor(entry.teamId)
        const map = entry.map
        const score = map?.score ? `${map.score.team1} : ${map.score.team2}` : ''
        const mapKey = String(entry.mapName || '').replace(/^de_/, '')
        const image = cleanUrl(map?.imageUrl || entry.imageUrl) || matMapImage(entry.mapName)
        const logo = cleanUrl(team?.logoUrl)
        const sidePick = entry.side ? `<i class="enhanced-map-end-veto-side ${entry.side}" title="${entry.side === 'CT' ? 'Counter-Terrorist side' : 'Terrorist side'}"></i>` : ''
        return `<article class="enhanced-map-end-veto-map ${entry.type}" style="--veto-map: url('${esc(image)}')">
          <div><strong>${esc(mapLabel(entry.mapName))}</strong><span>${actionLabel(entry)}${team ? ` · ${logo ? `<img src="${esc(logo)}" alt="">` : ''}${esc(team.tag || team.name)}` : ''}${sidePick}</span></div>${score ? `<b>${score}</b>` : ''}
        </article>`
      }).join('')}</div>
    </aside>`
  }

  const seriesResult = (match, maps) => {
    const wins = { team1: 0, team2: 0 }
    for (const map of maps) {
      const winnerId = map.winnerTeamId || (map.score?.team1 > map.score?.team2 ? match.team1.id : map.score?.team2 > map.score?.team1 ? match.team2.id : null)
      if (winnerId === match.team1.id) wins.team1 += 1
      if (winnerId === match.team2.id) wins.team2 += 1
    }
    return wins
  }

  const aggregateSeriesStats = (maps) => {
    const aggregate = (side) => {
      const players = new Map()
      for (const map of maps) {
        for (const line of map.playerStats?.[side] || []) {
          const key = String(line.steamId).toLowerCase()
          const total = players.get(key) || { ...line, kills: 0, deaths: 0, assists: 0, flashAssists: 0, damage: 0, utilityDamage: 0, enemiesFlashed: 0, headshotKills: 0, mvps: 0, score: 0, roundsPlayed: 0, kastRounds: 0 }
          const rounds = Number(line.roundsPlayed || 0)
          for (const field of ['kills', 'deaths', 'assists', 'flashAssists', 'damage', 'utilityDamage', 'enemiesFlashed', 'headshotKills', 'mvps', 'score', 'roundsPlayed']) total[field] += Number(line[field] || 0)
          total.kastRounds += Number(line.kast || 0) * rounds
          total.name = line.name || total.name
          players.set(key, total)
        }
      }
      return [...players.values()].map(({ kastRounds, ...line }) => ({ ...line, kast: line.roundsPlayed ? kastRounds / line.roundsPlayed : 0 }))
    }
    return { team1: aggregate('team1'), team2: aggregate('team2') }
  }

  const schedulePhase = (delay) => {
    if (phaseTimer) clearTimeout(phaseTimer)
    phaseTimer = setTimeout(() => {
      phaseTimer = null
      lastRendered = ''
      render()
    }, Math.max(0, delay) + 25)
  }

  const render = () => {
    const liveMatch = projection?.match
    const match = debugSeriesPreview
      ? debugMatch(true)
      : debugPreview
        ? debugMatch()
        : seriesEndActive && seriesEndMatch && liveMatch?.id === seriesEndMatch.id
          ? seriesEndMatch
          : liveMatch || (seriesEndActive ? seriesEndMatch : null)
    if ((!enabled && !debugPreview && !debugSeriesPreview) || (!debugPreview && !debugSeriesPreview && !oldOverlay() && !pending && !seriesEndActive)) return clearEnhanced()
    if (!match) {
      holdEnhanced()
      retryProjection()
      return
    }

    const maps = match.maps || []
    const completedMaps = maps.filter((item) => item.playerStats && item.score)
    const map = [...completedMaps].reverse()[0]
    if (!map?.playerStats) {
      holdEnhanced()
      retryProjection()
      return
    }
    const currentKey = `${match.id}:${map.number}:${map.completedAt || `${map.score.team1}:${map.score.team2}`}`
    if (currentKey !== presentationKey) {
      presentationKey = currentKey
      presentationStartedAt = Date.now()
      seriesEndActive = false
      seriesEndMatch = null
    }
    const mapSeriesScore = seriesResult(match, completedMaps)
    const projectedSeriesScore = match.seriesScore || { team1: 0, team2: 0 }
    const seriesScore = {
      team1: Math.max(Number(projectedSeriesScore.team1 || 0), mapSeriesScore.team1),
      team2: Math.max(Number(projectedSeriesScore.team2 || 0), mapSeriesScore.team2)
    }
    const seriesComplete = debugSeriesPreview || (bestOfNumber(match.format) > 1 && Math.max(seriesScore.team1, seriesScore.team2) >= seriesPipCount(match.format))
    if (seriesComplete) {
      seriesEndActive = true
      seriesEndMatch = match
    }
    const elapsed = Date.now() - presentationStartedAt
    const showSeries = seriesComplete && elapsed >= lastMapSeconds * 1000
    if (seriesComplete && !showSeries) schedulePhase(lastMapSeconds * 1000 - elapsed)
    const score = showSeries ? seriesScore : map.score || { team1: 0, team2: 0 }
    const winnerId = showSeries
      ? (seriesScore.team1 === seriesScore.team2 ? null : seriesScore.team1 > seriesScore.team2 ? match.team1.id : match.team2.id)
      : map.winnerTeamId || (score.team1 === score.team2 ? null : score.team1 > score.team2 ? match.team1.id : match.team2.id)
    const lines = showSeries ? aggregateSeriesStats(completedMaps) : map.playerStats || { team1: [], team2: [] }
    const mapKey = String(map.name || '').replace(/^de_/, '')
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
    const veto = showVeto ? renderVeto(match) : ''
    const statsSignature = [...(lines.team1 || []), ...(lines.team2 || [])]
      .map((line) => `${line.steamId}:${line.kills}:${line.deaths}:${line.assists}:${line.flashAssists}:${line.damage}:${line.utilityDamage}:${line.enemiesFlashed}:${line.headshotKills}:${line.mvps}:${line.kast}:${line.roundsPlayed}`)
      .join('|')
    const signature = `${match.id}:${map.number}:${showSeries}:${score.team1}:${score.team2}:${winnerId || ''}:${seriesScore.team1}:${seriesScore.team2}:${team1Side}:${team2Side}:${team1Live?.slot ?? ''}:${team2Live?.slot ?? ''}:${mvp?.player.steamId || ''}:${ratingModel}:${showVeto}:${vetoPosition}:${veto}:${statsSignature}`
    if (signature === lastRendered) {
      pending = false
      document.documentElement.classList.remove('enhanced-map-end-pending')
      document.documentElement.classList.add('enhanced-map-end-active')
      return
    }
    lastRendered = signature
    const mvpImage = mvp ? playerImage(mvp.player, true, mvp.side) : asset('player_silhouette-6cb6fa39.png')
    const renderSeriesPips = (side, wins) => Array.from({ length: seriesPipCount(match.format) }, (_, index) => `<div class="wins_box${index < Number(wins || 0) ? ' win' : ''} ${side}"></div>`).join('')
    root.style.setProperty('--map-bg', `url("${asset(mapAssets[mapKey] || mapAssets.ancient)}")`)
    root.innerHTML = `<main class="enhanced-map-end-shell${veto ? ` with-veto-${vetoPosition}` : ''}">
      <header class="enhanced-map-end-scorebar">
        <div class="enhanced-map-end-scoreteam ${leftTeam.side} ${leftTeam.winner ? 'winner' : ''}">
          <img src="${esc(cleanUrl(leftTeam.team.logoUrl) || asset(leftTeam.side === 'T' ? 'logo_T_default-e8ec7778.png' : 'logo_CT_default-98efc38d.png'))}" alt=""><div><small>${leftTeam.winner ? 'Winner' : 'Opponent'}</small><strong>${esc(leftTeam.team.name)}</strong></div>
        </div>
        <div class="enhanced-map-end-scorecenter">
          <div class="enhanced-map-end-score-context"><span>${showSeries ? 'SERIES SCORE' : 'ROUND SCORE'}</span><i></i><span>${showSeries ? `${esc(String(match.format || 'bo1').toUpperCase())} · ${completedMaps.length} MAPS` : `MAP ${map.number || 1} · ${esc(mapLabel(map.name))}`}</span></div>
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
        ${mvp ? `<section class="enhanced-map-end-mvp ${mvp.side}"><span class="enhanced-map-end-mvp-badge">${showSeries ? 'SERIES MVP' : 'MVP'}</span><img class="enhanced-map-end-mvp-photo" src="${esc(mvpImage)}" alt=""><div class="enhanced-map-end-mvp-copy"><span class="enhanced-map-end-mvp-label">${esc(mvp.team.name)}</span><div class="enhanced-map-end-mvp-name">${esc(mvp.player.nickname)}</div><div class="enhanced-map-end-mvp-metrics"><div class="enhanced-map-end-metric"><span class="enhanced-map-end-kicker">Rating</span><strong>${mvp.stats.rating.toFixed(2)}</strong></div><div class="enhanced-map-end-metric"><span class="enhanced-map-end-kicker">K · D · A</span><strong>${mvp.stats.kills} · ${mvp.stats.deaths} · ${mvp.stats.assists}</strong></div></div></div></section>` : ''}
        ${mvp ? `<section class="enhanced-map-end-fragger ${mvp.side}"><span class="enhanced-map-end-kicker">${showSeries ? 'Series top fragger' : 'Top fragger'}</span><div class="enhanced-map-end-fragger-name">${esc(mvp.player.nickname)}</div><div class="enhanced-map-end-fragger-metrics"><div><span class="enhanced-map-end-kicker">Kills</span><strong>${mvp.stats.kills}</strong></div><div><span class="enhanced-map-end-kicker">K/D</span><strong>${mvp.stats.deaths ? (mvp.stats.kills / mvp.stats.deaths).toFixed(2) : '∞'}</strong></div></div></section>` : ''}
      </aside>
      ${veto}
    </main>`
    pending = false
    document.documentElement.classList.remove('enhanced-map-end-pending')
    document.documentElement.classList.add('enhanced-map-end-active')
  }

  loadConfig().then(() => loadSettings()).then(() => loadProjection().then(render))
  new MutationObserver(() => {
    if (debugPreview || debugSeriesPreview) return
    if (oldOverlay()) startMapEnd()
    else if (!pending && !seriesEndActive) clearEnhanced()
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
  setInterval(() => {
    loadConfig().then(loadSettings)
    loadDebugPreview()
    if (pending || debugPreview || debugSeriesPreview || seriesEndActive) loadProjection().then(render)
  }, 1500)
})()
