import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serviceApi } from '../api/index.js'

// Canonical lifecycle statuses shared with the backend. `phase` mirrors
// `status` and `ready` is derived from it — the UI never stores either
// independently, so the list, badges and logs page cannot drift apart.
export const STATUS = Object.freeze({
  STOPPED: 'stopped',
  PREPARING: 'preparing',
  READY: 'ready',
  STOPPING: 'stopping',
  FAILED: 'failed',
})

export const STATUS_LABELS = Object.freeze({
  stopped: '已停止',
  preparing: '准备中',
  ready: '就绪',
  stopping: '停止中',
  failed: '失败',
})

// Element Plus tag type per status — single place of truth for all badges.
export const STATUS_TAG_TYPE = Object.freeze({
  stopped: 'info',
  preparing: 'warning',
  ready: 'success',
  stopping: 'warning',
  failed: 'danger',
})

export const useServiceStore = defineStore('services', () => {
  const services = ref([])
  const loading = ref(false)
  const busy = ref({}) // serviceId -> in-flight action
  const lastError = ref(null)
  let pollTimer = null

  const byStatus = computed(() => {
    const groups = { preparing: [], ready: [], failed: [], stopping: [], stopped: [] }
    for (const s of services.value) groups[s.status]?.push(s)
    return groups
  })

  // Replace list using status only; phase/ready are read from the server
  // projection (already derived) and never recomputed into separate state.
  async function fetchServices() {
    try {
      const res = await serviceApi.list()
      services.value = res.data.map(s => ({
        ...s,
        phase: s.status,
        ready: s.status === STATUS.READY,
      }))
      lastError.value = null
    } catch (err) {
      lastError.value = err.response?.data?.error || 'Failed to load services'
    }
  }

  async function _withBusy(id, fn) {
    busy.value = { ...busy.value, [id]: true }
    try {
      return await fn()
    } finally {
      busy.value = { ...busy.value, [id]: false }
      await fetchServices()
    }
  }

  const start = (id) => _withBusy(id, () => serviceApi.start(id))
  const stop = (id) => _withBusy(id, () => serviceApi.stop(id))
  const restart = (id) => _withBusy(id, () => serviceApi.restart(id))
  const cleanup = (id) => _withBusy(id, () => serviceApi.cleanup(id))

  async function stopAll() {
    loading.value = true
    try {
      await serviceApi.stopAll()
      await fetchServices()
    } finally {
      loading.value = false
    }
  }

  async function fetchLogs(id, params) {
    const res = await serviceApi.logs(id, params)
    return res.data
  }

  // Board pages poll while mounted so a child that exits (ready -> failed)
  // or a released port (failed -> stopped after recovery) shows up without
  // a manual refresh.
  function startPolling(intervalMs = 2000) {
    stopPolling()
    fetchServices()
    pollTimer = setInterval(fetchServices, intervalMs)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  return {
    services, loading, busy, lastError, byStatus,
    fetchServices, start, stop, restart, cleanup, stopAll,
    fetchLogs, startPolling, stopPolling,
  }
})
