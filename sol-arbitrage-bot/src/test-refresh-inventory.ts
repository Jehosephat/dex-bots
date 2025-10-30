import 'dotenv/config';
import logger from './utils/logger';
import { InventoryRefresher } from './core/inventoryRefresher';
import { StateManager } from './core/stateManager';
import { initializeConfig } from './config';

async function main() {
  initializeConfig();
  const sm = new StateManager();
  const refresher = new InventoryRefresher(sm);
  if ((process.env.RESET_STATE || '').toLowerCase() === 'true') {
    sm.resetInventory();
  }
  await refresher.refreshAll();
  const state = sm.getState();
  logger.info('📦 GalaChain inventory', {
    native: state.inventory.galaChain.native.toString(),
    tokens: Object.fromEntries(
      Object.entries(state.inventory.galaChain.tokens).map(([k, v]: any) => [k, {
        balance: v.balance.toString(),
        mint: v.mint,
        decimals: v.decimals
      }])
    )
  });
  logger.info('📦 Solana inventory', {
    native: state.inventory.solana.native.toString(),
    tokens: Object.fromEntries(
      Object.entries(state.inventory.solana.tokens).map(([k, v]: any) => [k, {
        balance: v.balance.toString(),
        mint: v.mint,
        decimals: v.decimals
      }])
    )
  });
  logger.info('✅ Inventory refresh test complete');
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ test-refresh-inventory failed', err);
    process.exit(1);
  });
}


