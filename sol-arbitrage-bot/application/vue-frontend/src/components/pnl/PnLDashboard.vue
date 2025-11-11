<template>
  <div class="pnl-dashboard">
    <div class="dashboard-header">
      <h2>Profit & Loss Summary</h2>
      <div class="header-actions">
        <select v-model="selectedMode" @change="refreshData" class="mode-select">
          <option value="">All Modes</option>
          <option value="live">Live</option>
          <option value="dry_run">Dry Run</option>
        </select>
        <button @click="refreshData" class="btn btn-secondary" :disabled="loading">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>

    <div v-if="loading && !breakdown" class="loading">Loading P&L data...</div>

    <div v-else-if="breakdown" class="dashboard-content">
      <!-- Summary Cards -->
      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-label">Total Trades</div>
          <div class="card-value">{{ breakdown.summary.totalTrades }}</div>
          <div class="card-detail">
            <span class="success">{{ breakdown.summary.successfulTrades }} successful</span>
            <span class="error">{{ breakdown.summary.failedTrades }} failed</span>
          </div>
        </div>

        <div class="summary-card">
          <div class="card-label">Win Rate</div>
          <div class="card-value">{{ breakdown.summary.winRate.toFixed(1) }}%</div>
          <div class="card-detail">
            {{ breakdown.summary.successfulTrades }} / {{ breakdown.summary.totalTrades }} trades
          </div>
        </div>

        <div class="summary-card">
          <div class="card-label">Total Expected Edge</div>
          <div class="card-value">{{ formatGala(breakdown.summary.totalExpectedEdge) }}</div>
          <div class="card-detail">
            {{ breakdown.summary.totalExpectedEdgeBps.toFixed(2) }} BPS total
          </div>
        </div>

        <div class="summary-card">
          <div class="card-label">Average Edge</div>
          <div class="card-value">{{ breakdown.summary.averageEdgeBps.toFixed(2) }} BPS</div>
          <div class="card-detail">
            Per trade average
          </div>
        </div>

        <div class="summary-card">
          <div class="card-label">Total Volume</div>
          <div class="card-value">{{ formatNumber(breakdown.summary.totalVolume) }}</div>
          <div class="card-detail">
            Across all tokens
          </div>
        </div>

        <div v-if="breakdown.summary.totalActualEdge !== undefined" class="summary-card">
          <div class="card-label">Total Actual Edge</div>
          <div class="card-value">{{ formatGala(breakdown.summary.totalActualEdge) }}</div>
          <div class="card-detail">
            {{ breakdown.summary.totalActualEdgeBps?.toFixed(2) }} BPS total
          </div>
        </div>

        <div class="summary-card" :class="{ 'fee-card': breakdown.summary.totalBridgingFees > 0 }">
          <div class="card-label">Bridging Fees</div>
          <div class="card-value">{{ formatGala(breakdown.summary.totalBridgingFees) }}</div>
          <div class="card-detail">
            ${{ breakdown.summary.totalBridgingFeesUsd.toFixed(2) }} USD
          </div>
        </div>

        <div class="summary-card net-card">
          <div class="card-label">Net Expected Edge</div>
          <div class="card-value" :class="{ negative: breakdown.summary.netExpectedEdge < 0 }">
            {{ formatGala(breakdown.summary.netExpectedEdge) }}
          </div>
          <div class="card-detail">
            After bridging fees
          </div>
        </div>

        <div v-if="breakdown.summary.netActualEdge !== undefined" class="summary-card net-card">
          <div class="card-label">Net Actual Edge</div>
          <div class="card-value" :class="{ negative: breakdown.summary.netActualEdge < 0 }">
            {{ formatGala(breakdown.summary.netActualEdge) }}
          </div>
          <div class="card-detail">
            After bridging fees
          </div>
        </div>
      </div>

      <!-- Time Period Breakdown -->
      <div class="section">
        <h3>Performance by Time Period</h3>
        <div class="time-period-grid">
          <div class="period-card">
            <div class="period-label">Today</div>
            <div class="period-stats">
              <div>{{ breakdown.byTimePeriod.today.totalTrades }} trades</div>
              <div>{{ breakdown.byTimePeriod.today.averageEdgeBps.toFixed(2) }} BPS avg</div>
              <div>{{ formatGala(breakdown.byTimePeriod.today.totalExpectedEdge) }} edge</div>
            </div>
          </div>

          <div class="period-card">
            <div class="period-label">This Week</div>
            <div class="period-stats">
              <div>{{ breakdown.byTimePeriod.week.totalTrades }} trades</div>
              <div>{{ breakdown.byTimePeriod.week.averageEdgeBps.toFixed(2) }} BPS avg</div>
              <div>{{ formatGala(breakdown.byTimePeriod.week.totalExpectedEdge) }} edge</div>
            </div>
          </div>

          <div class="period-card">
            <div class="period-label">This Month</div>
            <div class="period-stats">
              <div>{{ breakdown.byTimePeriod.month.totalTrades }} trades</div>
              <div>{{ breakdown.byTimePeriod.month.averageEdgeBps.toFixed(2) }} BPS avg</div>
              <div>{{ formatGala(breakdown.byTimePeriod.month.totalExpectedEdge) }} edge</div>
            </div>
          </div>

          <div class="period-card">
            <div class="period-label">All Time</div>
            <div class="period-stats">
              <div>{{ breakdown.byTimePeriod.allTime.totalTrades }} trades</div>
              <div>{{ breakdown.byTimePeriod.allTime.averageEdgeBps.toFixed(2) }} BPS avg</div>
              <div>{{ formatGala(breakdown.byTimePeriod.allTime.totalExpectedEdge) }} edge</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Direction Breakdown -->
      <div class="section">
        <h3>Performance by Direction</h3>
        <div class="direction-grid">
          <div class="direction-card">
            <div class="direction-label">Forward (GC → SOL)</div>
            <div class="direction-stats">
              <div><strong>{{ breakdown.byDirection.forward.totalTrades }}</strong> trades</div>
              <div>{{ breakdown.byDirection.forward.averageEdgeBps.toFixed(2) }} BPS avg</div>
              <div>{{ formatGala(breakdown.byDirection.forward.totalExpectedEdge) }} edge</div>
              <div>{{ breakdown.byDirection.forward.winRate.toFixed(1) }}% win rate</div>
            </div>
          </div>

          <div class="direction-card">
            <div class="direction-label">Reverse (SOL → GC)</div>
            <div class="direction-stats">
              <div><strong>{{ breakdown.byDirection.reverse.totalTrades }}</strong> trades</div>
              <div>{{ breakdown.byDirection.reverse.averageEdgeBps.toFixed(2) }} BPS avg</div>
              <div>{{ formatGala(breakdown.byDirection.reverse.totalExpectedEdge) }} edge</div>
              <div>{{ breakdown.byDirection.reverse.winRate.toFixed(1) }}% win rate</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Token Breakdown -->
      <div class="section">
        <h3>Performance by Token</h3>
        <div class="token-table-container">
          <table class="token-table">
            <thead>
              <tr>
                <th>Token</th>
                <th>Trades</th>
                <th>Success Rate</th>
                <th>Total Edge</th>
                <th>Avg Edge (BPS)</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="token in breakdown.byToken" :key="token.token">
                <td><strong>{{ token.token }}</strong></td>
                <td>{{ token.trades }}</td>
                <td>{{ ((token.successfulTrades / token.trades) * 100).toFixed(1) }}%</td>
                <td>{{ formatGala(token.totalExpectedEdge) }}</td>
                <td>{{ token.averageEdgeBps.toFixed(2) }}</td>
                <td>{{ formatNumber(token.totalVolume) }}</td>
              </tr>
              <tr v-if="breakdown.byToken.length === 0">
                <td colspan="6" class="empty-state">No token data available</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { usePnLStore } from '../../stores/pnl'

const pnlStore = usePnLStore()
const { breakdown, loading, error } = storeToRefs(pnlStore)

const selectedMode = ref<'live' | 'dry_run' | ''>('')

const formatGala = (value: number): string => {
  if (value === 0) return '0 GALA'
  if (Math.abs(value) < 0.0001) return value.toExponential(2) + ' GALA'
  return value.toFixed(4) + ' GALA'
}

const formatNumber = (value: number): string => {
  if (value === 0) return '0'
  if (value >= 1000000) return (value / 1000000).toFixed(2) + 'M'
  if (value >= 1000) return (value / 1000).toFixed(2) + 'K'
  return value.toFixed(2)
}

const refreshData = async () => {
  const filters: any = {}
  if (selectedMode.value) {
    filters.mode = selectedMode.value
  }
  await pnlStore.fetchBreakdown(filters)
}

onMounted(async () => {
  await refreshData()
})
</script>

<style scoped>
.pnl-dashboard {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.dashboard-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.header-actions {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.mode-select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.summary-card {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1.5rem;
  border-left: 4px solid #3498db;
}

.card-label {
  font-size: 0.875rem;
  color: #7f8c8d;
  margin-bottom: 0.5rem;
}

.card-value {
  font-size: 1.75rem;
  font-weight: bold;
  color: #2c3e50;
  margin-bottom: 0.5rem;
}

.card-detail {
  font-size: 0.875rem;
  color: #7f8c8d;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.card-detail .success {
  color: #27ae60;
}

.card-detail .error {
  color: #e74c3c;
}

.fee-card {
  border-left-color: #f39c12;
}

.net-card {
  border-left-color: #27ae60;
}

.net-card .card-value.negative {
  color: #e74c3c;
}

.section {
  margin-bottom: 2rem;
}

.section h3 {
  margin: 0 0 1rem 0;
  font-size: 1.25rem;
  color: #2c3e50;
}

.time-period-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.period-card {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid #e9ecef;
}

.period-label {
  font-weight: bold;
  color: #2c3e50;
  margin-bottom: 0.75rem;
}

.period-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #7f8c8d;
}

.direction-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
}

.direction-card {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1.5rem;
  border: 1px solid #e9ecef;
}

.direction-label {
  font-weight: bold;
  color: #2c3e50;
  margin-bottom: 1rem;
  font-size: 1.1rem;
}

.direction-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #7f8c8d;
}

.token-table-container {
  overflow-x: auto;
}

.token-table {
  width: 100%;
  border-collapse: collapse;
}

.token-table th {
  background: #f8f9fa;
  padding: 0.75rem;
  text-align: left;
  font-weight: 600;
  color: #2c3e50;
  border-bottom: 2px solid #dee2e6;
}

.token-table td {
  padding: 0.75rem;
  border-bottom: 1px solid #e9ecef;
}

.token-table tbody tr:hover {
  background: #f8f9fa;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: #7f8c8d;
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

