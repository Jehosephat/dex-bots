import 'dotenv/config';
import { GalaConnectClient } from './bridging/galaConnectClient';
import { resolveGalaEndpoints } from './bridging/galaEndpoints';

async function main() {
  const wallet = process.env.GALACHAIN_WALLET_ADDRESS || '';
  const baseUrl = process.env.GALA_CONNECT_BASE_URL || 'https://connect.gala.com';
  const galachainApi = process.env.GALACHAIN_API_BASE_URL || 'https://api.galachain.io';
  if (!wallet) {
    console.error('Set GALACHAIN_WALLET_ADDRESS');
    process.exit(1);
    return;
  }
  const client = new GalaConnectClient(baseUrl, galachainApi, wallet);
  const ep = resolveGalaEndpoints();
  console.log('Checking GalaChain balances for wallet:', wallet, {
    connectBaseUrl: baseUrl,
    dexApiBaseUrl: ep.dexApiBaseUrl,
    dexBaseUrl: ep.dexBaseUrl,
    pathFetchBalances: ep.pathFetchBalances,
    urlFetchBalances: ep.urlFetchBalances,
  });
  const resp = (await client.fetchBalances()) as unknown;
  // Normalize two known shapes:
  // 1) { data: { balances: [{ tokenInstance: {...}, balance: "..." }] } }
  // 2) [ { collection, category, type, additionalKey, quantity, owner, ... }, ... ]
  let simple: Array<{ token: string; balance: string } > = [];
  try {
    const r1 = resp as { data?: { balances?: Array<{ tokenInstance: { collection: string; category: string; type: string; additionalKey: string; instance: string }; balance: string }> } };
    const b1 = r1?.data?.balances;
    if (Array.isArray(b1)) {
      simple = b1.map((e) => ({
        token: `${e.tokenInstance.collection}|${e.tokenInstance.category}|${e.tokenInstance.type}|${e.tokenInstance.additionalKey}`,
        balance: e.balance,
      }));
    } else if (Array.isArray(resp)) {
      const arr = resp as Array<{ collection: string; category: string; type: string; additionalKey: string; quantity: string }>;
      simple = arr.map((e) => ({
        token: `${e.collection}|${e.category}|${e.type}|${e.additionalKey}`,
        balance: e.quantity,
      }));
    }
  } catch {}
  if (simple.length === 0) {
    console.log('ℹ️ Raw FetchBalances response (unrecognized shape):', resp);
  }
  console.log('✅ GalaChain balances:', simple);
}

main().catch((err) => {
  console.error('❌ GC balances test failed', err);
  process.exitCode = 1;
});


