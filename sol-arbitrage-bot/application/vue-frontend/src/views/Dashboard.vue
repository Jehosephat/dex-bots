<template>
  <div class="dashboard">
    <header class="dashboard-header">
      <h1>Sol Arbitrage Bot</h1>
      <p class="subtitle">Control Panel</p>
      <nav class="header-nav">
        <router-link to="/" class="nav-link">Dashboard</router-link>
        <router-link to="/config" class="nav-link">Configuration</router-link>
        <router-link to="/trades" class="nav-link">Trades</router-link>
        <router-link to="/activity" class="nav-link">Activity</router-link>
        <router-link to="/pnl" class="nav-link">P&L</router-link>
        <router-link to="/balances" class="nav-link">Balances</router-link>
      </nav>
    </header>
    
    <main class="dashboard-content">
      <BotControl />
      <ConsolePane />
    </main>
  </div>
</template>

<script setup lang="ts">
import BotControl from '../components/dashboard/BotControl.vue'
import ConsolePane from '../components/dashboard/ConsolePane.vue'
</script>

<style scoped>
.dashboard {
  min-height: 100vh;
  background: #f5f5f5;
}

.dashboard-header {
  background: white;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.dashboard-header h1 {
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

.dashboard-content {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}
</style>

