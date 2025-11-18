<template>
  <div class="trading-config">
    <h2>Trading Configuration</h2>
    <div v-if="error" class="error-message">{{ error }}</div>
    <div v-if="loading && !config" class="loading">Loading configuration...</div>
    <div v-else-if="!config" class="empty-state">
      Failed to load configuration. Please check the API server.
    </div>
    <div v-else class="config-form">
      <p class="info-text">Configure trading parameters and dynamic slippage settings</p>
      <form @submit.prevent="saveConfig">
        <div class="form-section">
          <h3>Basic Trading Parameters</h3>
          
          <div class="form-row">
            <div class="form-group">
              <label>Min Edge (bps)</label>
              <input 
                v-model.number="formData.minEdgeBps" 
                type="number" 
                min="0"
                max="10000"
                required
              />
              <small>Minimum edge in basis points to execute a trade</small>
            </div>

            <div class="form-group">
              <label>Max Slippage (bps)</label>
              <input 
                v-model.number="formData.maxSlippageBps" 
                type="number" 
                min="0"
                max="10000"
                required
              />
              <small>Base slippage tolerance in basis points</small>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Risk Buffer (bps)</label>
              <input 
                v-model.number="formData.riskBufferBps" 
                type="number" 
                min="0"
                max="10000"
                required
              />
              <small>Risk buffer added to costs</small>
            </div>

            <div class="form-group">
              <label>Max Price Impact (bps)</label>
              <input 
                v-model.number="formData.maxPriceImpactBps" 
                type="number" 
                min="0"
                max="10000"
                required
              />
              <small>Maximum acceptable price impact</small>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Cooldown (minutes)</label>
              <input 
                v-model.number="formData.cooldownMinutes" 
                type="number" 
                min="0"
                required
              />
            </div>

            <div class="form-group">
              <label>Max Daily Trades</label>
              <input 
                v-model.number="formData.maxDailyTrades" 
                type="number" 
                min="1"
                required
              />
            </div>
          </div>
        </div>

        <div class="form-section">
          <h3>Dynamic Slippage Configuration</h3>
          <p class="section-description">
            Dynamic slippage adjusts tolerance based on expected edge. Higher edge = higher allowed slippage.
          </p>

          <div class="form-row">
            <div class="form-group">
              <label>Max Slippage Multiplier</label>
              <input 
                v-model.number="formData.dynamicSlippageMaxMultiplier" 
                type="number" 
                min="1"
                max="10"
                step="0.1"
                required
              />
              <small>Maximum slippage = base slippage × this multiplier (e.g., 2.0 = 2x base)</small>
            </div>

            <div class="form-group">
              <label>Edge Ratio (0-1)</label>
              <input 
                v-model.number="formData.dynamicSlippageEdgeRatio" 
                type="number" 
                min="0"
                max="1"
                step="0.01"
                required
              />
              <small>Percentage of edge allowed as slippage (e.g., 0.75 = 75% of edge)</small>
            </div>
          </div>

          <div class="example-box">
            <strong>Example:</strong>
            <p>If base slippage = 50 bps, multiplier = 2.0, edge ratio = 0.75:</p>
            <ul>
              <li>Edge of 200 bps (2%) → Allowed slippage = 150 bps (1.5%)</li>
              <li>Edge of 100 bps (1%) → Allowed slippage = 75 bps (0.75%)</li>
              <li>Max cap = 50 × 2.0 = 100 bps (1%)</li>
            </ul>
          </div>
        </div>

        <div class="form-section">
          <h3>Reverse Arbitrage</h3>
          
          <div class="form-group">
            <label>
              <input type="checkbox" v-model="formData.enableReverseArbitrage" />
              Enable Reverse Arbitrage
            </label>
            <small>Allow buying on GalaChain and selling on Solana</small>
          </div>

          <div class="form-row" v-if="formData.enableReverseArbitrage">
            <div class="form-group">
              <label>Reverse Min Edge (bps)</label>
              <input 
                v-model.number="formData.reverseArbitrageMinEdgeBps" 
                type="number" 
                min="0"
                max="10000"
              />
              <small>Minimum edge for reverse trades (defaults to minEdgeBps if not set)</small>
            </div>

            <div class="form-group">
              <label>Arbitrage Direction</label>
              <select v-model="formData.arbitrageDirection">
                <option value="forward">Forward Only</option>
                <option value="reverse">Reverse Only</option>
                <option value="best">Best (Auto)</option>
              </select>
              <small>Force direction or choose best opportunity</small>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary" :disabled="loading">
            {{ loading ? 'Saving...' : 'Save Configuration' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '../../stores/config'

const configStore = useConfigStore()
const { tradingConfig, loading, error } = storeToRefs(configStore)
const config = computed(() => tradingConfig.value)

const formData = ref({
  minEdgeBps: 30,
  maxSlippageBps: 50,
  riskBufferBps: 10,
  maxPriceImpactBps: 250,
  cooldownMinutes: 5,
  maxDailyTrades: 100,
  enableReverseArbitrage: true,
  reverseArbitrageMinEdgeBps: 30,
  arbitrageDirection: 'best' as 'forward' | 'reverse' | 'best',
  dynamicSlippageMaxMultiplier: 2.0,
  dynamicSlippageEdgeRatio: 0.75
})

const saveConfig = async () => {
  try {
    await configStore.updateTradingConfig(formData.value)
    alert('Configuration saved successfully!')
  } catch (e) {
    // Error handled by store
  }
}

onMounted(async () => {
  try {
    await configStore.fetchTradingConfig()
    if (configStore.tradingConfig) {
      formData.value = { ...configStore.tradingConfig }
    }
  } catch (e) {
    console.error('Failed to fetch trading config:', e)
  }
})
</script>

<style scoped>
.trading-config {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.trading-config h2 {
  margin: 0 0 1rem 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.trading-config h3 {
  margin: 0 0 1rem 0;
  font-size: 1.2rem;
  color: #34495e;
  border-bottom: 2px solid #ecf0f1;
  padding-bottom: 0.5rem;
}

.info-text {
  color: #7f8c8d;
  margin-bottom: 2rem;
}

.section-description {
  color: #7f8c8d;
  margin-bottom: 1.5rem;
  font-size: 0.9rem;
}

.config-form {
  max-width: 1000px;
}

.form-section {
  margin-bottom: 2.5rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid #ecf0f1;
}

.form-section:last-of-type {
  border-bottom: none;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #2c3e50;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

.form-group input[type="checkbox"] {
  margin-right: 0.5rem;
}

.form-group small {
  display: block;
  margin-top: 0.25rem;
  color: #7f8c8d;
  font-size: 0.875rem;
}

.example-box {
  margin-top: 1.5rem;
  padding: 1rem;
  background: #f8f9fa;
  border-left: 4px solid #3498db;
  border-radius: 4px;
}

.example-box strong {
  display: block;
  margin-bottom: 0.5rem;
  color: #2c3e50;
}

.example-box p {
  margin: 0.5rem 0;
  color: #7f8c8d;
}

.example-box ul {
  margin: 0.5rem 0 0 1.5rem;
  color: #7f8c8d;
}

.example-box li {
  margin: 0.25rem 0;
}

.form-actions {
  margin-top: 2rem;
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

.btn-primary {
  background: #3498db;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2980b9;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #7f8c8d;
  background: #f8f9fa;
  border-radius: 4px;
}
</style>

