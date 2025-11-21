import 'dotenv/config';
import BigNumber from 'bignumber.js';
import { BridgeScheduler } from './bridging/bridgeScheduler';
import { ConfigManager } from './config/configManager';

function main() {
  const cm = new ConfigManager();
  const sched = new BridgeScheduler(cm);
  // Simulate last run 2 intervals ago to force eligibility
  const intervalMs = cm.getBridgingConfig().intervalMinutes * 60_000;
  sched.setLastRun(Date.now() - 2 * intervalMs);

  const decisionLow = sched.decide({ inventoryUsd: new BigNumber(10) });
  const decisionHigh = sched.decide({ inventoryUsd: new BigNumber(10_000) });

  console.log('✅ Bridge Scheduler (low inventory):', decisionLow);
  console.log('✅ Bridge Scheduler (high inventory):', decisionHigh);
}

main();


