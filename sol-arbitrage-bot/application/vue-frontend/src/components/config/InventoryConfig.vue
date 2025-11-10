<template>
  <div class="inventory-config">
    <h2>Inventory Configuration</h2>
    <div v-if="error" class="error-message">{{ error }}</div>
    <div v-if="loading && !config" class="loading">Loading configuration...</div>
    <div v-else-if="!config" class="empty-state">
      Failed to load configuration. Please check the API server.
    </div>
    <div v-else class="config-form">
      <p class="info-text">Configure minimum balance requirements for trading</p>
      <form @submit.prevent="saveConfig">
        <div class="form-row">
          <div class="form-group">
            <label>Min SOL for Fees</label>
            <input 
              v-model.number="formData.minSolForFees" 
              type="number" 
              step="0.001"
              min="0"
              required
            />
            <small>Minimum SOL to keep for transaction fees</small>
          </div>

          <div class="form-group">
            <label>Min GALA for Reverse</label>
            <input 
              v-model.number="formData.minGalaForReverse" 
              type="number" 
              min="0"
              required
            />
            <small>Minimum GALA needed for reverse arbitrage trades</small>
          </div>
        </div>

        <div class="form-group">
          <label>Balance Check Cooldown (seconds)</label>
          <input 
            v-model.number="formData.balanceCheckCooldownSeconds" 
            type="number" 
            min="0"
            required
          />
          <small>Time between balance checks</small>
        </div>

        <div class="form-group">
          <label>Skip Tokens (comma-separated)</label>
          <input 
            v-model="skipTokensStr" 
            type="text" 
            placeholder="FARTCOIN, TRUMP"
          />
          <small>Tokens to skip during balance checks</small>
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
const { inventoryConfig, loading, error } = storeToRefs(configStore)
const config = computed(() => inventoryConfig.value)

const formData = ref({
  minSolForFees: 0.001,
  minGalaForReverse: 1000,
  balanceCheckCooldownSeconds: 60,
  skipTokens: [] as string[]
})

const skipTokensStr = computed({
  get: () => formData.value.skipTokens.join(', '),
  set: (val: string) => {
    formData.value.skipTokens = val.split(',').map(s => s.trim()).filter(s => s)
  }
})

const saveConfig = async () => {
  try {
    await configStore.updateInventoryConfig(formData.value)
    alert('Configuration saved successfully!')
  } catch (e) {
    // Error handled by store
  }
}

onMounted(async () => {
  try {
    await configStore.fetchInventoryConfig()
    if (configStore.inventoryConfig) {
      formData.value = { ...configStore.inventoryConfig }
    }
  } catch (e) {
    console.error('Failed to fetch inventory config:', e)
  }
})
</script>

<style scoped>
.inventory-config {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.inventory-config h2 {
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

