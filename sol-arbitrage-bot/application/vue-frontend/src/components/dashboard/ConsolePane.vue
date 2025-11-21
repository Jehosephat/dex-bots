<template>
  <div class="console-pane">
    <div class="console-header">
      <h3>Bot Console</h3>
      <div class="console-actions">
        <button @click="clearLogs" class="btn btn-small" :disabled="logs.length === 0">
          Clear
        </button>
        <button @click="toggleAutoScroll" class="btn btn-small" :class="{ active: autoScroll }">
          {{ autoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF' }}
        </button>
      </div>
    </div>
    <div class="console-content" ref="consoleRef">
      <div 
        v-for="(log, index) in logs" 
        :key="index"
        class="console-line"
        :class="log.type"
      >
        <span class="log-time">{{ formatTime(log.timestamp) }}</span>
        <span class="log-message">{{ log.message }}</span>
      </div>
      <div v-if="logs.length === 0" class="console-empty">
        No console output yet. Start the bot to see logs.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { api } from '../../services/api'
import { socketService } from '../../services/socket'

interface ConsoleLog {
  timestamp: number
  type: 'stdout' | 'stderr'
  message: string
}

const logs = ref<ConsoleLog[]>([])
const consoleRef = ref<HTMLElement | null>(null)
const autoScroll = ref(true)

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

const scrollToBottom = () => {
  if (autoScroll.value && consoleRef.value) {
    nextTick(() => {
      consoleRef.value!.scrollTop = consoleRef.value!.scrollHeight
    })
  }
}

const addLog = (log: ConsoleLog) => {
  logs.value.push(log)
  // Keep only last 1000 logs
  if (logs.value.length > 1000) {
    logs.value.shift()
  }
  scrollToBottom()
}

const fetchLogs = async () => {
  try {
    const response = await api.get<{ logs: ConsoleLog[] }>('/bot/console?limit=200')
    logs.value = response.data.logs
    scrollToBottom()
  } catch (error) {
    console.error('Failed to fetch console logs:', error)
  }
}

const clearLogs = async () => {
  try {
    await api.delete('/bot/console')
    logs.value = []
  } catch (error) {
    console.error('Failed to clear logs:', error)
  }
}

const toggleAutoScroll = () => {
  autoScroll.value = !autoScroll.value
  if (autoScroll.value) {
    scrollToBottom()
  }
}

const handleConsoleOutput = (log: ConsoleLog) => {
  addLog(log)
}

onMounted(() => {
  fetchLogs()
  
  // Set up WebSocket for real-time console output
  const socket = socketService.connect()
  
  // Listen for connection
  socket.on('connect', () => {
    console.log('Console WebSocket connected')
  })
  
  socket.on('disconnect', () => {
    console.log('Console WebSocket disconnected')
  })
  
  socket.on('bot:console:output', handleConsoleOutput)
  
  // Refresh logs every 5 seconds as fallback
  const interval = setInterval(fetchLogs, 5000)
  
  onUnmounted(() => {
    clearInterval(interval)
    socketService.off('bot:console:output', handleConsoleOutput)
  })
})
</script>

<style scoped>
.console-pane {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 1rem;
  height: 400px;
  display: flex;
  flex-direction: column;
  font-family: 'Courier New', monospace;
}

.console-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #333;
}

.console-header h3 {
  margin: 0;
  color: #fff;
  font-size: 1rem;
}

.console-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-small {
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  background: #333;
  color: #fff;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
}

.btn-small:hover:not(:disabled) {
  background: #444;
}

.btn-small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-small.active {
  background: #27ae60;
  border-color: #27ae60;
}

.console-content {
  flex: 1;
  overflow-y: auto;
  background: #000;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  line-height: 1.4;
}

.console-line {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  word-break: break-word;
}

.console-line.stdout {
  color: #d4d4d4;
}

.console-line.stderr {
  color: #f48771;
}

.log-time {
  color: #858585;
  flex-shrink: 0;
  min-width: 80px;
}

.log-message {
  flex: 1;
  white-space: pre-wrap;
}

.console-empty {
  color: #858585;
  text-align: center;
  padding: 2rem;
  font-style: italic;
}

/* Scrollbar styling */
.console-content::-webkit-scrollbar {
  width: 8px;
}

.console-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.console-content::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 4px;
}

.console-content::-webkit-scrollbar-thumb:hover {
  background: #666;
}
</style>

