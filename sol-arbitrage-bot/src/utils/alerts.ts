import axios from 'axios';

export type AlertLevel = 'info' | 'warn' | 'error' | 'success';

/**
 * Send a Solana-only trade notification in a specific format
 * Format: :swap2: 150 GUSDUC → 247.6636 GALA — 2025-11-06 06:11:22.043 AM PT — ABC123DEF4~X234 — Jeff's Solana Arb
 * The address is shortened (first 10 + last 5 chars) and linked to Solscan
 */
export async function sendSolanaTradeAlert(
  tokenIn: string,
  amountIn: string,
  tokenOut: string,
  amountOut: string,
  txSignature: string,
  solanaWalletAddress?: string
): Promise<void> {
  // Note: txSignature is kept for potential future use but not displayed in current format
  // Use separate webhook URL for DEX trade alerts
  const slackUrl = process.env.SLACK_DEX_WEBHOOK_URL;
  if (!slackUrl) return;

  // Format timestamp in PT timezone: "2025-11-06 06:11:22.043 AM PT"
  const now = new Date();
  const ptDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  
  const year = ptDate.getFullYear();
  const month = String(ptDate.getMonth() + 1).padStart(2, '0');
  const day = String(ptDate.getDate()).padStart(2, '0');
  const hours = ptDate.getHours();
  const minutes = String(ptDate.getMinutes()).padStart(2, '0');
  const seconds = String(ptDate.getSeconds()).padStart(2, '0');
  const milliseconds = String(ptDate.getMilliseconds()).padStart(3, '0');
  
  const hour12 = hours % 12 || 12;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12Str = String(hour12).padStart(2, '0');
  
  const formattedTime = `${year}-${month}-${day} ${hour12Str}:${minutes}:${seconds}.${milliseconds} ${ampm} PT`;

  // Format amounts to 4 decimal places
  const formatAmount = (amount: string): string => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount; // Return original if not a number
    return num.toFixed(4).replace(/\.?0+$/, ''); // Remove trailing zeros
  };
  
  const formattedAmountIn = formatAmount(amountIn);
  const formattedAmountOut = formatAmount(amountOut);

  // Format wallet address as a Solscan link with shortened display
  // Display: first 10 chars + ~ + last 5 chars (e.g., ABC123DEF4~X234)
  // Link: full address to Solscan
  let walletDisplay = "Jeff's Solana Arb";
  if (solanaWalletAddress) {
    // Remove any "eth|" prefix or other prefixes, just use the raw address
    const rawAddress = solanaWalletAddress.includes('|') 
      ? solanaWalletAddress.split('|').pop() || solanaWalletAddress
      : solanaWalletAddress;
    
    // Shorten address: first 10 chars + ~ + last 5 chars
    let shortenedAddress = rawAddress;
    if (rawAddress.length > 15) {
      shortenedAddress = `${rawAddress.substring(0, 10)}~${rawAddress.substring(rawAddress.length - 5)}`;
    }
    
    // Create a Slack link to Solscan with shortened display but full address in URL
    const solscanUrl = `https://solscan.io/account/${rawAddress}`;
    walletDisplay = `<${solscanUrl}|${shortenedAddress}>`;
  }

  // Build the message in the exact format requested
  const message = `:swap2: ${formattedAmountIn} ${tokenIn} → ${formattedAmountOut} ${tokenOut} — ${formattedTime} — ${walletDisplay} — Jeff's Solana Arb`;

  const slackBody = {
    text: message
  };

  const debug = (process.env.ALERT_DEBUG || '').toLowerCase() === 'true';
  try {
    const res = await axios.post(slackUrl, slackBody, { timeout: 7000, headers: { 'Content-Type': 'application/json' } });
    if (debug) {
      // eslint-disable-next-line no-console
      console.log('[alerts] Solana trade Slack POST status', res.status);
    }
  } catch (e: any) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.error('[alerts] Solana trade Slack POST error', e?.response?.status, e?.response?.data || e?.message);
    }
  }
}

export async function sendAlert(title: string, payload: Record<string, unknown> = {}, level: AlertLevel = 'info'): Promise<void> {
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!slackUrl && !discordUrl) return;

  const color = level === 'error' ? '#e11d48' : level === 'warn' ? '#f59e0b' : level === 'success' ? '#10b981' : '#3b82f6';
  const text = `【${level.toUpperCase()}】 ${title}`;

  const fields = Object.entries(payload || {}).map(([k, v]) => ({ title: k, value: String(v), short: true }));

  const slackBody = {
    attachments: [
      {
        color,
        title: text,
        fields,
        ts: Math.floor(Date.now() / 1000)
      }
    ]
  };

  const discordBody = {
    embeds: [
      {
        title: text,
        color: level === 'error' ? 0xe11d48 : level === 'warn' ? 0xf59e0b : level === 'success' ? 0x10b981 : 0x3b82f6,
        fields: Object.entries(payload || {}).map(([name, value]) => ({ name, value: '```' + String(value) + '```', inline: true })),
        timestamp: new Date().toISOString()
      }
    ]
  };

  const debug = (process.env.ALERT_DEBUG || '').toLowerCase() === 'true';
  try {
    if (slackUrl) {
      const res = await axios.post(slackUrl, slackBody, { timeout: 7000, headers: { 'Content-Type': 'application/json' } });
      if (debug) {
        // eslint-disable-next-line no-console
        console.log('[alerts] Slack POST status', res.status);
      }
    }
  } catch (e: any) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.error('[alerts] Slack POST error', e?.response?.status, e?.response?.data || e?.message);
    }
  }
  try {
    if (discordUrl) {
      const res = await axios.post(discordUrl, discordBody, { timeout: 7000, headers: { 'Content-Type': 'application/json' } });
      if (debug) {
        // eslint-disable-next-line no-console
        console.log('[alerts] Discord POST status', res.status);
      }
    }
  } catch (e: any) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.error('[alerts] Discord POST error', e?.response?.status, e?.response?.data || e?.message);
    }
  }
}


