import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api'

export interface TradeLogEntry {
  timestamp: string
  mode: 'live' | 'dry_run'
  token: string
  tradeSize: number
  direction?: 'forward' | 'reverse'
  success: boolean
  expectedGalaChainProceeds?: number
  expectedSolanaCost?: number
  expectedSolanaCostGala?: number
  expectedNetEdge?: number
  expectedNetEdgeBps?: number
  actualGalaChainProceeds?: number
  actualSolanaCost?: number
  actualSolanaCostGala?: number
  actualNetEdge?: number
  actualNetEdgeBps?: number
  galaChainTxHash?: string
  solanaTxSig?: string
  galaChainSuccess?: boolean
  solanaSuccess?: boolean
  galaChainError?: string
  solanaError?: string
  galaChainPrice?: number
  galaChainPriceCurrency?: string
  solanaPrice?: number
  solanaPriceCurrency?: string
  priceImpactGcBps?: number
  priceImpactSolBps?: number
  executionDurationMs?: number
}

export interface TradeStats {
  totalTrades: number
  successfulTrades: number
  failedTrades: number
  totalProfitGala: number
  totalProfitUsd: number
  averageEdgeBps: number
  winRate: number
}

export interface TradeFilters {
  token?: string
  direction?: 'forward' | 'reverse'
  success?: boolean
  mode?: 'live' | 'dry_run'
}

export const useTradesStore = defineStore('trades', () => {
  const trades = ref<TradeLogEntry[]>([])
  const stats = ref<TradeStats | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const pagination = ref({
    page: 1,
    limit: 50,
    total: 0
  })
  const filters = ref<TradeFilters>({})

  const fetchTrades = async (page: number = 1, limit: number = 50, tradeFilters?: TradeFilters) => {
    loading.value = true
    error.value = null
    try {
      const params: any = { page, limit }
      if (tradeFilters) {
        if (tradeFilters.token) params.token = tradeFilters.token
        if (tradeFilters.direction) params.direction = tradeFilters.direction
        if (tradeFilters.success !== undefined) params.success = tradeFilters.success
        if (tradeFilters.mode) params.mode = tradeFilters.mode
      }
      
      const response = await api.get<{ trades: TradeLogEntry[]; total: number; page: number; limit: number }>('/trades', { params })
      trades.value = response.data.trades
      pagination.value = {
        page: response.data.page,
        limit: response.data.limit,
        total: response.data.total
      }
      if (tradeFilters) {
        filters.value = tradeFilters
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch trades'
      throw e
    } finally {
      loading.value = false
    }
  }

  const fetchStats = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<TradeStats>('/trades/stats')
      stats.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch trade statistics'
      throw e
    } finally {
      loading.value = false
    }
  }

  const getTrade = async (timestamp: string) => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<TradeLogEntry>(`/trades/${timestamp}`)
      return response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch trade'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    trades,
    stats,
    loading,
    error,
    pagination,
    filters,
    fetchTrades,
    fetchStats,
    getTrade
  }
})

