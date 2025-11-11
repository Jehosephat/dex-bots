import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api'
import { socketService } from '../services/socket'

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
  const isWebSocketConnected = ref(false)

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

  const addEvent = (event: ActivityEvent) => {
    // Check if event already exists (by id)
    const existingIndex = events.value.findIndex(e => e.id === event.id)
    if (existingIndex >= 0) {
      // Update existing event
      events.value[existingIndex] = event
    } else {
      // Add new event at the beginning (newest first)
      events.value.unshift(event)
      // Keep only the most recent events (limit to 200)
      if (events.value.length > 200) {
        events.value = events.value.slice(0, 200)
      }
    }
    
    // Apply current filters if any
    applyFilters()
  }

  const applyFilters = () => {
    // Filters are applied server-side, but we can also filter client-side for real-time events
    // For now, we'll rely on server-side filtering and just add new events
  }

  const startAutoRefresh = (intervalMs: number = 5000) => {
    // If WebSocket is connected, use it instead of polling
    if (isWebSocketConnected.value) {
      return
    }

    // Fallback to polling if WebSocket is not available
    if (autoRefreshInterval.value) {
      clearInterval(autoRefreshInterval.value)
    }
    autoRefreshInterval.value = setInterval(() => {
      if (autoRefresh.value && !isWebSocketConnected.value) {
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

  const setupWebSocket = () => {
    const socket = socketService.connect()
    
    socket.on('connect', () => {
      isWebSocketConnected.value = true
      console.log('Activity WebSocket connected')
      // Stop polling when WebSocket is connected
      stopAutoRefresh()
    })

    socket.on('disconnect', () => {
      isWebSocketConnected.value = false
      console.log('Activity WebSocket disconnected')
      // Resume polling if auto-refresh is enabled
      if (autoRefresh.value) {
        startAutoRefresh(5000)
      }
    })

    // Listen for new activity events
    socket.on('activity:new', (event: ActivityEvent) => {
      addEvent(event)
    })

    // Listen for activity updates (when files change)
    socket.on('activity:update', () => {
      // Refetch activity to get latest from server
      fetchActivity(100, filters.value)
    })
  }

  const disconnectWebSocket = () => {
    socketService.off('activity:new')
    socketService.off('activity:update')
  }

  return {
    events,
    loading,
    error,
    filters,
    autoRefresh,
    isWebSocketConnected,
    fetchActivity,
    addEvent,
    startAutoRefresh,
    stopAutoRefresh,
    setupWebSocket,
    disconnectWebSocket
  }
})

