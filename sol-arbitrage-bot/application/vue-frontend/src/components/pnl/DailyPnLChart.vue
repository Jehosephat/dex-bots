<template>
  <div class="chart-container">
    <div v-if="loading" class="chart-loading">Loading chart data...</div>
    <div v-else-if="error" class="chart-error">{{ error }}</div>
    <canvas v-else ref="chartCanvas"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Chart, registerables } from 'chart.js'
import { api } from '../../services/api'

Chart.register(...registerables)

interface DailyData {
  date: string
  edge: number
  volume: number
  trades: number
  fees: number
}

const props = defineProps<{
  mode?: 'live' | 'dry_run' | ''
  startDate?: string
  endDate?: string
}>()

const chartCanvas = ref<HTMLCanvasElement | null>(null)
const chart = ref<Chart | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const dailyData = ref<DailyData[]>([])

const fetchData = async () => {
  loading.value = true
  error.value = null
  try {
    const params: any = {}
    if (props.mode) params.mode = props.mode
    if (props.startDate) params.startDate = props.startDate
    if (props.endDate) params.endDate = props.endDate

    const response = await api.get<DailyData[]>('/pnl/daily', { params })
    dailyData.value = response.data
    updateChart()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to fetch chart data'
  } finally {
    loading.value = false
  }
}

const updateChart = () => {
  if (!chartCanvas.value || dailyData.value.length === 0) return

  if (chart.value) {
    chart.value.destroy()
  }

  const labels = dailyData.value.map(d => {
    const date = new Date(d.date)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })

  const edgeData = dailyData.value.map(d => d.edge)
  const netEdgeData = dailyData.value.map(d => d.edge - d.fees)
  const volumeData = dailyData.value.map(d => d.volume)

  chart.value = new Chart(chartCanvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Gross Edge (GALA)',
          data: edgeData,
          borderColor: '#3498db',
          backgroundColor: 'rgba(52, 152, 219, 0.1)',
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: 'Net Edge (GALA)',
          data: netEdgeData,
          borderColor: '#27ae60',
          backgroundColor: 'rgba(39, 174, 96, 0.1)',
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: 'Volume',
          data: volumeData,
          borderColor: '#f39c12',
          backgroundColor: 'rgba(243, 156, 18, 0.1)',
          tension: 0.4,
          yAxisID: 'y1',
          hidden: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Edge (GALA)'
          }
        },
        y1: {
          type: 'linear',
          display: false,
          position: 'right',
          title: {
            display: true,
            text: 'Volume'
          },
          grid: {
            drawOnChartArea: false
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  })
}

watch([() => props.mode, () => props.startDate, () => props.endDate], () => {
  fetchData()
})

onMounted(() => {
  fetchData()
})

onUnmounted(() => {
  if (chart.value) {
    chart.value.destroy()
  }
})
</script>

<style scoped>
.chart-container {
  position: relative;
  height: 400px;
  width: 100%;
}

.chart-loading,
.chart-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #7f8c8d;
}

.chart-error {
  color: #e74c3c;
}
</style>

