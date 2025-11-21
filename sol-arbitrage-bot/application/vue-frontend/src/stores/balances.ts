import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api'

export interface TokenBalance {
  symbol: string
  mint: string
  rawBalance: string
  balance: string
  decimals: number
  valueUsd?: number
  lastUpdated: number
}

export interface ChainBalances {
  tokens: Record<string, TokenBalance>
  native: string
  totalValueUsd: number
  lastUpdated: number
}

export interface AllBalances {
  galaChain: ChainBalances
  solana: ChainBalances
  lastUpdated: number
  version?: number
}

export const useBalanceStore = defineStore('balances', () => {
  const balances = ref<AllBalances | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchBalances = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<AllBalances>('/balances')
      balances.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch balances'
      throw e
    } finally {
      loading.value = false
    }
  }

  const refreshBalances = async () => {
    // Just re-fetch from state.json, don't call network refresh
    await fetchBalances()
  }

  return {
    balances,
    loading,
    error,
    fetchBalances,
    refreshBalances
  }
})

