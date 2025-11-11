import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Configuration from '../views/Configuration.vue'
import Trades from '../views/Trades.vue'
import Activity from '../views/Activity.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: Dashboard
    },
    {
      path: '/config',
      name: 'configuration',
      component: Configuration
    },
    {
      path: '/trades',
      name: 'trades',
      component: Trades
    },
    {
      path: '/activity',
      name: 'activity',
      component: Activity
    }
  ]
})

export default router

