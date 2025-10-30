import BigNumber from 'bignumber.js';
import { ConfigManager } from '../config/configManager';

export interface BridgeDecision {
  shouldBridge: boolean;
  reasons: string[];
  nextEligibleAtMs: number;
}

export class BridgeScheduler {
  private readonly configManager: ConfigManager;
  private lastRunAtMs: number | undefined;

  constructor(configManager?: ConfigManager) {
    this.configManager = configManager ?? new ConfigManager();
  }

  setLastRun(nowMs: number) {
    this.lastRunAtMs = nowMs;
  }

  decide(params: { inventoryUsd: BigNumber | number | string }): BridgeDecision {
    const { intervalMinutes, thresholdUsd } = this.configManager.getBridgingConfig();
    const inventoryUsd = new BigNumber(params.inventoryUsd);
    const reasons: string[] = [];

    const now = Date.now();
    const nextEligibleAtMs = (this.lastRunAtMs ?? 0) + intervalMinutes * 60_000;

    if (inventoryUsd.gte(thresholdUsd)) {
      reasons.push('Inventory above threshold');
    } else {
      reasons.push(`Inventory ${inventoryUsd.toFixed(2)} < threshold ${thresholdUsd}`);
    }

    if (now >= nextEligibleAtMs) {
      reasons.push('Interval elapsed');
    } else {
      reasons.push('Interval not elapsed');
    }

    const shouldBridge = inventoryUsd.gte(thresholdUsd) && now >= nextEligibleAtMs;
    return { shouldBridge, reasons, nextEligibleAtMs };
  }
}


