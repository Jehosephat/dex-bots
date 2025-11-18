<template>
  <div class="token-config">
    <div class="header-actions">
      <h2>Token Configuration</h2>
      <button @click="showAddForm = true" class="btn btn-primary">
        + Add Token
      </button>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <div v-if="loading && tokens.length === 0" class="loading">
      Loading tokens...
    </div>

    <div v-else-if="tokens.length === 0" class="empty-state">
      No tokens found. Click "Add Token" to add your first token.
    </div>

    <div v-else class="tokens-table">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Enabled</th>
            <th>Trade Size</th>
            <th>Inventory Target</th>
            <th>Decimals</th>
            <th>GalaChain Mint</th>
            <th>Solana Mint</th>
            <th>Quote (GC/SOL)</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="token in tokens" :key="token.symbol" :class="{ 'quote-token': !token.enabled && token.tradeSize === 0 }">
            <td>
              <strong>{{ token.symbol }}</strong>
              <span v-if="!token.enabled && token.tradeSize === 0" class="quote-badge">Quote</span>
            </td>
            <td>
              <input 
                type="checkbox" 
                :checked="token.enabled"
                @change="toggleToken(token.symbol, $event)"
                :disabled="!token.enabled && token.tradeSize === 0"
              />
            </td>
            <td>{{ token.tradeSize }}</td>
            <td>{{ token.inventoryTarget || '-' }}</td>
            <td>{{ token.decimals }}</td>
            <td class="mint-address">{{ truncate(token.galaChainMint) }}</td>
            <td class="mint-address">{{ truncate(token.solanaMint) }}</td>
            <td>{{ token.gcQuoteVia || '-' }} / {{ token.solQuoteVia || '-' }}</td>
            <td>
              <button @click="editToken(token)" class="btn-small btn-secondary">Edit</button>
              <button 
                v-if="token.enabled || token.tradeSize > 0"
                @click="confirmDelete(token.symbol)" 
                class="btn-small btn-danger"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Add/Edit Modal -->
    <div v-if="showAddForm || editingToken" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <h3>{{ editingToken ? 'Edit Token' : 'Add Token' }}</h3>
        <form @submit.prevent="saveToken">
          <div class="form-group">
            <label>Symbol *</label>
            <input 
              v-model="formData.symbol" 
              type="text" 
              required
              :disabled="!!editingToken"
              placeholder="e.g., MEW"
            />
          </div>

          <div class="form-group">
            <label>
              <input type="checkbox" v-model="formData.enabled" />
              Enabled
            </label>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Trade Size *</label>
              <input 
                v-model.number="formData.tradeSize" 
                type="number" 
                step="0.01"
                required
                placeholder="1500"
              />
              <small>Amount to trade per execution</small>
            </div>

            <div class="form-group">
              <label>Inventory Target</label>
              <input 
                v-model.number="formData.inventoryTarget" 
                type="number" 
                step="0.01"
                min="0"
                placeholder="Optional"
              />
              <small>Total tokens desired across both chains</small>
            </div>
          </div>

          <div class="form-group">
            <label>Decimals *</label>
            <input 
              v-model.number="formData.decimals" 
              type="number" 
              required
              placeholder="5"
            />
          </div>

          <div class="form-group">
            <label>GalaChain Mint *</label>
            <input 
              v-model="formData.galaChainMint" 
              type="text" 
              required
              placeholder="GMEW|Unit|none|none"
            />
          </div>

          <div class="form-group">
            <label>Solana Mint *</label>
            <input 
              v-model="formData.solanaMint" 
              type="text" 
              required
              placeholder="MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5"
            />
          </div>

          <div class="form-group">
            <label>Solana Symbol</label>
            <input 
              v-model="formData.solanaSymbol" 
              type="text" 
              placeholder="MEW"
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>GalaChain Quote Via</label>
              <input 
                v-model="formData.gcQuoteVia" 
                type="text" 
                placeholder="GALA"
              />
            </div>

            <div class="form-group">
              <label>Solana Quote Via</label>
              <input 
                v-model="formData.solQuoteVia" 
                type="text" 
                placeholder="GALA"
              />
            </div>
          </div>

          <div class="form-actions">
            <button type="button" @click="closeModal" class="btn btn-secondary">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="loading">
              {{ loading ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore, TokenConfig } from '../../stores/config'

const configStore = useConfigStore()
const { tokens, loading, error } = storeToRefs(configStore)

const showAddForm = ref(false)
const editingToken = ref<TokenConfig | null>(null)

const formData = ref<Partial<TokenConfig>>({
  symbol: '',
  enabled: true,
  tradeSize: 0,
  decimals: 6,
  galaChainMint: '',
  solanaMint: '',
  solanaSymbol: '',
  gcQuoteVia: '',
  solQuoteVia: '',
  inventoryTarget: undefined
})

const truncate = (str: string, length: number = 20) => {
  if (!str) return '-'
  return str.length > length ? str.substring(0, length) + '...' : str
}

const toggleToken = async (symbol: string, event: Event) => {
  const checked = (event.target as HTMLInputElement).checked
  try {
    await configStore.updateToken(symbol, { enabled: checked })
  } catch (e) {
    // Error is handled by store
  }
}

const editToken = (token: TokenConfig) => {
  editingToken.value = token
  formData.value = { ...token }
  showAddForm.value = true
}

const confirmDelete = async (symbol: string) => {
  if (confirm(`Are you sure you want to delete token ${symbol}?`)) {
    try {
      await configStore.deleteToken(symbol)
    } catch (e) {
      // Error is handled by store
    }
  }
}

const saveToken = async () => {
  try {
    if (editingToken.value) {
      await configStore.updateToken(editingToken.value.symbol, formData.value)
    } else {
      await configStore.addToken(formData.value as TokenConfig)
    }
    closeModal()
  } catch (e) {
    // Error is handled by store
  }
}

const closeModal = () => {
  showAddForm.value = false
  editingToken.value = null
  formData.value = {
    symbol: '',
    enabled: true,
    tradeSize: 0,
    decimals: 6,
    galaChainMint: '',
    solanaMint: '',
    solanaSymbol: '',
    gcQuoteVia: '',
    solQuoteVia: '',
    inventoryTarget: undefined
  }
}

onMounted(async () => {
  try {
    await configStore.fetchTokens()
  } catch (e) {
    console.error('Failed to fetch tokens:', e)
  }
})
</script>

<style scoped>
.token-config {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.header-actions h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.tokens-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead {
  background: #f8f9fa;
}

th, td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid #e0e0e0;
}

th {
  font-weight: 600;
  color: #2c3e50;
}

tr.quote-token {
  background: #f8f9fa;
  opacity: 0.8;
}

.quote-badge {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.125rem 0.5rem;
  background: #95a5a6;
  color: white;
  border-radius: 4px;
  font-size: 0.75rem;
}

.mint-address {
  font-family: monospace;
  font-size: 0.875rem;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
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

.btn-secondary {
  background: #95a5a6;
  color: white;
}

.btn-secondary:hover {
  background: #7f8c8d;
}

.btn-danger {
  background: #e74c3c;
  color: white;
}

.btn-danger:hover {
  background: #c0392b;
}

.btn-small {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  margin-right: 0.5rem;
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

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  max-width: 600px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-content h3 {
  margin: 0 0 1.5rem 0;
  font-size: 1.5rem;
  color: #2c3e50;
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
  font-size: 0.875rem;
  color: #7f8c8d;
}

.form-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 2rem;
}
</style>

