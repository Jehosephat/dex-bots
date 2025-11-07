import bs58 from 'bs58';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { resolveGalaEndpoints } from './galaEndpoints';
import { GalaConnectClient } from './galaConnectClient';

const BRIDGE_OUT_NATIVE_DISCRIMINATOR = Buffer.from([243, 44, 75, 224, 249, 206, 98, 79]);
const BRIDGE_OUT_DISCRIMINATOR = Buffer.from([27, 194, 57, 119, 215, 165, 247, 150]);
const SOLANA_COMPUTE_UNIT_LIMIT = 200_000;
const SOLANA_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 375_000;

export async function bridgeOutNativeSol(params: {
  rpcUrl: string;
  solanaPrivateKeyBase58: string;
  galaBridgeProgramId: string; // GC_SOL_BRIDGE_PROGRAM
  galaWalletIdentity: string; // GALACHAIN_WALLET_ADDRESS
  amountSol: number; // e.g., 0.001
}): Promise<{ signature: string; statusUrl?: string; registrationResponse?: unknown }> {
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

  // Note: Registration with Gala for status tracking is optional and often fails with 403.
  // The bridge transaction itself is already confirmed on Solana and will process regardless.
  // We skip registration since we're not using status polling for Solana bridges anyway.
  return { signature };
}

export async function bridgeOutSplToken(params: {
  rpcUrl: string;
  solanaPrivateKeyBase58: string;
  galaBridgeProgramId: string;
  galaWalletIdentity: string;
  tokenMintAddress: string;
  amountBaseUnits: bigint;
  tokenDescriptor: { collection: string; category: string; type: string; additionalKey: string };
}): Promise<{ signature: string; statusUrl?: string; registrationResponse?: unknown }> {
  const connection = new Connection(params.rpcUrl, 'confirmed');
  const keypair = Keypair.fromSecretKey(bs58.decode(params.solanaPrivateKeyBase58));
  const programId = new PublicKey(params.galaBridgeProgramId);
  const mint = new PublicKey(params.tokenMintAddress);

  const [bridgeTokenAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_token_authority')],
    programId,
  );
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('configv1')], programId);

  const [mintLookup] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_lookup_v1'), mint.toBuffer()],
    programId,
  );

  const lookupAccount = await connection.getAccountInfo(mintLookup, 'confirmed');
  if (!lookupAccount) {
    throw new Error(`Mint lookup account not found for ${mint.toBase58()}`);
  }
  if (!lookupAccount.owner.equals(programId)) {
    throw new Error('Mint lookup account owner mismatch for Solana bridge program');
  }
  if (lookupAccount.data.length < 8 + 32) {
    throw new Error('Mint lookup account data is unexpectedly short');
  }
  const tokenBridge = new PublicKey(lookupAccount.data.slice(8, 40));
  const bridgeTokenAccount = getAssociatedTokenAddressSync(
    mint,
    bridgeTokenAuthority,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    mint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const recipientBytes = Buffer.from(params.galaWalletIdentity, 'utf8');
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(params.amountBaseUnits);
  const recipientLength = Buffer.alloc(4);
  recipientLength.writeUInt32LE(recipientBytes.length);
  const instructionData = Buffer.concat([
    BRIDGE_OUT_DISCRIMINATOR,
    amountBuffer,
    recipientLength,
    recipientBytes,
  ]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: mintLookup, isSigner: false, isWritable: false },
      { pubkey: tokenBridge, isSigner: false, isWritable: false },
      { pubkey: bridgeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: bridgeTokenAuthority, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: instructionData,
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

  // Note: Registration with Gala for status tracking is optional and often fails with 403.
  // The bridge transaction itself is already confirmed on Solana and will process regardless.
  // We skip registration since we're not using status polling for Solana bridges anyway.
  return { signature };
}


