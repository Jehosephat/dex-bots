import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api'

export interface TokenConfig {
  symbol: string
  enabled: boolean
  tradeSize: number
  decimals: number
  galaChainMint: string
  solanaMint: string
  solanaSymbol?: string
  gcQuoteVia?: string
  solQuoteVia?: string
  minBalanceGc?: number
  minBalanceSol?: number
  cooldownMinutes?: number
}

export interface BridgingConfig {
  enabled: boolean
  imbalanceThresholdPercent: number
  targetSplitPercent: number
  minRebalanceAmount: number
  checkIntervalMinutes: number
  cooldownMinutes: number
  maxBridgesPerDay: number
  enabledTokens: string[]
  skipTokens: string[]
}

export interface InventoryConfig {
  minSolForFees: number
  minGalaForReverse: number
  balanceCheckCooldownSeconds: number
  skipTokens: string[]
}

export const useConfigStore = defineStore('config', () => {
  const tokens = ref<TokenConfig[]>([])
  const bridgingConfig = ref<BridgingConfig | null>(null)
  const inventoryConfig = ref<InventoryConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Token methods
  const fetchTokens = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<TokenConfig[]>('/config/tokens')
      tokens.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch tokens'
      throw e
    } finally {
      loading.value = false
    }
  }

  const getToken = async (symbol: string) => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<TokenConfig>(`/config/tokens/${symbol}`)
      return response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch token'
      throw e
    } finally {
      loading.value = false
    }
  }

  const addToken = async (token: TokenConfig) => {
    loading.value = true
    error.value = null
    try {
      const response = await api.post<TokenConfig>('/config/tokens', token)
      await fetchTokens() // Refresh list
      return response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to add token'
      throw e
    } finally {
      loading.value = false
    }
  }

  const updateToken = async (symbol: string, updates: Partial<TokenConfig>) => {
    loading.value = true
    error.value = null
    try {
      const response = await api.put<TokenConfig>(`/config/tokens/${symbol}`, updates)
      await fetchTokens() // Refresh list
      return response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update token'
      throw e
    } finally {
      loading.value = false
    }
  }

  const deleteToken = async (symbol: string) => {
    loading.value = true
    error.value = null
    try {
      await api.delete(`/config/tokens/${symbol}`)
      await fetchTokens() // Refresh list
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete token'
      throw e
    } finally {
      loading.value = false
    }
  }

  // Bridging config methods
  const fetchBridgingConfig = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<BridgingConfig>('/config/bridging')
      bridgingConfig.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch bridging config'
      throw e
    } finally {
      loading.value = false
    }
  }

  const updateBridgingConfig = async (updates: Partial<BridgingConfig>) => {
    loading.value = true
    error.value = null
    try {
      const response = await api.put<BridgingConfig>('/config/bridging', updates)
      bridgingConfig.value = response.data
      return response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update bridging config'
      throw e
    } finally {
      loading.value = false
    }
  }

  // Inventory config methods
  const fetchInventoryConfig = async () => {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<InventoryConfig>('/config/inventory')
      inventoryConfig.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch inventory config'
      throw e
    } finally {
      loading.value = false
    }
  }

  const updateInventoryConfig = async (updates: Partial<InventoryConfig>) => {
    loading.value = true
    error.value = null
    try {
      const response = await api.put<InventoryConfig>('/config/inventory', updates)
      inventoryConfig.value = response.data
      return response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update inventory config'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    tokens,
    bridgingConfig,
    inventoryConfig,
    loading,
    error,
    fetchTokens,
    getToken,
    addToken,
    updateToken,
    deleteToken,
    fetchBridgingConfig,
    updateBridgingConfig,
    fetchInventoryConfig,
    updateInventoryConfig
  }
})

