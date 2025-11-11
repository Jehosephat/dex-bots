import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api'

export interface ActivityEvent {
  id: string
  timestamp: string
  type: 'trade' | 'bridge' | 'balance' | 'error' | 'info'
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
  metadata?: {
    token?: string
    direction?: 'forward' | 'reverse'
    txHash?: string
    txSig?: string
    amount?: number
    chain?: 'galaChain' | 'solana'
    [key: string]: any
  }
}

export interface ActivityFilters {
  type?: ActivityEvent['type']
  level?: ActivityEvent['level']
  token?: string
}

export const useActivityStore = defineStore('activity', () => {
  const events = ref<ActivityEvent[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const filters = ref<ActivityFilters>({})
  const autoRefresh = ref(true)
  const autoRefreshInterval = ref<NodeJS.Timeout | null>(null)

  const fetchActivity = async (limit: number = 100, activityFilters?: ActivityFilters) => {
    loading.value = true
    error.value = null
    try {
      const params: any = { limit }
      if (activityFilters) {
        if (activityFilters.type) params.type = activityFilters.type
        if (activityFilters.level) params.level = activityFilters.level
        if (activityFilters.token) params.token = activityFilters.token
      }

      const response = await api.get<{ events: ActivityEvent[]; count: number }>('/activity', { params })
      events.value = response.data.events
      if (activityFilters) {
        filters.value = activityFilters
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch activity'
      throw e
    } finally {
      loading.value = false
    }
  }

  const startAutoRefresh = (intervalMs: number = 5000) => {
    if (autoRefreshInterval.value) {
      clearInterval(autoRefreshInterval.value)
    }
    autoRefreshInterval.value = setInterval(() => {
      if (autoRefresh.value) {
        fetchActivity(100, filters.value)
      }
    }, intervalMs)
  }

  const stopAutoRefresh = () => {
    if (autoRefreshInterval.value) {
      clearInterval(autoRefreshInterval.value)
      autoRefreshInterval.value = null
    }
  }

  return {
    events,
    loading,
    error,
    filters,
    autoRefresh,
    fetchActivity,
    startAutoRefresh,
    stopAutoRefresh
  }
})

