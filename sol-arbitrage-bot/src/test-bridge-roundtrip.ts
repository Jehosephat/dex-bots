import 'dotenv/config';
import BigNumber from 'bignumber.js';
import { resolveGalaEndpoints } from './bridging/galaEndpoints';
import { GalaConnectClient } from './bridging/galaConnectClient';
import { RequestTokenBridgeOutDto, TokenInstanceKey, TokenClassKey } from '@gala-chain/api';
import { instanceToPlain } from 'class-transformer';

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

  // Validate private key format (should be hex string, 64 chars with or without 0x prefix)
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

  // Initialize client with DEX API base URL
  const client = new GalaConnectClient(ep.connectBaseUrl, ep.dexApiBaseUrl, walletIdentity);

  // Prepare descriptor for GALA
  const galaDescriptor = { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' };
  
  console.log('📊 Fetching bridge fee...');
  // Fetch fee for Solana (returns OracleBridgeFeeAssertionDto)
  const fee = await client.fetchBridgeFee({ chainId: 'Solana', bridgeToken: galaDescriptor });
  console.log(`💰 Bridge fee: ${fee.estimatedTotalTxFeeInGala?.toString() || '0'} GALA`);

  const amount = new BigNumber('10');
  const destinationChainId = 1002; // Solana chain id used by Gala services
  
  // Create TokenInstanceKey using fungibleKey helper
  const tokenClass = new TokenClassKey();
  tokenClass.collection = galaDescriptor.collection;
  tokenClass.category = galaDescriptor.category;
  tokenClass.type = galaDescriptor.type;
  tokenClass.additionalKey = galaDescriptor.additionalKey;
  const tokenInstance = TokenInstanceKey.fungibleKey(tokenClass);
  
  // uniqueKey must start with "galaswap-operation-" for DEX API
  const uniqueKey = `galaswap-operation-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Create RequestTokenBridgeOutDto using @gala-chain/api
  const dto = new RequestTokenBridgeOutDto();
  dto.destinationChainId = destinationChainId;
  dto.tokenInstance = tokenInstance;
  dto.quantity = amount;
  dto.recipient = solRecipient;
  dto.destinationChainTxFee = fee; // OracleBridgeFeeAssertionDto
  dto.uniqueKey = uniqueKey;

  console.log('📋 Building bridge DTO:', { destinationChainId, uniqueKey });
  
  // Prepare private key (ensure 0x prefix)
  const privateKey = bridgePriv.trim().startsWith('0x') ? bridgePriv.trim() : `0x${bridgePriv.trim()}`;
  
  console.log('🔐 Signing bridge DTO with built-in .sign() method...');
  // Sign the DTO using built-in .sign() method
  dto.sign(privateKey);
  console.log('✅ DTO signed');
  
  // Serialize DTO to plain object for API call
  const dtoPayload = instanceToPlain(dto, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  }) as any;
  
  // Ensure BigNumber values are serialized as fixed notation strings (not exponential)
  const fixBigNumberSerialization = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof BigNumber) {
      return obj.toFixed().replace(/\.?0+$/, '');
    }
    if (typeof obj === 'string' && /^[\d.]+[eE][+-]?\d+$/.test(obj)) {
      // String is in exponential notation (e.g., "1e-9"), convert to fixed notation
      const bn = new BigNumber(obj);
      return bn.toFixed().replace(/\.?0+$/, '');
    }
    if (Array.isArray(obj)) {
      return obj.map(fixBigNumberSerialization);
    }
    if (typeof obj === 'object' && obj.constructor === Object) {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = fixBigNumberSerialization(value);
      }
      return result;
    }
    return obj;
  };
  
  const fixedPayload = fixBigNumberSerialization(dtoPayload);
  console.log('📤 Request payload:', JSON.stringify(fixedPayload, null, 2));

  console.log('🌉 Submitting RequestTokenBridgeOut...', { uniqueKey, amount: amount.toString() });
  const req = await client.requestBridgeOut(fixedPayload);
  console.log('RequestTokenBridgeOut response:', req);

  // Extract bridge request ID
  let bridgeRequestId: string | undefined;
  if (typeof req === 'object' && req !== null) {
    const request = req as any;
    if (typeof request.Data === 'string') {
      bridgeRequestId = request.Data;
    } else if (request.data != null) {
      if (typeof request.data === 'string') {
        bridgeRequestId = request.data;
      } else if (typeof request.data === 'object') {
        const dataObj = request.data as { Data?: unknown };
        if (typeof dataObj.Data === 'string') {
          bridgeRequestId = dataObj.Data;
        }
      }
    }
  }

  if (!bridgeRequestId) {
    console.error('❌ Bridge request ID missing from response');
    console.error('Response:', req);
    process.exit(1);
    return;
  }

  console.log('✅ RequestTokenBridgeOut accepted, bridgeRequestId:', bridgeRequestId);

  console.log('Submitting BridgeTokenOut...');
  const bridgeTokenOutPayload = { bridgeFromChannel: 'asset', bridgeRequestId };
  console.log('📤 BridgeTokenOut payload:', JSON.stringify(bridgeTokenOutPayload, null, 2));
  const out = await client.bridgeTokenOut(bridgeTokenOutPayload);
  console.log('BridgeTokenOut response:', out);

  const hash = (out as any)?.Hash || (out as any)?.hash;
  if (!hash || typeof hash !== 'string') {
    console.error('❌ No bridge hash found in response; cannot poll status.');
    console.error('Response:', out);
    process.exit(1);
    return;
  }

  console.log('✅ BridgeTokenOut submitted, transaction hash:', hash);
  console.log('Polling bridge status for hash:', hash);
  const start = Date.now();
  while (Date.now() - start < 30 * 60_000) {
    try {
      const status = (await client.getBridgeStatus(hash)) as any;
      console.log('Raw status response:', JSON.stringify(status, null, 2));
      const s = status?.data?.status ?? status?.status;
      const desc = status?.data?.statusDescription ?? status?.statusDescription;
      console.log('Parsed Status:', s, desc);
      if (s >= 5) break;
    } catch (error) {
      console.error('Error checking bridge status:', error instanceof Error ? error.message : String(error));
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }

  console.log('✅ Outbound GC->Solana step complete (or timed out if not reached). For roundtrip back, initiate Solana->GC bridge using your Solana wallet.');
}

main().catch((err) => {
  console.error('❌ Bridge roundtrip test failed', err);
  process.exitCode = 1;
});
