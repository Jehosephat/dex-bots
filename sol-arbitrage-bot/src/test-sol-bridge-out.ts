import 'dotenv/config';
import { bridgeOutNativeSol } from './bridging/solanaBridge';

async function main() {
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const priv = process.env.SOLANA_PRIVATE_KEY;
  const program = process.env.GC_SOL_BRIDGE_PROGRAM; // Gala bridge program id
  const galaIdentity = process.env.GALACHAIN_WALLET_ADDRESS;
  const amount = Number(process.env.SOL_BRIDGE_AMOUNT_SOL || '0.001');
  if (!priv || !program || !galaIdentity) {
    console.error('Missing env: SOLANA_PRIVATE_KEY, GC_SOL_BRIDGE_PROGRAM, GALACHAIN_WALLET_ADDRESS');
    process.exit(1);
    return;
  }
  const result = await bridgeOutNativeSol({
    rpcUrl: rpc,
    solanaPrivateKeyBase58: priv,
    galaBridgeProgramId: program,
    galaWalletIdentity: galaIdentity,
    amountSol: amount,
  });
  console.log('✅ Submitted Solana bridge tx:', {
    signature: result.signature,
    statusUrl: (result as any).statusUrl,
    amountSol: amount,
    programId: program,
    recipientIdentity: galaIdentity,
    rpcUrl: rpc,
  });
}

main().catch((err) => {
  console.error('❌ Solana bridge-out test failed', err);
  process.exitCode = 1;
});


