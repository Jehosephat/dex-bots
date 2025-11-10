# Sol Arbitrage Bot API Server

API server for the Vue.js interface. Provides REST endpoints and WebSocket server for managing and monitoring the bot.

## Setup

```bash
cd application/api-server
npm install
npm run build
```

## Development

```bash
npm run dev
```

The server will start on `http://localhost:3000` (or port specified in `API_PORT` env variable).

## Endpoints

- `GET /api/health` - Health check
- `GET /api/bot/status` - Get bot status
- `POST /api/bot/start` - Start bot (body: `{ mode: 'live' | 'dry_run' }`)
- `POST /api/bot/stop` - Stop bot
- `POST /api/bot/pause` - Pause bot
- `POST /api/bot/resume` - Resume bot

## WebSocket Events

- `bot:status:update` - Bot status changed

