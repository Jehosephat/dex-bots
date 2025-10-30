import axios from 'axios';

export type AlertLevel = 'info' | 'warn' | 'error' | 'success';

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


