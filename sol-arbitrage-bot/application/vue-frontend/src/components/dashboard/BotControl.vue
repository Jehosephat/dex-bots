<template>
  <div class="bot-control">
    <div class="status-card">
      <h2>Bot Status</h2>
      <div class="status-info">
        <div class="status-indicator" :class="statusClass">
          <span class="status-dot"></span>
          <span class="status-text">{{ statusText }}</span>
        </div>
        <div v-if="status.mode" class="mode-badge" :class="modeClass">
          {{ status.mode.toUpperCase() }}
        </div>
      </div>
      <div v-if="status.uptime" class="uptime">
        Uptime: {{ formatUptime(status.uptime) }}
      </div>
      <div v-if="status.pid" class="pid">
        PID: {{ status.pid }}
      </div>
    </div>

    <div class="controls">
      <div v-if="!isRunning" class="mode-selector">
        <label>
          <input 
            type="radio" 
            v-model="selectedMode" 
            value="dry_run"
            :disabled="isLoading"
          />
          Dry Run
        </label>
        <label>
          <input 
            type="radio" 
            v-model="selectedMode" 
            value="live"
            :disabled="isLoading"
          />
          Live
        </label>
      </div>
      <button 
        @click="handleStart" 
        :disabled="isRunning || isLoading"
        class="btn btn-primary"
      >
        Start Bot
      </button>
      <button 
        @click="handleStop" 
        :disabled="!isRunning || isLoading"
        class="btn btn-danger"
      >
        Stop Bot
      </button>
      <button 
        @click="refreshStatus" 
        :disabled="isLoading"
        class="btn btn-secondary"
      >
        Refresh
      </button>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useBotStore } from '../../stores/bot'

const botStore = useBotStore()

const isLoading = ref(false)
const error = ref<string | null>(null)

const status = computed(() => botStore.status)
const isRunning = computed(() => status.value.status === 'running')

const statusClass = computed(() => {
  switch (status.value.status) {
    case 'running':
      return 'status-running'
    case 'stopped':
      return 'status-stopped'
    case 'paused':
      return 'status-paused'
    case 'error':
      return 'status-error'
    default:
      return ''
  }
})

const statusText = computed(() => {
  return status.value.status.charAt(0).toUpperCase() + status.value.status.slice(1)
})

const modeClass = computed(() => {
  return status.value.mode === 'live' ? 'mode-live' : 'mode-dry-run'
})

const formatUptime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return `${hours}h ${minutes}m ${secs}s`
}

const selectedMode = ref<'live' | 'dry_run'>('dry_run')

const handleStart = async () => {
  isLoading.value = true
  error.value = null
  try {
    await botStore.start(selectedMode.value)
    // Refresh status after starting to get updated mode
    await refreshStatus()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to start bot'
  } finally {
    isLoading.value = false
  }
}

const handleStop = async () => {
  isLoading.value = true
  error.value = null
  try {
    await botStore.stop()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to stop bot'
  } finally {
    isLoading.value = false
  }
}

const refreshStatus = async () => {
  isLoading.value = true
  error.value = null
  try {
    await botStore.fetchStatus()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to fetch status'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  refreshStatus()
  // Poll status every 5 seconds
  setInterval(refreshStatus, 5000)
})
</script>

<style scoped>
.bot-control {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.status-card {
  margin-bottom: 2rem;
}

.status-card h2 {
  margin: 0 0 1rem 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.1rem;
  font-weight: 500;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}

.status-running .status-dot {
  background: #27ae60;
  box-shadow: 0 0 8px rgba(39, 174, 96, 0.5);
}

.status-stopped .status-dot {
  background: #95a5a6;
}

.status-paused .status-dot {
  background: #f39c12;
}

.status-error .status-dot {
  background: #e74c3c;
}

.mode-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 600;
}

.mode-live {
  background: #e74c3c;
  color: white;
}

.mode-dry-run {
  background: #3498db;
  color: white;
}

.uptime, .pid {
  color: #7f8c8d;
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

.controls {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.mode-selector {
  display: flex;
  gap: 1rem;
  margin-right: 1rem;
}

.mode-selector label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  color: #2c3e50;
}

.mode-selector input[type="radio"] {
  cursor: pointer;
}

.mode-selector input[type="radio"]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #3498db;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2980b9;
}

.btn-danger {
  background: #e74c3c;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #c0392b;
}

.btn-secondary {
  background: #95a5a6;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background: #7f8c8d;
}

.error-message {
  margin-top: 1rem;
  padding: 1rem;
  background: #fee;
  color: #c0392b;
  border-radius: 4px;
  border: 1px solid #e74c3c;
}
</style>

