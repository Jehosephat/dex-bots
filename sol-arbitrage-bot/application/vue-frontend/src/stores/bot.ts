import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api'

export interface BotStatus {
  status: 'running' | 'stopped' | 'paused' | 'error'
  mode?: 'live' | 'dry_run'
  pid?: number
  uptime?: number
  lastCycle?: string
  error?: string
}

export const useBotStore = defineStore('bot', () => {
  const status = ref<BotStatus>({ status: 'stopped' })
  const loading = ref(false)

  const fetchStatus = async () => {
    loading.value = true
    try {
      const response = await api.get<BotStatus>('/bot/status')
      status.value = response.data
    } catch (error) {
      console.error('Failed to fetch bot status:', error)
      status.value = { 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    } finally {
      loading.value = false
    }
  }

  const start = async (mode: 'live' | 'dry_run' = 'dry_run') => {
    loading.value = true
    try {
      const response = await api.post<BotStatus>('/bot/start', { mode })
      status.value = response.data
    } catch (error) {
      console.error('Failed to start bot:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  const stop = async () => {
    loading.value = true
    try {
      const response = await api.post<BotStatus>('/bot/stop')
      status.value = response.data
    } catch (error) {
      console.error('Failed to stop bot:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  const pause = async () => {
    loading.value = true
    try {
      const response = await api.post<BotStatus>('/bot/pause')
      status.value = response.data
    } catch (error) {
      console.error('Failed to pause bot:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  const resume = async () => {
    loading.value = true
    try {
      const response = await api.post<BotStatus>('/bot/resume')
      status.value = response.data
    } catch (error) {
      console.error('Failed to resume bot:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  return {
    status,
    loading,
    fetchStatus,
    start,
    stop,
    pause,
    resume
  }
})

