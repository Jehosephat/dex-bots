<template>
  <div class="activity-feed">
    <div class="header-section">
      <h2>Activity Feed</h2>
      <div class="header-actions">
        <label class="auto-refresh-toggle">
          <input type="checkbox" v-model="autoRefresh" @change="toggleAutoRefresh" />
          Auto-refresh
        </label>
        <button @click="refreshActivity" class="btn btn-secondary" :disabled="loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters-section">
      <div class="filter-group">
        <label>Type:</label>
        <select v-model="localFilters.type" @change="applyFilters">
          <option :value="undefined">All</option>
          <option value="trade">Trades</option>
          <option value="bridge">Bridges</option>
          <option value="error">Errors</option>
          <option value="info">Info</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Level:</label>
        <select v-model="localFilters.level" @change="applyFilters">
          <option :value="undefined">All</option>
          <option value="success">Success</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Token:</label>
        <select v-model="localFilters.token" @change="applyFilters">
          <option value="">All</option>
          <option v-for="token in uniqueTokens" :key="token" :value="token">{{ token }}</option>
        </select>
      </div>
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>

    <div v-if="loading && events.length === 0" class="loading">Loading activity...</div>

    <div v-else-if="events.length === 0" class="empty-state">
      No activity found.
    </div>

    <div v-else class="activity-timeline">
      <div 
        v-for="event in events" 
        :key="event.id" 
        class="activity-item"
        :class="[`type-${event.type}`, `level-${event.level}`]"
      >
        <div class="activity-icon">
          <span v-if="event.type === 'trade'">💰</span>
          <span v-else-if="event.type === 'bridge'">🌉</span>
          <span v-else-if="event.type === 'balance'">📊</span>
          <span v-else-if="event.type === 'error'">❌</span>
          <span v-else>ℹ️</span>
        </div>
        <div class="activity-content">
          <div class="activity-header-row">
            <span class="activity-message">{{ event.message }}</span>
            <span class="activity-time">{{ formatTime(event.timestamp) }}</span>
          </div>
          <div v-if="event.metadata" class="activity-metadata">
            <span v-if="event.metadata.token" class="metadata-tag">
              Token: {{ event.metadata.token }}
            </span>
            <span v-if="event.metadata.direction" class="metadata-tag">
              {{ event.metadata.direction }}
            </span>
            <span v-if="event.metadata.edgeBps !== undefined" class="metadata-tag">
              Edge: {{ event.metadata.edgeBps.toFixed(2) }} BPS
            </span>
            <a 
              v-if="event.metadata.txHash" 
              :href="`https://explorer.galachain.io/transaction/${event.metadata.txHash}`"
              target="_blank"
              class="metadata-link"
            >
              GC TX
            </a>
            <a 
              v-if="event.metadata.txSig" 
              :href="`https://solscan.io/tx/${event.metadata.txSig}`"
              target="_blank"
              class="metadata-link"
            >
              SOL TX
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useActivityStore } from '../../stores/activity'

const activityStore = useActivityStore()
const { events, loading, error, filters, autoRefresh } = storeToRefs(activityStore)

const localFilters = ref({
  type: undefined as 'trade' | 'bridge' | 'error' | 'info' | undefined,
  level: undefined as 'info' | 'warn' | 'error' | 'success' | undefined,
  token: ''
})

const uniqueTokens = computed(() => {
  const tokens = new Set<string>()
  events.value.forEach(e => {
    if (e.metadata?.token) tokens.add(e.metadata.token)
  })
  return Array.from(tokens).sort()
})

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleString()
}

const applyFilters = () => {
  const filterObj: any = {}
  if (localFilters.value.type) filterObj.type = localFilters.value.type
  if (localFilters.value.level) filterObj.level = localFilters.value.level
  if (localFilters.value.token) filterObj.token = localFilters.value.token
  activityStore.fetchActivity(100, filterObj)
}

const refreshActivity = () => {
  applyFilters()
}

const toggleAutoRefresh = () => {
  if (autoRefresh.value) {
    activityStore.startAutoRefresh(5000) // Refresh every 5 seconds
  } else {
    activityStore.stopAutoRefresh()
  }
}

watch(autoRefresh, (newVal) => {
  if (newVal) {
    activityStore.startAutoRefresh(5000)
  } else {
    activityStore.stopAutoRefresh()
  }
})

onMounted(async () => {
  await activityStore.fetchActivity()
  if (autoRefresh.value) {
    activityStore.startAutoRefresh(5000)
  }
})

onUnmounted(() => {
  activityStore.stopAutoRefresh()
})
</script>

<style scoped>
.activity-feed {
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
}

.header-section h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.auto-refresh-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #2c3e50;
  cursor: pointer;
}

.filters-section {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.filter-group label {
  font-weight: 500;
  color: #2c3e50;
}

.filter-group select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
}

.activity-timeline {
  max-height: 800px;
  overflow-y: auto;
}

.activity-item {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border-left: 3px solid #ddd;
  margin-bottom: 0.5rem;
  transition: all 0.2s;
}

.activity-item:hover {
  background: #f8f9fa;
}

.activity-item.type-trade {
  border-left-color: #3498db;
}

.activity-item.type-bridge {
  border-left-color: #9b59b6;
}

.activity-item.type-balance {
  border-left-color: #f39c12;
}

.activity-item.type-error {
  border-left-color: #e74c3c;
}

.activity-item.level-success {
  background: #f0f9f0;
}

.activity-item.level-error {
  background: #fee;
}

.activity-item.level-warn {
  background: #fff8e1;
}

.activity-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.activity-content {
  flex: 1;
}

.activity-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.activity-message {
  font-weight: 500;
  color: #2c3e50;
}

.activity-time {
  font-size: 0.875rem;
  color: #7f8c8d;
}

.activity-metadata {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.metadata-tag {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  background: #e9ecef;
  border-radius: 4px;
  font-size: 0.875rem;
  color: #495057;
}

.metadata-link {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  background: #3498db;
  color: white;
  border-radius: 4px;
  font-size: 0.875rem;
  text-decoration: none;
}

.metadata-link:hover {
  background: #2980b9;
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

