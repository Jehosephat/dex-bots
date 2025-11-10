<template>
  <div class="bridging-config">
    <h2>Auto-Bridging Configuration</h2>
    <div v-if="error" class="error-message">{{ error }}</div>
    <div v-if="loading && !config" class="loading">Loading configuration...</div>
    <div v-else-if="!config" class="empty-state">
      Failed to load configuration. Please check the API server.
    </div>
    <div v-else class="config-form">
      <p class="info-text">Configure automatic token rebalancing between GalaChain and Solana</p>
      <form @submit.prevent="saveConfig">
        <div class="form-group">
          <label>
            <input type="checkbox" v-model="formData.enabled" />
            Enable Auto-Bridging
          </label>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Imbalance Threshold (%)</label>
            <input 
              v-model.number="formData.imbalanceThresholdPercent" 
              type="number" 
              min="0"
              max="100"
              required
            />
            <small>Trigger rebalancing when split exceeds this threshold</small>
          </div>

          <div class="form-group">
            <label>Target Split (%)</label>
            <input 
              v-model.number="formData.targetSplitPercent" 
              type="number" 
              min="0"
              max="100"
              required
            />
            <small>Target percentage on GalaChain (rest on Solana)</small>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Min Rebalance Amount</label>
            <input 
              v-model.number="formData.minRebalanceAmount" 
              type="number" 
              min="0"
              required
            />
            <small>Minimum USD value to trigger a bridge</small>
          </div>

          <div class="form-group">
            <label>Check Interval (minutes)</label>
            <input 
              v-model.number="formData.checkIntervalMinutes" 
              type="number" 
              min="1"
              required
            />
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
            <label>Max Bridges Per Day</label>
            <input 
              v-model.number="formData.maxBridgesPerDay" 
              type="number" 
              min="1"
              required
            />
          </div>
        </div>

        <div class="form-group">
          <label>Enabled Tokens (comma-separated)</label>
          <input 
            v-model="enabledTokensStr" 
            type="text" 
            placeholder="SOL, MEW, USDUC, GALA"
          />
          <small>Tokens to include in auto-bridging</small>
        </div>

        <div class="form-group">
          <label>Skip Tokens (comma-separated)</label>
          <input 
            v-model="skipTokensStr" 
            type="text" 
            placeholder="FARTCOIN, TRUMP"
          />
          <small>Tokens to exclude from auto-bridging</small>
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
const { bridgingConfig, loading, error } = storeToRefs(configStore)
const config = computed(() => bridgingConfig.value)

const formData = ref({
  enabled: false,
  imbalanceThresholdPercent: 80,
  targetSplitPercent: 50,
  minRebalanceAmount: 100,
  checkIntervalMinutes: 60,
  cooldownMinutes: 30,
  maxBridgesPerDay: 10,
  enabledTokens: [] as string[],
  skipTokens: [] as string[]
})

const enabledTokensStr = computed({
  get: () => formData.value.enabledTokens.join(', '),
  set: (val: string) => {
    formData.value.enabledTokens = val.split(',').map(s => s.trim()).filter(s => s)
  }
})

const skipTokensStr = computed({
  get: () => formData.value.skipTokens.join(', '),
  set: (val: string) => {
    formData.value.skipTokens = val.split(',').map(s => s.trim()).filter(s => s)
  }
})

const saveConfig = async () => {
  try {
    await configStore.updateBridgingConfig(formData.value)
    alert('Configuration saved successfully!')
  } catch (e) {
    // Error handled by store
  }
}

onMounted(async () => {
  try {
    await configStore.fetchBridgingConfig()
    if (configStore.bridgingConfig) {
      formData.value = { ...configStore.bridgingConfig }
    }
  } catch (e) {
    console.error('Failed to fetch bridging config:', e)
  }
})
</script>

<style scoped>
.bridging-config {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.bridging-config h2 {
  margin: 0 0 1rem 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.info-text {
  color: #7f8c8d;
  margin-bottom: 2rem;
}

.config-form {
  max-width: 800px;
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
.form-group input[type="number"] {
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

