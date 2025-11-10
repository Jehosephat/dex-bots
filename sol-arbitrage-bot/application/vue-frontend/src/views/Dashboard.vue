<template>
  <div class="dashboard">
    <header class="dashboard-header">
      <h1>Sol Arbitrage Bot</h1>
      <p class="subtitle">Control Panel</p>
    </header>
    
    <main class="dashboard-content">
      <BotControl />
    </main>
  </div>
</template>

<script setup lang="ts">
import BotControl from '../components/dashboard/BotControl.vue'
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

.dashboard-content {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 2rem;
}
</style>

