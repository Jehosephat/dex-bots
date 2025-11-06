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
  
  // Validate required environment variables
  if (!walletIdentity || !bridgePriv || !solRecipient) {
    console.error('❌ Missing required environment variables:');
    if (!walletIdentity) console.error('   - GALACHAIN_WALLET_ADDRESS');
    if (!bridgePriv) console.error('   - BRIDGE_PRIVATE_KEY');
    if (!solRecipient) console.error('   - SOLANA_WALLET_ADDRESS');
    console.error('\n💡 Set these in your .env file or environment');
    process.exit(1);
    return;
  }

  // Validate private key format (should be hex string, 66 chars with 0x prefix or 64 without)
  const isValidKey = /^(0x)?[0-9a-fA-F]{64}$/.test(bridgePriv.trim());
  if (!isValidKey || bridgePriv.includes('your_') || bridgePriv.includes('placeholder')) {
    console.error('❌ Invalid BRIDGE_PRIVATE_KEY format');
    console.error('   Expected: Ethereum-compatible private key (hex string, 64 characters)');
    console.error('   Example: 0x1234567890abcdef... (with or without 0x prefix)');
    console.error(`   Got: ${bridgePriv.substring(0, 20)}... (truncated for security)`);
    console.error('\n💡 BRIDGE_PRIVATE_KEY must be a valid Ethereum private key');
    process.exit(1);
    return;
  }

  const client = new GalaConnectClient(ep.dexApiBaseUrl, ep.dexApiBaseUrl, walletIdentity);

  // Prepare descriptor for GALA
  const galaDescriptor = { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' };
  
  console.log('📊 Fetching bridge fee...');
  // Fetch fee for Solana
  const fee = (await client.fetchBridgeFee({ chainId: 'Solana', bridgeToken: galaDescriptor })) as any;
  console.log(`💰 Bridge fee: ${fee.estimatedTotalTxFeeInGala} GALA`);

  const amount = '10';
  const destinationChainId = 1002; // Solana chain id used by Gala services
  const tokenInstance = { ...galaDescriptor, instance: '0' };
  // uniqueKey must start with "galaswap-operation-" per API validation
  const uniqueKey = `galaswap-operation-${Date.now()}`;

  const message = {
    destinationChainId,
    destinationChainTxFee: fee,
    quantity: amount,
    recipient: solRecipient,
    tokenInstance,
    uniqueKey,
  };

  const hasCrossRate = Boolean(fee?.galaExchangeCrossRate);
  
  // Normalize fee object: remove the field that's not being used for typed data
  // If hasCrossRate is true, remove galaExchangeRate; if false, remove galaExchangeCrossRate
  // Also sanitize by removing undefined fields (ethers.js doesn't handle undefined well)
  const normalizedFee = hasCrossRate
    ? Object.fromEntries(Object.entries({ ...fee, galaExchangeRate: undefined }).filter(([_, v]) => v !== undefined))
    : Object.fromEntries(Object.entries({ ...fee, galaExchangeCrossRate: undefined }).filter(([_, v]) => v !== undefined));
  
  // Update message with normalized fee
  const normalizedMessage = {
    ...message,
    destinationChainTxFee: normalizedFee,
  };
  
  console.log('📋 Fee normalization:', { hasCrossRate, hasGalaExchangeRate: !!normalizedFee.galaExchangeRate, hasGalaExchangeCrossRate: !!normalizedFee.galaExchangeCrossRate });
  
  console.log('🔐 Creating signer from private key...');
  let signer: Wallet;
  try {
    signer = new Wallet(bridgePriv.trim());
  } catch (error) {
    console.error('❌ Failed to create wallet from BRIDGE_PRIVATE_KEY');
    console.error('   Error:', error instanceof Error ? error.message : String(error));
    console.error('\n💡 Ensure BRIDGE_PRIVATE_KEY is a valid Ethereum private key');
    process.exit(1);
    return;
  }
  
  console.log(`📝 Signing bridge payload (hasCrossRate: ${hasCrossRate})...`);
  const { signature } = await signBridgePayload(signer, normalizedMessage, hasCrossRate);
  const payload = { ...normalizedMessage, signature };

  console.log('🌉 Submitting RequestTokenBridgeOut...', { uniqueKey, amount });
  console.log('📤 Request payload:', JSON.stringify(payload, null, 2));
  const req = await client.requestBridgeOut(payload);
  console.log('RequestBridgeOut response:', req);

  console.log('Submitting BridgeTokenOut...');
  const bridgeTokenOutPayload = { bridgeFromChannel: 'asset', bridgeRequestId: (req as any).Data || (req as any).data?.Data || (req as any).data };
  console.log('📤 BridgeTokenOut payload:', JSON.stringify(bridgeTokenOutPayload, null, 2));
  const out = await client.bridgeTokenOut(bridgeTokenOutPayload);
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


