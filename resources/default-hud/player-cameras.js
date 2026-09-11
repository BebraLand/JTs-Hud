;(function () {
  'use strict'

  const params = new URLSearchParams(location.search)
  const forcedSteamId = params.get('cameraSteamId')
  const forceLive = params.get('cameraLive') === '1'
  const video = document.createElement('video')
  video.id = 'mat-player-camera'
  video.autoplay = true
  video.muted = true
  video.playsInline = true

  let socket
  let policy = { enabled: false, transport: 'p2p', prewarmEnabled: true, availablePlayers: [] }
  let watchedSteamId = null
  let watchedSteamIds = []
  let activeSteamId = null
  let delayMs = 0
  let delayedRecorder = null
  let mediaSource = null
  let mediaSourceUrl = null
  let sourceBuffer = null
  let appendQueue = []
  let playbackGeneration = 0
  const peers = new Map()
  const pendingIce = new Map()
  const streams = new Map()

  const debug = (...values) => console.debug('[MAT player camera]', ...values)

  function mountVideo() {
    let host = document.querySelector('.observed .avatar, .player.active .avatar')
    if (!host && forcedSteamId && forceLive) {
      host = document.getElementById('mat-player-camera-debug-host')
      if (!host) {
        host = document.createElement('div')
        host.id = 'mat-player-camera-debug-host'
        host.title = 'Player camera debug preview'
        document.body.appendChild(host)
      }
    }
    if (host && video.parentElement !== host) host.appendChild(video)
  }

  function cameraAvailable(steamId) {
    return Boolean(
      policy.enabled &&
        steamId &&
        Array.isArray(policy.availablePlayers) &&
        policy.availablePlayers.includes(steamId)
    )
  }

  function hideVideo() {
    activeSteamId = null
    video.pause()
    video.srcObject = null
    video.removeAttribute('src')
    video.load()
    video.classList.remove('pending', 'active')
  }

  function showPending(steamId = watchedSteamId) {
    if (!cameraAvailable(steamId)) {
      hideVideo()
      return false
    }
    activeSteamId = null
    video.pause()
    video.srcObject = null
    video.removeAttribute('src')
    video.load()
    video.classList.add('pending')
    video.classList.remove('active')
    mountVideo()
    return true
  }

  function bindStream(steamId, stream) {
    if (steamId !== watchedSteamId || !stream) return
    mountVideo()
    if (
      video.srcObject === stream &&
      activeSteamId === steamId &&
      video.classList.contains('active') &&
      !video.paused
    ) return
    video.srcObject = stream
    video.classList.add('pending')
    video.classList.remove('active')
    video.play().catch(() => undefined)
  }

  function clearRelayPlayback() {
    playbackGeneration += 1
    delayedRecorder?.stop()
    delayedRecorder = null
    mediaSource = null
    sourceBuffer = null
    appendQueue = []
    if (mediaSourceUrl) URL.revokeObjectURL(mediaSourceUrl)
    mediaSourceUrl = null
  }

  function closePeer(steamId, keepStream = false) {
    peers.get(steamId)?.close()
    peers.delete(steamId)
    pendingIce.delete(steamId)
    if (!keepStream) streams.delete(steamId)
  }

  function syncPeerList(ids) {
    const wanted = new Set(ids)
    for (const steamId of peers.keys()) {
      if (!wanted.has(steamId)) closePeer(steamId)
    }
  }

  function emitWatches() {
    if (!socket) return
    const ids = policy.transport === 'p2p' && policy.prewarmEnabled !== false
      ? watchedSteamIds
      : watchedSteamId
        ? [watchedSteamId]
        : []
    socket.emit('player-camera:watch-list', {
      viewerId: socket.id,
      steamIds: ids,
      selectedSteamId: watchedSteamId
    })
  }

  function setWatches(selectedSteamId, roster) {
    const next = Array.from(new Set([selectedSteamId, ...roster].filter(Boolean))).slice(0, 10)
    const changed =
      selectedSteamId !== watchedSteamId ||
      next.length !== watchedSteamIds.length ||
      next.some((steamId, index) => steamId !== watchedSteamIds[index])

    watchedSteamId = selectedSteamId
    watchedSteamIds = next
    if (policy.transport === 'p2p') syncPeerList(next)
    else if (selectedSteamId !== activeSteamId) clearRelayPlayback()

    if (selectedSteamId && streams.has(selectedSteamId) && policy.transport === 'p2p') {
      bindStream(selectedSteamId, streams.get(selectedSteamId))
    } else if (selectedSteamId && cameraAvailable(selectedSteamId)) {
      showPending(selectedSteamId)
    } else {
      hideVideo()
    }
    if (changed) emitWatches()
  }

  function digestGsi(state) {
    const selectedSteamId = forcedSteamId || state?.player?.steamid || null
    const allPlayers =
      state?.allplayers && typeof state.allplayers === 'object'
        ? Object.keys(state.allplayers)
        : Array.isArray(state?.players)
          ? state.players.map((player) => player?.steamid).filter(Boolean)
          : []
    setWatches(policy.enabled && (forceLive || selectedSteamId) ? selectedSteamId : null, allPlayers)
  }

  function appendNext() {
    if (!sourceBuffer || sourceBuffer.updating || appendQueue.length === 0) return
    try {
      video.play().catch(() => undefined)
      sourceBuffer.appendBuffer(appendQueue.shift())
    } catch (error) {
      debug('MediaSource append failed', error)
    }
  }

  function ensureMediaSource(mimeType, generation) {
    if (mediaSource) return
    if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) {
      throw new Error('Browser cannot play relay ' + mimeType)
    }
    mediaSource = new MediaSource()
    mediaSourceUrl = URL.createObjectURL(mediaSource)
    video.src = mediaSourceUrl
    mediaSource.addEventListener(
      'sourceopen',
      () => {
        if (generation !== playbackGeneration || !mediaSource || mediaSource.readyState !== 'open') return
        sourceBuffer = mediaSource.addSourceBuffer(mimeType)
        sourceBuffer.addEventListener('updateend', appendNext)
        appendNext()
        video.play().catch(() => undefined)
      },
      { once: true }
    )
  }

  function queueChunk(chunk, mimeType, generation = playbackGeneration) {
    window.setTimeout(() => {
      if (generation !== playbackGeneration) return
      try {
        ensureMediaSource(mimeType || 'video/webm;codecs=vp8', generation)
        appendQueue.push(
          chunk instanceof ArrayBuffer
            ? chunk
            : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
        )
        appendNext()
      } catch (error) {
        debug(error)
      }
    }, delayMs)
  }

  function connect() {
    socket = window.io()
    socket.on('connect', emitWatches)
    socket.on('update', digestGsi)
    socket.on('player-camera:state', (state) => {
      const transportChanged = policy.transport !== state.transport
      policy = state
      if (!state.enabled || transportChanged) {
        for (const steamId of peers.keys()) closePeer(steamId)
        clearRelayPlayback()
      }
      if (forcedSteamId && forceLive) {
        setWatches(state.enabled ? forcedSteamId : null, [forcedSteamId])
      } else {
        setWatches(state.enabled ? watchedSteamId : null, state.enabled ? watchedSteamIds : [])
      }
      emitWatches()
      debug('state', state)
    })

    socket.on('player-camera:offer', async (payload) => {
      const steamId = payload?.steamId
      if (!steamId || !watchedSteamIds.includes(steamId) || policy.transport !== 'p2p') return
      closePeer(steamId, true)
      const peer = new RTCPeerConnection({ iceServers: policy.iceServers || [] })
      peers.set(steamId, peer)
      pendingIce.set(steamId, [])
      const generation = ++playbackGeneration
      if (steamId === watchedSteamId && !streams.has(steamId)) showPending(steamId)
      peer.ontrack = (event) => {
        if (peers.get(steamId) !== peer || !event.streams[0]) return
        streams.set(steamId, event.streams[0])
        if (steamId === watchedSteamId) bindStream(steamId, event.streams[0])
      }
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('player-camera:ice-from-hud', {
            viewerId: socket.id,
            steamId,
            candidate: event.candidate
          })
        }
      }
      peer.onconnectionstatechange = () => {
        debug('peer state', steamId, peer.connectionState)
        if (['failed', 'closed'].includes(peer.connectionState) && peers.get(steamId) === peer) {
          closePeer(steamId)
          if (steamId === watchedSteamId && generation === playbackGeneration) showPending(steamId)
        }
      }
      try {
        await peer.setRemoteDescription(payload.description)
        if (peers.get(steamId) !== peer) return
        const queuedIce = pendingIce.get(steamId) || []
        pendingIce.set(steamId, [])
        for (const candidate of queuedIce) {
          await peer.addIceCandidate(candidate).catch(() => undefined)
        }
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        if (peers.get(steamId) !== peer) return
        socket.emit('player-camera:answer', {
          viewerId: socket.id,
          steamId,
          description: peer.localDescription
        })
      } catch (error) {
        debug('peer negotiation failed', steamId, error)
      }
    })

    socket.on('player-camera:ice-from-player', (payload) => {
      const steamId = payload?.steamId
      const peer = steamId ? peers.get(steamId) : null
      if (!peer || !payload.candidate) return
      if (peer.remoteDescription) peer.addIceCandidate(payload.candidate).catch(() => undefined)
      else pendingIce.get(steamId)?.push(payload.candidate)
    })

    socket.on('player-camera:relay-chunk', (payload) => {
      if (payload?.steamId === watchedSteamId && policy.transport === 'relay') {
        if (payload.sequence === 0) {
          clearRelayPlayback()
          showPending(payload.steamId)
        }
        queueChunk(payload.chunk, payload.mimeType)
      }
    })

    socket.on('player-camera:player-stopped', ({ steamId }) => {
      if (!steamId) return
      closePeer(steamId)
      if (steamId === watchedSteamId) {
        clearRelayPlayback()
        hideVideo()
      }
    })
  }

  Promise.all([
    fetch('/api/settings').then((response) => response.json()),
    new Promise((resolve) => {
      if (window.io) resolve()
      else window.addEventListener('load', resolve, { once: true })
    })
  ])
    .then(([settings]) => {
      delayMs = Math.max(0, Math.min(120, Number(settings.playerCameraDelaySeconds || 0))) * 1000
      connect()
      new MutationObserver(mountVideo).observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
      })
      video.addEventListener('playing', () => {
        if (!watchedSteamId || !video.srcObject && !video.src) return
        activeSteamId = watchedSteamId
        video.classList.remove('pending')
        video.classList.add('active')
      })
      mountVideo()
      debug('ready', { delayMs, forcedSteamId, forceLive })
    })
    .catch((error) => debug('startup failed', error))

  window.playerCameraDebug = {
    state: () => ({
      policy,
      watchedSteamId,
      watchedSteamIds,
      activeSteamId,
      peerStates: Array.from(peers, ([steamId, peer]) => [steamId, peer.connectionState]),
      delayMs,
      relayQueue: appendQueue.length
    }),
    watch: (steamId) => setWatches(steamId || null, watchedSteamIds)
  }
})()