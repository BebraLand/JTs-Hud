(() => {
  let warmup = null

  const isWarmup = (state) => {
    const mapPhase = String(state?.map?.phase || '').toLowerCase()
    const countdownPhase = String(state?.phase_countdowns?.phase || '').toLowerCase()
    return mapPhase === 'warmup' || countdownPhase === 'warmup'
  }

  const render = () => {
    if (warmup === null) return

    const timer = document.querySelector('#timer')
    const round = document.querySelector('#round_now')
    const timerText = document.querySelector('#round_timer_text')
    if (!timer || !round || !timerText) return

    timer.classList.toggle('jts-warmup', warmup)
    round.style.display = warmup ? 'none' : ''
    timerText.style.height = warmup ? '100%' : ''
    timerText.style.fontSize = warmup ? '20px' : ''
    timerText.style.alignItems = warmup ? 'center' : ''
    if (warmup && timerText.textContent.trim() !== 'WARMUP') timerText.textContent = 'WARMUP'
  }

  const readState = async () => {
    try {
      const response = await fetch('/api/gsi/state', { cache: 'no-store' })
      if (!response.ok) return
      warmup = isWarmup(await response.json())
      render()
    } catch {
      // The HUD can still render normally when the local GSI listener is down.
    }
  }

  new MutationObserver(render).observe(document.body, { childList: true, subtree: true })
  readState()
  setInterval(readState, 500)
})()
