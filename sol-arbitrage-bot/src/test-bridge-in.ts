import 'dotenv/config';
import BigNumber from 'bignumber.js';
import { resolveGalaEndpoints } from './bridging/galaEndpoints';
import { GalaConnectClient } from './bridging/galaConnectClient';
import { bridgeOutNativeSol, bridgeOutSplToken } from './bridging/solanaBridge';
import { ConfigManager } from './config/configManager';
import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
  const ep = resolveGalaEndpoints();
  const walletIdentity = process.env.GALACHAIN_WALLET_ADDRESS || '';
  const solanaPriv = process.env.SOLANA_PRIVATE_KEY;
  const bridgeProgram = process.env.GC_SOL_BRIDGE_PROGRAM;
  const solanaRpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

  if (!walletIdentity) {
    console.error('❌ Missing GALACHAIN_WALLET_ADDRESS');
    process.exit(1);
    return;
  }

  if (!solanaPriv || !bridgeProgram) {
    console.error('❌ Missing required environment variables:');
    if (!solanaPriv) console.error('   - SOLANA_PRIVATE_KEY');
    if (!bridgeProgram) console.error('   - GC_SOL_BRIDGE_PROGRAM');
    console.error('\n💡 Set these in your .env file or environment');
    process.exit(1);
    return;
  }

  const client = new GalaConnectClient(ep.connectBaseUrl, ep.dexApiBaseUrl, walletIdentity);

  // Helper function to get GalaChain balance for a specific token
  async function getGalaChainBalance(tokenDescriptor: { collection: string; category: string; type: string; additionalKey: string }): Promise<BigNumber> {
    const resp = (await client.fetchBalances()) as any;
    let balancesList: any[] = [];
    if (Array.isArray(resp?.balances)) {
      balancesList = resp.balances;
    } else if (Array.isArray(resp?.data?.balances)) {
      balancesList = resp.data.balances;
    } else if (Array.isArray(resp?.Data)) {
      balancesList = resp.Data;
    } else if (Array.isArray(resp)) {
      balancesList = resp;
    }

    const tokenKey = `${tokenDescriptor.collection}|${tokenDescriptor.category}|${tokenDescriptor.type}|${tokenDescriptor.additionalKey}`;
    for (const entry of balancesList) {
      let entryKey: string | undefined;
      if (entry.tokenInstance) {
        const ti = entry.tokenInstance;
        entryKey = `${ti.collection}|${ti.category}|${ti.type}|${ti.additionalKey || 'none'}`;
      } else if (entry.collection && entry.category) {
        entryKey = `${entry.collection}|${entry.category}|${entry.type || 'none'}|${entry.additionalKey || 'none'}`;
      }
      if (entryKey === tokenKey) {
        const balanceStr = entry.balance || entry.quantity || '0';
        return new BigNumber(balanceStr);
      }
    }
    return new BigNumber(0);
  }

  // Helper function to get Solana balance for native SOL
  async function getSolanaSolBalance(): Promise<BigNumber> {
    const balanceRpc = process.env.SOLANA_BALANCE_RPC_URL || solanaRpc;
    const connection = new Connection(balanceRpc, 'confirmed');
    const ownerPk = new PublicKey(process.env.SOLANA_WALLET_ADDRESS || '');
    const lamports = await connection.getBalance(ownerPk, 'confirmed');
    return new BigNumber(lamports).dividedBy(1_000_000_000);
  }

  // Helper function to get Solana balance for an SPL token
  // Uses the same approach as check-balances.ts: get all token accounts and filter by mint
  // This works on free tier RPCs, unlike filtering by mint directly
  async function getSolanaTokenBalance(tokenMint: string): Promise<BigNumber> {
    const balanceRpc = process.env.SOLANA_BALANCE_RPC_URL || solanaRpc;
    const connection = new Connection(balanceRpc, 'confirmed');
    const ownerPk = new PublicKey(process.env.SOLANA_WALLET_ADDRESS || '');
    
    try {
      // Get all token accounts (works on free tier RPCs)
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        ownerPk,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );
      
      // Filter by mint in code (same approach as check-balances.ts)
      for (const acc of tokenAccounts.value) {
        const data = acc.account.data;
        if ((data as any).program === 'spl-token') {
          const info = (data as any).parsed.info;
          if (info.mint === tokenMint) {
            const uiAmount = info.tokenAmount.uiAmountString ?? info.tokenAmount.uiAmount ?? 0;
            return new BigNumber(uiAmount);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch Solana token balance for ${tokenMint}:`, error instanceof Error ? error.message : String(error));
    }
    return new BigNumber(0);
  }

  async function pollBridgeStatus(hash: string, label: string): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 30 * 60_000) {
      try {
        const status = (await client.getBridgeStatus(hash)) as any;
        const s = status?.data?.status ?? status?.status;
        const desc = status?.data?.statusDescription ?? status?.statusDescription;
        console.log(`${label} status:`, s, desc);
        if (s >= 5) {
          if (s === 5) {
            console.log(`✅ ${label} completed successfully`);
          } else {
            console.log(`❌ ${label} failed (status ${s})`);
          }
          break;
        }
      } catch (error: any) {
        // Handle 404 as "not yet available" - wait and retry (like bridge_round_trip does)
        if (error?.status === 404) {
          console.log(`${label} status not yet available (404), waiting...`);
        } else if (error?.status === 400 && error?.responseBody?.error === 'INVALID_TRANSACTION_HASH') {
          // 400 with INVALID_TRANSACTION_HASH might mean registration hasn't processed yet
          console.log(`${label} transaction hash not yet recognized (400), waiting...`);
        } else {
          console.error(`Error checking ${label} status:`, error instanceof Error ? error.message : String(error));
        }
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }

  console.log('=== Testing Solana → GalaChain Bridge ===\n');

  // Test 1: Bridge SOL from Solana → GalaChain
  console.log('--- Test 1: Bridge SOL (Native) ---');
  const solAmount = 0.001;
  
  // Check balances before bridging
  console.log('\n📊 Checking balances before bridge...');
  const solSolBefore = await getSolanaSolBalance();
  const gcGsolBefore = await getGalaChainBalance({ collection: 'GSOL', category: 'Unit', type: 'none', additionalKey: 'none' });
  console.log(`   🔸 Solana SOL: ${solSolBefore.toFixed(8)}`);
  console.log(`   🔷 GalaChain GSOL: ${gcGsolBefore.toFixed(8)}`);
  
  try {
    const solBridgeResult = await bridgeOutNativeSol({
      rpcUrl: solanaRpc,
      solanaPrivateKeyBase58: solanaPriv,
      galaBridgeProgramId: bridgeProgram,
      galaWalletIdentity: walletIdentity,
      amountSol: solAmount,
    });
    console.log('✅ SOL bridge submitted, signature:', solBridgeResult.signature);
    console.log(`   Bridging ${solAmount} SOL`);
    console.log('   Note: Solana → GalaChain bridges are processed asynchronously.');
    if (solBridgeResult.statusUrl) {
      console.log('   Status URL:', solBridgeResult.statusUrl);
    }
    
    // Wait a bit for bridge to process
    console.log('\n⏳ Waiting 60 seconds for bridge to process...');
    await new Promise((r) => setTimeout(r, 60_000));
    
    // Check balances after bridging
    console.log('\n📊 Checking balances after bridge...');
    const solSolAfter = await getSolanaSolBalance();
    const gcGsolAfter = await getGalaChainBalance({ collection: 'GSOL', category: 'Unit', type: 'none', additionalKey: 'none' });
    console.log(`   🔸 Solana SOL: ${solSolAfter.toFixed(8)} (was ${solSolBefore.toFixed(8)})`);
    console.log(`   🔷 GalaChain GSOL: ${gcGsolAfter.toFixed(8)} (was ${gcGsolBefore.toFixed(8)})`);
    
    const solDiff = solSolBefore.minus(solSolAfter);
    const gcDiff = gcGsolAfter.minus(gcGsolBefore);
    console.log(`\n📈 Balance Changes:`);
    console.log(`   🔸 Solana: -${solDiff.toFixed(8)} SOL (expected: ~${solAmount})`);
    console.log(`   🔷 GalaChain: +${gcDiff.toFixed(8)} GSOL (expected: ~${solAmount})`);
    
    if (solDiff.isGreaterThan(0) && gcDiff.isGreaterThan(0)) {
      console.log('✅ Bridge appears successful - balances changed as expected');
    } else {
      console.log('⚠️ Bridge may still be processing - check balances again later');
    }
  } catch (error) {
    console.error('❌ SOL bridge failed:', error instanceof Error ? error.message : String(error));
  }

  // Test 2: Bridge MEW (SPL Token) from Solana → GalaChain
  console.log('\n--- Test 2: Bridge MEW (SPL Token) ---');
  try {
    const configManager = new ConfigManager();
    const mewConfig = configManager.getTokenConfig('MEW');
    if (!mewConfig) {
      console.error('❌ MEW token not found in configuration');
    } else {
      const mewAmount = 100;
      const mewDecimals = mewConfig.decimals || 5;
      const mewAmountBaseUnits = BigInt(Math.floor(mewAmount * Math.pow(10, mewDecimals)));
      
      const [collection, category, type, additionalKey] = mewConfig.galaChainMint.split('|');
      const mewDescriptor = { collection, category, type, additionalKey };
      
      // Check balances before bridging
      console.log('\n📊 Checking balances before bridge...');
      const solMewBefore = await getSolanaTokenBalance(mewConfig.solanaMint);
      const gcMewBefore = await getGalaChainBalance(mewDescriptor);
      console.log(`   🔸 Solana MEW: ${solMewBefore.toFixed(8)}`);
      console.log(`   🔷 GalaChain MEW: ${gcMewBefore.toFixed(8)}`);
      
      const mewBridgeResult = await bridgeOutSplToken({
        rpcUrl: solanaRpc,
        solanaPrivateKeyBase58: solanaPriv,
        galaBridgeProgramId: bridgeProgram,
        galaWalletIdentity: walletIdentity,
        tokenMintAddress: mewConfig.solanaMint,
        amountBaseUnits: mewAmountBaseUnits,
        tokenDescriptor: mewDescriptor,
      });
      console.log('✅ MEW bridge submitted, signature:', mewBridgeResult.signature);
      console.log(`   Bridging ${mewAmount} MEW (${mewAmountBaseUnits.toString()} base units)`);
      console.log('   Note: Solana → GalaChain bridges are processed asynchronously.');
      if (mewBridgeResult.statusUrl) {
        console.log('   Status URL:', mewBridgeResult.statusUrl);
      }
      
      // Wait a bit for bridge to process
      console.log('\n⏳ Waiting 60 seconds for bridge to process...');
      await new Promise((r) => setTimeout(r, 60_000));
      
      // Check balances after bridging
      console.log('\n📊 Checking balances after bridge...');
      const solMewAfter = await getSolanaTokenBalance(mewConfig.solanaMint);
      const gcMewAfter = await getGalaChainBalance(mewDescriptor);
      console.log(`   🔸 Solana MEW: ${solMewAfter.toFixed(8)} (was ${solMewBefore.toFixed(8)})`);
      console.log(`   🔷 GalaChain MEW: ${gcMewAfter.toFixed(8)} (was ${gcMewBefore.toFixed(8)})`);
      
      const solDiff = solMewBefore.minus(solMewAfter);
      const gcDiff = gcMewAfter.minus(gcMewBefore);
      console.log(`\n📈 Balance Changes:`);
      console.log(`   🔸 Solana: -${solDiff.toFixed(8)} MEW (expected: ~${mewAmount})`);
      console.log(`   🔷 GalaChain: +${gcDiff.toFixed(8)} MEW (expected: ~${mewAmount})`);
      
      if (solDiff.isGreaterThan(0) && gcDiff.isGreaterThan(0)) {
        console.log('✅ Bridge appears successful - balances changed as expected');
      } else {
        console.log('⚠️ Bridge may still be processing - check balances again later');
      }
    }
  } catch (error) {
    console.error('❌ MEW bridge failed:', error instanceof Error ? error.message : String(error));
  }

  console.log('\n✅ Solana → GalaChain bridge tests complete!');
}

main().catch((err) => {
  console.error('❌ Bridge in test failed', err);
  process.exitCode = 1;
});

