import 'dotenv/config';
import axios from 'axios';
import { sendAlert } from './utils/alerts';

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
}

main().catch((err) => {
  console.error('test-alerts crashed:', err);
  process.exit(1);
});


