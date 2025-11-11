<template>
  <div class="pnl">
    <header class="pnl-header">
      <h1>Sol Arbitrage Bot</h1>
      <p class="subtitle">P&L Dashboard</p>
      <nav class="header-nav">
        <router-link to="/" class="nav-link">Dashboard</router-link>
        <router-link to="/config" class="nav-link">Configuration</router-link>
        <router-link to="/trades" class="nav-link">Trades</router-link>
        <router-link to="/activity" class="nav-link">Activity</router-link>
        <router-link to="/pnl" class="nav-link">P&L</router-link>
        <router-link to="/balances" class="nav-link">Balances</router-link>
      </nav>
    </header>
    <main class="pnl-content">
      <PnLDashboard />
    </main>
  </div>
</template>

<script setup lang="ts">
import PnLDashboard from '../components/pnl/PnLDashboard.vue'
</script>

<style scoped>
.pnl {
  min-height: 100vh;
  background: #f5f5f5;
}

.pnl-header {
  background: white;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 2rem;
}

.pnl-header h1 {
  margin: 0 0 0.5rem 0;
  font-size: 2rem;
  color: #2c3e50;
}

.subtitle {
  margin: 0 0 1.5rem 0;
  color: #7f8c8d;
  font-size: 1rem;
}

.header-nav {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.nav-link {
  padding: 0.5rem 1rem;
  text-decoration: none;
  color: #2c3e50;
  border-radius: 4px;
  transition: all 0.2s;
}

.nav-link:hover {
  background: #ecf0f1;
}

.nav-link.active {
  background: #3498db;
  color: white;
}

.pnl-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 2rem 2rem 2rem;
}
</style>

