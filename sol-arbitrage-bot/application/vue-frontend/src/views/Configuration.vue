<template>
  <div class="configuration">
    <header class="config-header">
      <h1>Sol Arbitrage Bot</h1>
      <p class="subtitle">Control Panel</p>
      <nav class="header-nav">
        <router-link to="/" class="nav-link">Dashboard</router-link>
        <router-link to="/config" class="nav-link">Configuration</router-link>
        <router-link to="/trades" class="nav-link">Trades</router-link>
        <router-link to="/activity" class="nav-link">Activity</router-link>
        <router-link to="/pnl" class="nav-link">P&L</router-link>
      </nav>
    </header>

    <div class="config-tabs">
      <button 
        v-for="tab in tabs" 
        :key="tab.id"
        @click="activeTab = tab.id"
        :class="['tab-button', { active: activeTab === tab.id }]"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="config-content">
      <TokenConfig v-if="activeTab === 'tokens'" :key="'tokens'" />
      <BridgingConfig v-if="activeTab === 'bridging'" :key="'bridging'" />
      <InventoryConfig v-if="activeTab === 'inventory'" :key="'inventory'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import TokenConfig from '../components/config/TokenConfig.vue'
import BridgingConfig from '../components/config/BridgingConfig.vue'
import InventoryConfig from '../components/config/InventoryConfig.vue'

const activeTab = ref<'tokens' | 'bridging' | 'inventory'>('tokens')

const tabs = [
  { id: 'tokens' as const, label: 'Tokens' },
  { id: 'bridging' as const, label: 'Bridging' },
  { id: 'inventory' as const, label: 'Inventory' }
]
</script>

<style scoped>
.configuration {
  min-height: 100vh;
  background: #f5f5f5;
}

.config-header {
  background: white;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.config-header h1 {
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

.config-tabs {
  background: white;
  border-bottom: 1px solid #e0e0e0;
  padding: 0 2rem;
  display: flex;
  gap: 0;
}

.tab-button {
  padding: 1rem 2rem;
  border: none;
  background: transparent;
  border-bottom: 3px solid transparent;
  cursor: pointer;
  font-size: 1rem;
  color: #7f8c8d;
  transition: all 0.2s;
}

.tab-button:hover {
  color: #2c3e50;
  background: #f8f9fa;
}

.tab-button.active {
  color: #3498db;
  border-bottom-color: #3498db;
  font-weight: 500;
}

.config-content {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 2rem;
}
</style>

