import 'dotenv/config';
import axios from 'axios';
import { sendAlert, sendSolanaTradeAlert } from './utils/alerts';

function mask(url?: string) {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.slice(0, 10)}...`;
  } catch {
    return url.slice(0, 16) + '...';
  }
}

async function main() {
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  const debug = true;

  console.log('Env visibility:', {
    SLACK_WEBHOOK_URL: mask(slackUrl),
    DISCORD_WEBHOOK_URL: mask(discordUrl),
  });

  // 1) Direct Slack (fallback to simple text)
  if (slackUrl) {
    try {
      const body = { text: 'Slack direct test: hello from test-alerts.ts' };
      const res = await axios.post(slackUrl, body, { timeout: 8000, headers: { 'Content-Type': 'application/json' } });
      console.log('Slack direct status:', res.status, res.statusText);
    } catch (e: any) {
      console.error('Slack direct error:', e?.response?.status, e?.response?.data || e?.message);
    }
  } else {
    console.warn('Slack webhook not set');
  }

  // 2) Direct Discord
  if (discordUrl) {
    try {
      const body = { content: 'Discord direct test: hello from test-alerts.ts' };
      const res = await axios.post(discordUrl, body, { timeout: 8000, headers: { 'Content-Type': 'application/json' } });
      console.log('Discord direct status:', res.status, res.statusText);
    } catch (e: any) {
      console.error('Discord direct error:', e?.response?.status, e?.response?.data || e?.message);
    }
  } else {
    console.warn('Discord webhook not set');
  }

  // 3) Helper (structured)
  process.env.ALERT_DEBUG = 'true';
  await sendAlert('Helper test alert', { ts: Date.now(), note: 'structured payload' }, 'info');
  console.log('Helper alert attempted');

  // 4) Solana trade alert (new format) - uses separate DEX webhook
  const dexWebhookUrl = process.env.SLACK_DEX_WEBHOOK_URL;
  if (dexWebhookUrl) {
    try {
      console.log('\nTesting Solana trade alert format...');
      const solanaWalletAddress = process.env.SOLANA_WALLET_ADDRESS;
      
      // Test FORWARD trade: BUY token with USDC
      await sendSolanaTradeAlert(
        'USDC',           // tokenIn
        '150',            // amountIn
        'GUSDUC',         // tokenOut
        '247.6636',       // amountOut
        'D1499B1abcdef1234567890xyzABC1234567890DEFGHI766DC', // txSignature (will be shortened)
        solanaWalletAddress
      );
      console.log('✅ Solana trade alert (FORWARD) sent');
      
      // Test REVERSE trade: SELL token for USDC
      await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay between messages
      await sendSolanaTradeAlert(
        'GUSDUC',         // tokenIn
        '150',            // amountIn
        'USDC',           // tokenOut
        '245.5',          // amountOut
        'A1B2C3D4efgh5678901234IJKLMNOP5678901234QRSTUVWXYZ', // txSignature
        solanaWalletAddress
      );
      console.log('✅ Solana trade alert (REVERSE) sent');
    } catch (e: any) {
      console.error('Solana trade alert error:', e?.response?.status, e?.response?.data || e?.message);
    }
  } else {
    console.warn('Skipping Solana trade alert test (SLACK_DEX_WEBHOOK_URL not set)');
  }
}

main().catch((err) => {
  console.error('test-alerts crashed:', err);
  process.exit(1);
});


