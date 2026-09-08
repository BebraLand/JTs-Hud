(() => {
  const enabledKey = '__jts_webcams_enabled__';
  const delayKey = '__jts_webcams_delay__';
  const playersKey = '__jts_webcams_players__';
  const cached = sessionStorage.getItem(enabledKey) === '1';
  const cachedDelay = Number(sessionStorage.getItem(delayKey) || 0);
  const cachedPlayers = sessionStorage.getItem(playersKey) || '';
  window.__JTS_WEBCAMS_ENABLED__ = cached;
  window.__JTS_WEBCAM_PLAYERS__ = cachedPlayers ? cachedPlayers.split(',').filter(Boolean) : [];
  window.__JTS_WEBCAM_DELAY_SECONDS__ = Number.isFinite(cachedDelay) ? cachedDelay : 0;

  const nativeSrcObject = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  const delayed = new WeakMap();
  const delayedMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8'
    : 'video/webm';

  const stopDelayed = (video) => {
    const state = delayed.get(video);
    if (!state) return;
    state.recorder.stop();
    state.timer && clearInterval(state.timer);
    delayed.delete(video);
  };

  const delayVideo = (video, stream, seconds) => {
    stopDelayed(video);
    const state = { queue: [], recorder: null, sourceBuffer: null, timer: null, mediaSource: new MediaSource() };
    delayed.set(video, state);
    const objectUrl = URL.createObjectURL(state.mediaSource);
    video.removeAttribute('src');
    video.src = objectUrl;
    const pump = () => {
      if (!state.sourceBuffer || state.sourceBuffer.updating || !state.queue.length) return;
      if (state.queue[0].due > performance.now()) return;
      state.sourceBuffer.appendBuffer(state.queue.shift().data);
    };
    state.mediaSource.addEventListener('sourceopen', () => {
      state.sourceBuffer = state.mediaSource.addSourceBuffer(delayedMime);
      state.timer = setInterval(pump, 100);
      video.play().catch(() => undefined);
    }, { once: true });
    state.recorder = new MediaRecorder(stream, { mimeType: delayedMime });
    state.recorder.ondataavailable = (event) => {
      if (event.data.size) event.data.arrayBuffer().then((data) => state.queue.push({ data, due: performance.now() + seconds * 1000 }));
    };
    state.recorder.start(250);
  };

  if (nativeSrcObject?.set && nativeSrcObject.get) {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: nativeSrcObject.configurable,
      enumerable: nativeSrcObject.enumerable,
      get: nativeSrcObject.get,
      set(stream) {
        if (this.classList.contains('video-call-preview') && stream && window.__JTS_WEBCAM_DELAY_SECONDS__ > 0) {
          delayVideo(this, stream, window.__JTS_WEBCAM_DELAY_SECONDS__);
          return;
        }
        if (!stream) stopDelayed(this);
        nativeSrcObject.set.call(this, stream);
      }
    });
  }

  fetch('/api/camera', { cache: 'no-store' })
    .then((response) => response.json())
    .then((state) => {
      const enabled = Array.isArray(state.availablePlayers) && state.availablePlayers.length > 0;
      const delay = Number(state.delaySeconds) || 0;
      const players = (state.availablePlayers || []).map((player) => player.steamid).sort().join(',');
      window.__JTS_WEBCAM_PLAYERS__ = players ? players.split(',') : [];
      if (enabled === cached && delay === window.__JTS_WEBCAM_DELAY_SECONDS__ && players === cachedPlayers) return;
      sessionStorage.setItem(enabledKey, enabled ? '1' : '0');
      sessionStorage.setItem(delayKey, String(delay));
      sessionStorage.setItem(playersKey, players);
      window.location.reload();
    })
    .catch(() => undefined);
})();
