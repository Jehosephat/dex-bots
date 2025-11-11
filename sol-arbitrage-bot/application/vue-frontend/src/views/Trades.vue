<template>
  <div class="trades-view">
    <header class="trades-header">
      <h1>Sol Arbitrage Bot</h1>
      <p class="subtitle">Control Panel</p>
      <nav class="header-nav">
        <router-link to="/" class="nav-link">Dashboard</router-link>
        <router-link to="/config" class="nav-link">Configuration</router-link>
        <router-link to="/trades" class="nav-link">Trades</router-link>
      </nav>
    </header>

    <main class="trades-content">
      <TradeHistory />
    </main>
  </div>
</template>

<script setup lang="ts">
import TradeHistory from '../components/trades/TradeHistory.vue'
</script>

<style scoped>
.trades-view {
  min-height: 100vh;
  background: #f5f5f5;
}

.trades-header {
  background: white;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.trades-header h1 {
  margin: 0;
  font-size: 2rem;
  color: #2c3e50;
}

.subtitle {
  margin: 0.5rem 0 0 0;
  color: #7f8c8d;
  font-size: 1rem;
}

.header-nav {
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
}

.nav-link {
  padding: 0.5rem 1rem;
  text-decoration: none;
  color: #7f8c8d;
  border-radius: 4px;
  transition: all 0.2s;
}

.nav-link:hover {
  background: #f8f9fa;
  color: #2c3e50;
}

.nav-link.router-link-active {
  background: #3498db;
  color: white;
}

.trades-content {
  max-width: 1400px;
  margin: 2rem auto;
  padding: 0 2rem;
}
</style>

