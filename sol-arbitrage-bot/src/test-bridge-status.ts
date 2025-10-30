import 'dotenv/config';
import { BridgeManager } from './bridging/bridgeManager';
import { ConfigManager } from './config/configManager';

async function main() {
  const hash = process.env.BRIDGE_STATUS_HASH || '0x159ae617db2bc67c1cef659ce3571b3de1236980c3a551e17ebae0674af60188';
  if (!hash) {
    console.error('Set BRIDGE_STATUS_HASH in env to query status');
    process.exit(1);
    return;
  }
  const bm = new BridgeManager(new ConfigManager());
  await bm.initialize();
  const status = await bm.getBridgeStatus(hash);
  console.log('✅ Bridge status response:', status);
}

main().catch((err) => {
  console.error('❌ Bridge status test failed', err);
  process.exitCode = 1;
});


