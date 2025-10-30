import 'dotenv/config';
import { Wallet } from 'ethers';
import { resolveGalaEndpoints } from './bridging/galaEndpoints';
import { GalaConnectClient } from './bridging/galaConnectClient';
import { signBridgePayload } from './bridging/galaSign';

async function main() {
  const ep = resolveGalaEndpoints();
  const walletIdentity = process.env.GALACHAIN_WALLET_ADDRESS || '';
  const bridgePriv = process.env.BRIDGE_PRIVATE_KEY;
  const solRecipient = process.env.SOLANA_WALLET_ADDRESS || '';
  if (!walletIdentity || !bridgePriv || !solRecipient) {
    console.error('Missing env: GALACHAIN_WALLET_ADDRESS, BRIDGE_PRIVATE_KEY, SOLANA_WALLET_ADDRESS');
    process.exit(1);
    return;
  }

  const client = new GalaConnectClient(ep.connectBaseUrl, ep.dexApiBaseUrl, walletIdentity);

  // Prepare descriptor for GALA
  const galaDescriptor = { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' };
  // Fetch fee for Solana
  const fee = (await client.fetchBridgeFee({ chainId: 'Solana', bridgeToken: galaDescriptor })) as any;

  const amount = '10';
  const destinationChainId = 3; // Solana chain id used by Gala services
  const tokenInstance = { ...galaDescriptor, instance: '0' };
  const uniqueKey = `arb-bridge-${Date.now()}`;

  const message = {
    destinationChainId,
    destinationChainTxFee: fee,
    quantity: amount,
    recipient: solRecipient,
    tokenInstance,
    uniqueKey,
  };

  const hasCrossRate = Boolean(fee?.galaExchangeCrossRate);
  const signer = new Wallet(bridgePriv);
  const { signature } = await signBridgePayload(signer, message, hasCrossRate);
  const payload = { ...message, signature };

  console.log('Submitting RequestTokenBridgeOut...', { uniqueKey, amount });
  const req = await client.requestBridgeOut(payload);
  console.log('RequestBridgeOut response:', req);

  console.log('Submitting BridgeTokenOut...');
  const out = await client.bridgeTokenOut({ bridgeFromChannel: 'asset', bridgeRequestId: (req as any).Data || (req as any).data?.Data || (req as any).data });
  console.log('BridgeTokenOut response:', out);

  const hash: string = (out as any).Hash || (out as any).hash;
  if (!hash) {
    console.error('No bridge hash found in response; cannot poll status.');
    process.exit(1);
    return;
  }

  console.log('Polling bridge status for hash:', hash);
  const start = Date.now();
  while (Date.now() - start < 30 * 60_000) {
    const status = (await client.getBridgeStatus(hash)) as any;
    const s = status?.data?.status ?? status?.status;
    const desc = status?.data?.statusDescription;
    console.log('Status:', s, desc);
    if (s >= 5) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }

  console.log('✅ Outbound GC->Solana step complete (or timed out if not reached). For roundtrip back, initiate Solana->GC bridge using your Solana wallet.');
}

main().catch((err) => {
  console.error('❌ Bridge roundtrip test failed', err);
  process.exitCode = 1;
});


