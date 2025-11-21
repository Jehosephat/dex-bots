import BigNumber from 'bignumber.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface InventorySnapshot {
  galaChain: Record<string, string>; // symbol -> balance (human)
  solana: Record<string, string>; // symbol -> balance (human)
  updatedAtMs: number;
}

export class InventoryTracker {
  private readonly statePath: string;

  constructor(statePath?: string) {
    this.statePath = statePath ?? join(process.cwd(), 'state.json');
  }

  load(): InventorySnapshot {
    if (!existsSync(this.statePath)) {
      const empty: InventorySnapshot = { galaChain: {}, solana: {}, updatedAtMs: Date.now() };
      this.save(empty);
      return empty;
    }
    const raw = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<InventorySnapshot>;
    const snapshot: InventorySnapshot = {
      galaChain: raw.galaChain ?? {},
      solana: raw.solana ?? {},
      updatedAtMs: raw.updatedAtMs ?? Date.now(),
    };
    return snapshot;
  }

  save(snapshot: InventorySnapshot) {
    writeFileSync(this.statePath, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  reconcileAfterBridge(params: {
    symbol: string;
    amount: BigNumber | number | string;
    from: 'galaChain' | 'solana';
    to: 'galaChain' | 'solana';
  }): InventorySnapshot {
    const amt = new BigNumber(params.amount);
    const snap = this.load();
    const fromMap = { ...snap[params.from] };
    const toMap = { ...snap[params.to] };
    const tentativeFrom = new BigNumber(fromMap[params.symbol] ?? 0).minus(amt);
    const fromBal = BigNumber.maximum(tentativeFrom, new BigNumber(0));
    const toBal = new BigNumber(toMap[params.symbol] ?? 0).plus(amt);
    fromMap[params.symbol] = fromBal.toString();
    toMap[params.symbol] = toBal.toString();
    const next: InventorySnapshot = {
      galaChain: params.from === 'galaChain' ? fromMap : (params.to === 'galaChain' ? toMap : snap.galaChain),
      solana: params.from === 'solana' ? fromMap : (params.to === 'solana' ? toMap : snap.solana),
      updatedAtMs: Date.now(),
    };
    this.save(next);
    return next;
  }
}


