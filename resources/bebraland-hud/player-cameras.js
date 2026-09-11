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
  let policy = { enabled: false, transport: 'p2p' }
  let watchedSteamId = null
  let peer = null
  let delayedRecorder = null
  let mediaSource = null
  let mediaSourceUrl = null
  let sourceBuffer = null
  let appendQueue = []
  let delayMs = 0
  let playbackGeneration = 0
  let activeSteamId = null
  let pendingPlayerIce = []

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

  function clearPlayback() {
    playbackGeneration += 1
    activeSteamId = null
    video.srcObject = null
    video.removeAttribute('src')
    video.load()
    delayedRecorder?.stop()
    delayedRecorder = null
    peer?.close()
    peer = null
    pendingPlayerIce = []
    mediaSource = null
    sourceBuffer = null
    appendQueue = []
    if (mediaSourceUrl) URL.revokeObjectURL(mediaSourceUrl)
    mediaSourceUrl = null
    video.classList.remove('active')
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
      throw new Error('Browser cannot play delayed/relay ' + mimeType)
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

  function playStream(stream, steamId, generation) {
    if (generation !== playbackGeneration || steamId !== watchedSteamId) return
    mountVideo()
    if (delayMs === 0) {
      video.srcObject = stream
      video.play().catch(() => undefined)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (generation === playbackGeneration) clearPlayback()
      })
      return
    }
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type)
    )
    delayedRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    delayedRecorder.ondataavailable = async (event) => {
      if (event.data.size && generation === playbackGeneration) {
        queueChunk(await event.data.arrayBuffer(), delayedRecorder.mimeType, generation)
      }
    }
    delayedRecorder.start(250)
  }

  function setWatch(steamId) {
    if (steamId === watchedSteamId) return
    clearPlayback()
    watchedSteamId = steamId
    socket.emit('player-camera:watch', steamId)
    debug('watch', steamId)
  }

  function digestGsi(state) {
    const isLive =
      forceLive || Boolean(state?.player?.steamid)
    const steamId = forcedSteamId || state?.player?.steamid || null
    setWatch(policy.enabled && isLive ? steamId : null)
  }

  function connect() {
    socket = window.io()
    socket.on('connect', () => {
      if (watchedSteamId) socket.emit('player-camera:watch', watchedSteamId)
    })
    socket.on('update', digestGsi)
    socket.on('player-camera:state', (state) => {
      const transportChanged = policy.transport !== state.transport
      policy = state
      if (!state.enabled || transportChanged) clearPlayback()
      if (forcedSteamId && forceLive) setWatch(state.enabled ? forcedSteamId : null)
      debug('state', state)
    })
    socket.on('player-camera:offer', async (payload) => {
      if (payload.steamId !== watchedSteamId || policy.transport !== 'p2p') return
      clearPlayback()
      const generation = playbackGeneration
      const nextPeer = new RTCPeerConnection({ iceServers: policy.iceServers || [] })
      peer = nextPeer
      nextPeer.ontrack = (event) => {
        if (peer === nextPeer && event.streams[0]) {
          playStream(event.streams[0], payload.steamId, generation)
        }
      }
      nextPeer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('player-camera:ice-from-hud', {
            viewerId: socket.id,
            steamId: payload.steamId,
            candidate: event.candidate
          })
        }
      }
      nextPeer.onconnectionstatechange = () => debug('peer state', nextPeer.connectionState)
      await nextPeer.setRemoteDescription(payload.description)
      if (peer !== nextPeer || generation !== playbackGeneration) return
      const queuedIce = pendingPlayerIce
      pendingPlayerIce = []
      for (const candidate of queuedIce) {
        await nextPeer.addIceCandidate(candidate).catch(() => undefined)
      }
      const answer = await nextPeer.createAnswer()
      await nextPeer.setLocalDescription(answer)
      if (peer !== nextPeer || generation !== playbackGeneration) return
      socket.emit('player-camera:answer', {
        viewerId: socket.id,
        steamId: payload.steamId,
        description: nextPeer.localDescription
      })
    })
    socket.on('player-camera:ice-from-player', (payload) => {
      if (payload.steamId !== watchedSteamId || !peer) return
      if (peer.remoteDescription) peer.addIceCandidate(payload.candidate).catch(() => undefined)
      else pendingPlayerIce.push(payload.candidate)
    })
    socket.on('player-camera:relay-chunk', (payload) => {
      if (payload.steamId === watchedSteamId && policy.transport === 'relay') {
        if (payload.sequence === 0) clearPlayback()
        queueChunk(payload.chunk, payload.mimeType)
      }
    })
    socket.on('player-camera:player-stopped', ({ steamId }) => {
      if (steamId === watchedSteamId) clearPlayback()
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
        activeSteamId = watchedSteamId
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
      activeSteamId,
      delayMs,
      peerState: peer?.connectionState || null,
      relayQueue: appendQueue.length
    }),
    watch: (steamId) => setWatch(steamId || null)
  }
})()
