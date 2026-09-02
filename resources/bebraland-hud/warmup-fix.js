(() => {
  const style = document.createElement('style')
  style.textContent = `
    #timer.jts-warmup #round_now,
    #timer.jts-warmup #round_timer_text { visibility: hidden; }
    #timer.jts-warmup::after {
      content: 'WARMUP';
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: #fff;
      font-size: 20px;
      font-weight: 700;
      z-index: 1;
    }
  `
  document.head.append(style)

  let warmup = false
  let releaseTimer = 0

  const render = () => {
    const timer = document.querySelector('#timer')
    if (!timer) return

    timer.classList.toggle('jts-warmup', warmup)
  }

  const setPhase = (nextWarmup) => {
    clearTimeout(releaseTimer)
    if (nextWarmup) {
      warmup = true
      render()
      return
    }

    // Let the already-emitted Socket.IO update paint the first live round before revealing it.
    releaseTimer = setTimeout(() => {
      warmup = false
      render()
    }, 100)
  }

  new MutationObserver(render).observe(document.body, { childList: true, subtree: true })
  const stream = new EventSource('/api/gsi/phase')
  stream.onmessage = ({ data }) => {
    try {
      setPhase(JSON.parse(data).warmup === true)
    } catch {
      // EventSource reconnects automatically if the server restarts.
    }
  }
})()
