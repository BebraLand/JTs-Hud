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
  let sourceBuffer = null
  let appendQueue = []
  let delayMs = 0

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
    video.srcObject = null
    video.removeAttribute('src')
    video.load()
    delayedRecorder?.stop()
    delayedRecorder = null
    peer?.close()
    peer = null
    mediaSource = null
    sourceBuffer = null
    appendQueue = []
    video.classList.remove('active')
  }

  function appendNext() {
    if (!sourceBuffer || sourceBuffer.updating || appendQueue.length === 0) return
    try {
      sourceBuffer.appendBuffer(appendQueue.shift())
    } catch (error) {
      debug('MediaSource append failed', error)
    }
  }

  function ensureMediaSource(mimeType) {
    if (mediaSource) return
    if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) {
      throw new Error('Browser cannot play delayed/relay ' + mimeType)
    }
    mediaSource = new MediaSource()
    video.src = URL.createObjectURL(mediaSource)
    mediaSource.addEventListener(
      'sourceopen',
      () => {
        if (!mediaSource || mediaSource.readyState !== 'open') return
        sourceBuffer = mediaSource.addSourceBuffer(mimeType)
        sourceBuffer.mode = 'sequence'
        sourceBuffer.addEventListener('updateend', appendNext)
        appendNext()
        video.play().catch(() => undefined)
      },
      { once: true }
    )
  }

  function queueChunk(chunk, mimeType) {
    window.setTimeout(() => {
      try {
        ensureMediaSource(mimeType || 'video/webm;codecs=vp8')
        appendQueue.push(
          chunk instanceof ArrayBuffer
            ? chunk
            : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
        )
        appendNext()
        video.classList.add('active')
      } catch (error) {
        debug(error)
      }
    }, delayMs)
  }

  function playStream(stream) {
    mountVideo()
    if (delayMs === 0) {
      video.srcObject = stream
      video.play().catch(() => undefined)
      video.classList.add('active')
      return
    }
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type)
    )
    delayedRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    delayedRecorder.ondataavailable = async (event) => {
      if (event.data.size) queueChunk(await event.data.arrayBuffer(), delayedRecorder.mimeType)
    }
    delayedRecorder.start(1000)
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
      policy = state
      if (!state.enabled || !state.availablePlayers?.includes(watchedSteamId)) {
        clearPlayback()
      }
      if (forcedSteamId && forceLive) setWatch(state.enabled ? forcedSteamId : null)
      debug('state', state)
    })
    socket.on('player-camera:offer', async (payload) => {
      if (payload.steamId !== watchedSteamId || policy.transport !== 'p2p') return
      peer?.close()
      peer = new RTCPeerConnection({ iceServers: policy.iceServers || [] })
      peer.ontrack = (event) => playStream(event.streams[0])
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('player-camera:ice-from-hud', {
            viewerId: socket.id,
            steamId: payload.steamId,
            candidate: event.candidate
          })
        }
      }
      await peer.setRemoteDescription(payload.description)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      socket.emit('player-camera:answer', {
        viewerId: socket.id,
        steamId: payload.steamId,
        description: peer.localDescription
      })
    })
    socket.on('player-camera:ice-from-player', (payload) => {
      if (payload.steamId === watchedSteamId) {
        peer?.addIceCandidate(payload.candidate).catch(() => undefined)
      }
    })
    socket.on('player-camera:relay-chunk', (payload) => {
      if (payload.steamId === watchedSteamId && policy.transport === 'relay') {
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
      window.setInterval(mountVideo, 500)
      debug('ready', { delayMs, forcedSteamId, forceLive })
    })
    .catch((error) => debug('startup failed', error))

  window.playerCameraDebug = {
    state: () => ({ policy, watchedSteamId, delayMs, peerState: peer?.connectionState || null }),
    watch: (steamId) => setWatch(steamId || null)
  }
})()
