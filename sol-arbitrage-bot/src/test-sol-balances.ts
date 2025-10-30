import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const owner = process.env.SOLANA_WALLET_ADDRESS;
  if (!owner) {
    console.error('Set SOLANA_WALLET_ADDRESS');
    process.exit(1);
    return;
  }
  const connection = new Connection(rpc, 'confirmed');
  const ownerPk = new PublicKey(owner);
  const lamports = await connection.getBalance(ownerPk, 'confirmed');
  const sol = lamports / 1_000_000_000;

  // Parsed SPL token balances
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(ownerPk, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') });
  const spl = tokenAccounts.value
    .map((acc) => acc.account.data)
    .filter((d: any) => d.program === 'spl-token')
    .map((d: any) => {
      const info = d.parsed.info;
      const uiAmount = Number(info.tokenAmount.uiAmountString ?? info.tokenAmount.uiAmount ?? 0);
      return {
        mint: info.mint as string,
        amount: uiAmount,
        decimals: Number(info.tokenAmount.decimals ?? 0),
        state: info.state,
      };
    })
    .filter((x) => x.amount > 0);

  console.log('✅ Solana balances:', { sol, spl });
}

main().catch((err) => {
  console.error('❌ Sol balances test failed', err);
  process.exitCode = 1;
});


