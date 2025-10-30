import bs58 from 'bs58';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { resolveGalaEndpoints } from './galaEndpoints';
import { GalaConnectClient } from './galaConnectClient';

const BRIDGE_OUT_NATIVE_DISCRIMINATOR = Buffer.from([243, 44, 75, 224, 249, 206, 98, 79]);
const SOLANA_COMPUTE_UNIT_LIMIT = 200_000;
const SOLANA_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 375_000;

export async function bridgeOutNativeSol(params: {
  rpcUrl: string;
  solanaPrivateKeyBase58: string;
  galaBridgeProgramId: string; // GC_SOL_BRIDGE_PROGRAM
  galaWalletIdentity: string; // GALACHAIN_WALLET_ADDRESS
  amountSol: number; // e.g., 0.001
}): Promise<{ signature: string; statusUrl?: string }> {
  const connection = new Connection(params.rpcUrl, 'confirmed');
  const keypair = Keypair.fromSecretKey(bs58.decode(params.solanaPrivateKeyBase58));
  const programId = new PublicKey(params.galaBridgeProgramId);

  const [bridgeTokenAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_token_authority')],
    programId,
  );
  const [nativeBridgePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('native_sol_bridge')],
    programId,
  );
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('configv1')], programId);

  // Build instruction data
  const amountLamports = BigInt(Math.floor(params.amountSol * 1_000_000_000));
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(amountLamports);
  const recipientBytes = Buffer.from(params.galaWalletIdentity, 'utf8');
  const recipientLength = Buffer.alloc(4);
  recipientLength.writeUInt32LE(recipientBytes.length);
  const nativeData = Buffer.concat([
    BRIDGE_OUT_NATIVE_DISCRIMINATOR,
    amountBuffer,
    recipientLength,
    recipientBytes,
  ]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: bridgeTokenAuthority, isSigner: false, isWritable: true },
      { pubkey: nativeBridgePda, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: nativeData,
  });

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: SOLANA_COMPUTE_UNIT_PRICE_MICROLAMPORTS }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: SOLANA_COMPUTE_UNIT_LIMIT }),
    ix,
  );
  tx.feePayer = keypair.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(keypair);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  // Register with Gala for status tracking
  const ep = resolveGalaEndpoints();
  const client = new GalaConnectClient(ep.connectBaseUrl, ep.dexApiBaseUrl, params.galaWalletIdentity);
  try {
    await client.registerBridgeTransaction({
      quantity: String(params.amountSol),
      tokenInstance: { collection: 'GSOL', category: 'Unit', type: 'none', additionalKey: 'none', instance: '0' },
      fromChain: 'Solana',
      toChain: 'GC',
      hash: signature,
    });
    const statusUrl = `https://connect.gala.com/bridge/status/${signature}`;
    return { signature, statusUrl };
  } catch {
    return { signature };
  }
}


