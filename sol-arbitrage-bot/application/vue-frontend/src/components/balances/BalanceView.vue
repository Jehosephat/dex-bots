<template>
  <div class="balance-view">
    <div class="header-section">
      <h2>Token Balances</h2>
      <div class="header-actions">
        <button @click="refreshBalances" class="btn btn-secondary" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh from Networks' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>

    <div v-if="loading && !balances" class="loading">Loading balances...</div>

    <div v-else-if="balances" class="balances-grid">
      <!-- GalaChain Balances -->
      <div class="chain-section">
        <div class="chain-header">
          <h3>GalaChain</h3>
          <div class="chain-summary">
            <span class="total-value">Total: ${{ formatUsd(balances.galaChain.totalValueUsd) }}</span>
            <span class="last-updated">Updated: {{ formatTime(balances.galaChain.lastUpdated) }}</span>
          </div>
        </div>

        <div class="tokens-list">
          <div 
            v-for="(token, symbol) in balances.galaChain.tokens" 
            :key="symbol"
            class="balance-item"
          >
            <div class="token-info">
              <span class="token-symbol">{{ symbol }}</span>
              <span class="token-mint">{{ token.mint }}</span>
            </div>
            <div class="balance-details">
              <span class="balance-amount">{{ formatNumber(token.balance) }}</span>
              <span v-if="token.valueUsd" class="balance-usd">${{ formatUsd(token.valueUsd) }}</span>
            </div>
          </div>
          <div v-if="Object.keys(balances.galaChain.tokens).length === 0" class="empty-state">
            No token balances
          </div>
        </div>
      </div>

      <!-- Solana Balances -->
      <div class="chain-section">
        <div class="chain-header">
          <h3>Solana</h3>
          <div class="chain-summary">
            <span class="total-value">Total: ${{ formatUsd(balances.solana.totalValueUsd) }}</span>
            <span class="last-updated">Updated: {{ formatTime(balances.solana.lastUpdated) }}</span>
          </div>
        </div>
        
        <div class="native-balance">
          <div class="balance-item">
            <span class="token-symbol">SOL</span>
            <span class="balance-amount">{{ formatNumber(balances.solana.native) }}</span>
          </div>
        </div>

        <div class="tokens-list">
          <div 
            v-for="(token, symbol) in balances.solana.tokens" 
            :key="symbol"
            class="balance-item"
          >
            <div class="token-info">
              <span class="token-symbol">{{ symbol }}</span>
              <span class="token-mint">{{ token.mint }}</span>
            </div>
            <div class="balance-details">
              <span class="balance-amount">{{ formatNumber(token.balance) }}</span>
              <span v-if="token.valueUsd" class="balance-usd">${{ formatUsd(token.valueUsd) }}</span>
            </div>
          </div>
          <div v-if="Object.keys(balances.solana.tokens).length === 0" class="empty-state">
            No token balances
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useBalanceStore } from '../../stores/balances'

const balanceStore = useBalanceStore()
const { balances, loading, error } = storeToRefs(balanceStore)

const formatNumber = (value: string | number): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '0'
  if (num === 0) return '0'
  if (Math.abs(num) < 0.0001) return num.toExponential(2)
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K'
  return num.toFixed(4)
}

const formatUsd = (value: number | string | undefined): string => {
  if (value === undefined || value === null) return '0.00'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num) || num === 0) return '0.00'
  if (num < 0.01) return num.toFixed(4)
  return num.toFixed(2)
}

const formatTime = (timestamp: number | string | undefined): string => {
  if (!timestamp) return 'Unknown'
  const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp
  if (isNaN(ts)) return 'Invalid date'
  const date = new Date(ts)
  if (isNaN(date.getTime())) return 'Invalid date'
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleString()
}

const refreshBalances = async () => {
  await balanceStore.refreshBalances()
}

onMounted(async () => {
  await balanceStore.fetchBalances()
})
</script>

<style scoped>
.balance-view {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.header-section h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.balances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
  gap: 2rem;
}

.chain-section {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1.5rem;
  border: 1px solid #e9ecef;
}

.chain-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #dee2e6;
}

.chain-header h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #2c3e50;
}

.chain-summary {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  font-size: 0.875rem;
}

.total-value {
  font-weight: 600;
  color: #27ae60;
}

.last-updated {
  color: #7f8c8d;
}

.native-balance {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #dee2e6;
}

.balance-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: white;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  border: 1px solid #e9ecef;
}

.token-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.token-symbol {
  font-weight: 600;
  color: #2c3e50;
  font-size: 1rem;
}

.token-mint {
  font-size: 0.75rem;
  color: #7f8c8d;
  font-family: monospace;
}

.balance-details {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}

.balance-amount {
  font-weight: 600;
  color: #2c3e50;
  font-size: 1rem;
}

.balance-usd {
  font-size: 0.875rem;
  color: #27ae60;
}

.tokens-list {
  max-height: 600px;
  overflow-y: auto;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #7f8c8d;
  font-style: italic;
}

.error-message {
  margin-bottom: 1rem;
  padding: 1rem;
  background: #fee;
  color: #c0392b;
  border-radius: 4px;
  border: 1px solid #e74c3c;
}

.loading {
  padding: 2rem;
  text-align: center;
  color: #7f8c8d;
}

.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: #95a5a6;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background: #7f8c8d;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

