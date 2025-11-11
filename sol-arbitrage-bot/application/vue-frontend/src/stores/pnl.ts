import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api'

export interface PnLSummary {
  totalTrades: number
  successfulTrades: number
  failedTrades: number
  totalExpectedEdge: number
  totalActualEdge?: number
  totalExpectedEdgeBps: number
  totalActualEdgeBps?: number
  winRate: number
  totalVolume: number
  averageEdgeBps: number
  period: {
    start: string
    end: string
  }
}

export interface TokenPnL {
  token: string
  trades: number
  successfulTrades: number
  totalExpectedEdge: number
  totalActualEdge?: number
  totalVolume: number
  averageEdgeBps: number
}

export interface PnLBreakdown {
  summary: PnLSummary
  byToken: TokenPnL[]
  byDirection: {
    forward: PnLSummary
    reverse: PnLSummary
  }
  byTimePeriod: {
    today: PnLSummary
    week: PnLSummary
    month: PnLSummary
    allTime: PnLSummary
  }
}

export interface InventoryValue {
  galaChain: Record<string, number>
  solana: Record<string, number>
  totalUsd?: number
  updatedAt: string
}

export const usePnLStore = defineStore('pnl', () => {
  const summary = ref<PnLSummary | null>(null)
  const breakdown = ref<PnLBreakdown | null>(null)
  const inventory = ref<InventoryValue | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchSummary = async (filters?: {
    startDate?: string
    endDate?: string
    token?: string
    direction?: 'forward' | 'reverse'
    mode?: 'live' | 'dry_run'
  }) => {
    loading.value = true
    error.value = null
    try {
      const params: any = {}
      if (filters?.startDate) params.startDate = filters.startDate
      if (filters?.endDate) params.endDate = filters.endDate
      if (filters?.token) params.token = filters.token
      if (filters?.direction) params.direction = filters.direction
      if (filters?.mode) params.mode = filters.mode

      const response = await api.get<PnLSummary>('/pnl/summary', { params })
      summary.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch P&L summary'
      throw e
    } finally {
      loading.value = false
    }
  }

  const fetchBreakdown = async (filters?: {
    startDate?: string
    endDate?: string
    mode?: 'live' | 'dry_run'
  }) => {
    loading.value = true
    error.value = null
    try {
      const params: any = {}
      if (filters?.startDate) params.startDate = filters.startDate
      if (filters?.endDate) params.endDate = filters.endDate
      if (filters?.mode) params.mode = filters.mode

      const response = await api.get<PnLBreakdown>('/pnl/breakdown', { params })
      breakdown.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch P&L breakdown'
      throw e
    } finally {
      loading.value = false
    }
  }

  const fetchInventory = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<InventoryValue>('/pnl/inventory')
      inventory.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch inventory'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    summary,
    breakdown,
    inventory,
    loading,
    error,
    fetchSummary,
    fetchBreakdown,
    fetchInventory
  }
})

