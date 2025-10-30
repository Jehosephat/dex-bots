import 'dotenv/config';
import BigNumber from 'bignumber.js';
import { InventoryTracker } from './bridging/inventoryTracker';

function main() {
  const tracker = new InventoryTracker();
  // Seed a snapshot for the test
  const initial = tracker.load();
  initial.galaChain['SOL'] = initial.galaChain['SOL'] ?? '100';
  tracker.save(initial);

  const next = tracker.reconcileAfterBridge({ symbol: 'SOL', amount: new BigNumber(5), from: 'galaChain', to: 'solana' });
  console.log('✅ Inventory after reconcile:', next);
}

main();


