import 'dotenv/config';
import BigNumber from 'bignumber.js';
import { BridgeManager } from './bridging/bridgeManager';
import { ConfigManager } from './config/configManager';

async function main() {
  const cm = new ConfigManager();
  const bm = new BridgeManager(cm);
  await bm.initialize();

  const symbol = 'SOL';
  const amount = new BigNumber(0.01);
  const params = await bm.buildBridgeOutParams({ symbol, amount, destination: 'Solana' });
  console.log('✅ Bridge Manager dry-run params:', {
    symbol: params.symbol,
    amount: params.amount.toString(),
    destination: params.destination,
    recipient: params.recipient,
    feeGala: params.fee.estimatedTotalFeeGala.toString(),
    feeDetails: params.fee.details,
    deadlineMs: params.deadlineMs,
  });
}

main().catch((err) => {
  console.error('❌ Bridge Manager test failed', err);
  process.exitCode = 1;
});


