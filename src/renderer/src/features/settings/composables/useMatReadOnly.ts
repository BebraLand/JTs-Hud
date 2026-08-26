import { computed, onMounted, onUnmounted, ref } from 'vue'
import { API_URL } from '../../../index'
import { socket } from '../../../socket'
import type { MatStatus } from './useSettings'

export function useMatReadOnly() {
  const matStatus = ref<MatStatus | null>(null)
  const isMatReadOnly = computed(
    () => matStatus.value?.state === 'connected' || matStatus.value?.state === 'stale'
  )

  const onMatStatus = (status: MatStatus) => {
    matStatus.value = status
  }

  onMounted(async () => {
    socket.on('mat:status', onMatStatus)
    try {
      const response = await fetch(`${API_URL}/settings/mat/status`)
      if (response.ok && !matStatus.value) matStatus.value = await response.json()
    } catch {
      // The socket status event remains the source of truth if the request fails.
    }
  })

  onUnmounted(() => socket.off('mat:status', onMatStatus))

  return { matStatus, isMatReadOnly }
}
