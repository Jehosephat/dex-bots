# Vue.js Interface Plan for Sol Arbitrage Bot

## Executive Summary

This document outlines a comprehensive plan for building a Vue.js web interface that provides full control and monitoring capabilities for the Sol Arbitrage Bot. The interface will enable users to configure the bot, monitor activity in real-time, analyze performance, and manage the bot lifecycle through an intuitive dashboard.

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Vue.js Frontend                            │
│  (Vue 3 + TypeScript + Pinia + Vite + TailwindCSS)          │
└──────────────────────┬──────────────────────────────────────┘
                        │ HTTP/WebSocket
                        │
┌───────────────────────▼──────────────────────────────────────┐
│              Express.js API Server                          │
│  (REST API + WebSocket Server + File System Access)          │
└───────────────────────┬──────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌──────▼──────┐ ┌─────▼──────┐
│  Bot Process │ │ Config Files│ │ Log Files  │
│  Management  │ │   (JSON)     │ │  (JSON)    │
└──────────────┘ └──────────────┘ └────────────┘
```

### Technology Stack

**Frontend:**
- Vue 3 (Composition API)
- TypeScript
- Pinia (State Management)
- Vite (Build Tool)
- TailwindCSS (Styling)
- Vue Router (Routing)
- Chart.js / ApexCharts (Visualizations)
- Socket.io-client (WebSocket)
- Axios (HTTP Client)

**Backend API:**
- Express.js (REST API)
- Socket.io (WebSocket Server)
- TypeScript
- File System Access (config, logs)
- Process Management (child_process, pm2)

---

## Core Features

### 1. Configuration Management

#### 1.1 Token Configuration
**Purpose**: Configure trading parameters for each token

**UI Components:**
- Token list table with search/filter
- Token detail form (add/edit)
- Token enable/disable toggle
- Bulk import/export

**Configuration Fields:**
- Symbol (e.g., MEW, USDUC, GALA)
- Enabled status
- Trade size
- Decimals
- GalaChain token descriptor (collection, category, type, additionalKey)
- Solana mint address
- Quote currencies (gcQuoteVia, solQuoteVia)
- Minimum balances (gc, sol)
- Cooldown settings

**API Endpoints:**
```
GET    /api/config/tokens              - List all tokens
GET    /api/config/tokens/:symbol      - Get token config
POST   /api/config/tokens               - Add new token
PUT    /api/config/tokens/:symbol       - Update token
DELETE /api/config/tokens/:symbol      - Remove token
POST   /api/config/tokens/import        - Import from JSON
GET    /api/config/tokens/export        - Export to JSON
```

**Implementation Notes:**
- Validate token configs against schema (Zod)
- Show validation errors in real-time
- Auto-save drafts
- Version history (optional)

#### 1.2 Bridging Configuration
**Purpose**: Configure auto-bridging parameters

**UI Components:**
- Auto-bridging toggle
- Imbalance threshold slider
- Target split percentage
- Min rebalance amount input
- Check interval settings
- Daily limits
- Token inclusion/exclusion lists

**Configuration Fields:**
- Enabled
- Imbalance threshold percent (default: 80)
- Target split percent (default: 50)
- Min rebalance amount
- Check interval minutes
- Cooldown minutes
- Max bridges per day
- Enabled tokens list
- Skip tokens list

**API Endpoints:**
```
GET  /api/config/bridging              - Get bridging config
PUT  /api/config/bridging              - Update bridging config
POST /api/config/bridging/test          - Test bridge configuration
```

#### 1.3 Inventory Configuration
**Purpose**: Configure minimum balance requirements

**UI Components:**
- Balance requirements table
- Per-token minimum balance inputs
- Chain-specific requirements (GalaChain vs Solana)
- Purpose labels (sell, buy, quote)

**API Endpoints:**
```
GET  /api/config/inventory              - Get inventory config
PUT  /api/config/inventory              - Update inventory config
```

#### 1.4 Credentials Management
**Purpose**: Securely manage API keys, private keys, and wallet addresses

**UI Components:**
- Credentials form (masked inputs)
- Environment variable editor
- Test connection buttons
- Credential validation status

**Security Considerations:**
- Never send private keys in plain text
- Use environment variables or encrypted storage
- Mask sensitive values in UI
- Provide secure import/export

**API Endpoints:**
```
GET  /api/config/credentials           - List credential names (not values)
POST /api/config/credentials/test      - Test credential validity
PUT  /api/config/credentials           - Update credentials (encrypted)
```

**Environment Variables to Manage:**
- `GALACHAIN_WALLET_ADDRESS`
- `BRIDGE_PRIVATE_KEY`
- `SOLANA_WALLET_ADDRESS`
- `SOLANA_PRIVATE_KEY`
- `GC_SOL_BRIDGE_PROGRAM`
- `JUPITER_API_KEY`
- `SLACK_WEBHOOK_URL`
- `SLACK_DEX_WEBHOOK_URL`
- RPC URLs

---

### 2. Bot Control (Start/Stop)

#### 2.1 Bot Status Dashboard
**Purpose**: Real-time bot status and control

**UI Components:**
- Status indicator (Running/Stopped/Paused/Error)
- Start/Stop/Pause buttons
- Mode toggle (Live/Dry Run)
- Uptime display
- Last cycle time
- Error count

**API Endpoints:**
```
GET  /api/bot/status                    - Get bot status
POST /api/bot/start                     - Start bot
POST /api/bot/stop                       - Stop bot
POST /api/bot/pause                      - Pause bot
POST /api/bot/resume                     - Resume bot
POST /api/bot/mode                       - Switch mode (live/dry_run)
```

**WebSocket Events:**
```
bot:status:update    - Bot status changed
bot:cycle:start      - New cycle started
bot:cycle:complete   - Cycle completed
bot:error            - Error occurred
```

**Implementation:**
- Use PM2 or child_process for process management
- Track process PID
- Graceful shutdown handling
- State persistence

---

### 3. Activity Visualization

#### 3.1 Real-Time Activity Feed
**Purpose**: Live stream of bot activities

**UI Components:**
- Activity timeline/feed
- Filter by activity type (trade, quote, bridge, error)
- Search functionality
- Auto-scroll toggle
- Activity detail modal

**Activity Types:**
- Token evaluation
- Quote requests
- Trade execution
- Bridge operations
- Balance checks
- Errors/warnings
- Auto-bridging decisions

**Data Structure:**
```typescript
interface ActivityEvent {
  id: string;
  timestamp: string;
  type: 'trade' | 'quote' | 'bridge' | 'balance' | 'error' | 'info';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  metadata?: {
    token?: string;
    direction?: 'forward' | 'reverse';
    txHash?: string;
    amount?: number;
    chain?: 'galaChain' | 'solana';
    [key: string]: any;
  };
}
```

**WebSocket Events:**
```
activity:new         - New activity event
activity:batch       - Batch of events (for catch-up)
```

#### 3.2 Trade History Table
**Purpose**: Detailed view of all executed trades

**UI Components:**
- Sortable/filterable table
- Pagination
- Export to CSV/JSON
- Trade detail modal
- Transaction links (Solscan, GalaChain Explorer)

**Columns:**
- Timestamp
- Token
- Direction (Forward/Reverse)
- Trade Size
- Expected Edge (BPS)
- Actual Edge (BPS)
- GC Transaction
- SOL Transaction
- Status (Success/Failed/Partial)
- Price Impact

**API Endpoints:**
```
GET  /api/trades                       - List trades (paginated)
GET  /api/trades/:id                    - Get trade details
GET  /api/trades/export                 - Export trades
GET  /api/trades/stats                  - Trade statistics
```

#### 3.3 Quote History
**Purpose**: View all quote requests and results

**UI Components:**
- Quote table with filters
- Quote comparison view
- Price impact visualization
- Failed quote analysis

**API Endpoints:**
```
GET  /api/quotes                       - List quotes
GET  /api/quotes/:id                   - Get quote details
GET  /api/quotes/stats                 - Quote statistics
```

#### 3.4 Bridge History
**Purpose**: Track all bridge operations

**UI Components:**
- Bridge timeline
- Status indicators
- Bridge detail modal
- Bridge statistics

**API Endpoints:**
```
GET  /api/bridges                      - List bridges
GET  /api/bridges/:hash                - Get bridge details
GET  /api/bridges/stats                - Bridge statistics
```

#### 3.5 Balance History
**Purpose**: Track balance changes over time

**UI Components:**
- Balance charts (per token, per chain)
- Balance table
- Balance alerts
- Balance trends

**API Endpoints:**
```
GET  /api/balances                     - Current balances
GET  /api/balances/history             - Balance history
GET  /api/balances/stats               - Balance statistics
```

**Data Source:**
- Read from balance log files (if implemented)
- Or query current balances via API

---

### 4. P&L Summary

#### 4.1 P&L Dashboard
**Purpose**: Comprehensive profit & loss analysis

**UI Components:**
- Total P&L (GALA, USD)
- P&L by token
- P&L by direction (forward/reverse)
- P&L over time (chart)
- Win rate
- Average edge
- Total trades

**Calculation Method:**
- Read balance logs (if available)
- Compare starting balances vs current balances
- Account for bridge costs
- Account for gas/fees
- Convert to USD using GALA price

**API Endpoints:**
```
GET  /api/pnl/summary                  - Overall P&L summary
GET  /api/pnl/by-token                 - P&L per token
GET  /api/pnl/by-direction             - P&L by direction
GET  /api/pnl/timeline                 - P&L over time
GET  /api/pnl/export                   - Export P&L data
```

**Data Sources:**
- Trade logs (`logs/trades.json`)
- Balance logs (if implemented)
- Bridge history
- Starting balances (from state.json or config)

#### 4.2 Performance Metrics
**Purpose**: Detailed performance analysis

**Metrics:**
- Total profit/loss (GALA, USD)
- Number of trades
- Win rate
- Average edge per trade
- Best/worst trades
- Total volume traded
- Average trade size
- Success rate
- Bridge costs
- Gas/fee costs

**UI Components:**
- Metrics cards
- Performance charts
- Comparison views (day/week/month)
- Export functionality

---

## Additional Features

### 5. Strategy Management

#### 5.1 Strategy Configuration
**Purpose**: Configure flexible arbitrage strategies

**UI Components:**
- Strategy list
- Strategy editor (JSON or form-based)
- Strategy enable/disable
- Strategy priority management
- Strategy testing

**API Endpoints:**
```
GET  /api/strategies                   - List strategies
GET  /api/strategies/:id                - Get strategy
POST /api/strategies                    - Create strategy
PUT  /api/strategies/:id                - Update strategy
DELETE /api/strategies/:id              - Delete strategy
POST /api/strategies/:id/test           - Test strategy
```

**Strategy Fields:**
- ID, name, description
- GalaChain side (quoteCurrency, operation)
- Solana side (quoteCurrency, operation)
- Enabled, priority

### 6. Risk Management Dashboard

#### 6.1 Risk Metrics
**Purpose**: Monitor risk parameters in real-time

**UI Components:**
- Current edge thresholds
- Price impact warnings
- Cooldown status
- Daily trade limits
- Inventory risk indicators

**Metrics:**
- Active cooldowns
- Price impact levels
- Balance sufficiency
- Rate limit status
- Error rates

### 7. Alerts & Notifications

#### 7.1 Alert Configuration
**Purpose**: Configure Slack/Discord webhooks and alert rules

**UI Components:**
- Webhook URL inputs
- Alert rule editor
- Test notification button
- Alert history

**Alert Types:**
- Trade executed
- Trade failed
- Bridge completed
- Bridge failed
- Low balance
- High price impact
- Error threshold exceeded

**API Endpoints:**
```
GET  /api/alerts/config                 - Get alert config
PUT  /api/alerts/config                 - Update alert config
POST /api/alerts/test                   - Send test alert
GET  /api/alerts/history                - Alert history
```

### 8. Log Viewer

#### 8.1 Log Management
**Purpose**: View and search application logs

**UI Components:**
- Log viewer with filters
- Log level filtering
- Search functionality
- Auto-refresh
- Export logs

**Log Types:**
- Application logs (Winston)
- Trade logs (JSON)
- Error logs
- Bridge logs

**API Endpoints:**
```
GET  /api/logs                         - Get logs (paginated, filtered)
GET  /api/logs/export                   - Export logs
GET  /api/logs/stats                   - Log statistics
```

### 9. System Health

#### 9.1 Health Dashboard
**Purpose**: Monitor system health and connectivity

**UI Components:**
- Connection status (GalaChain RPC, Solana RPC, Jupiter API)
- API rate limit status
- Process health
- Disk space
- Memory usage

**API Endpoints:**
```
GET  /api/health                       - System health check
GET  /api/health/connections            - Connection status
GET  /api/health/resources              - Resource usage
```

### 10. Advanced Analytics

#### 10.1 Analytics Dashboard
**Purpose**: Deep dive into trading performance

**Features:**
- Trade distribution charts
- Edge distribution
- Time-of-day analysis
- Token performance comparison
- Direction performance (forward vs reverse)
- Correlation analysis

**UI Components:**
- Interactive charts
- Data tables
- Filters and date ranges
- Export options

### 11. Manual Operations

#### 11.1 Manual Bridge
**Purpose**: Manually trigger bridge operations

**UI Components:**
- Bridge form (token, amount, direction)
- Fee estimation
- Bridge execution button
- Bridge status tracking

**API Endpoints:**
```
POST /api/bridge/estimate              - Estimate bridge fee
POST /api/bridge/execute                - Execute bridge
GET  /api/bridge/:hash/status           - Get bridge status
```

#### 11.2 Manual Trade
**Purpose**: Manually execute a trade (for testing)

**UI Components:**
- Trade form (token, size, direction)
- Quote preview
- Risk check
- Execute button

**API Endpoints:**
```
POST /api/trade/quote                  - Get quote
POST /api/trade/execute                - Execute trade
```

---

## API Server Implementation

### Project Structure

```
api-server/
├── src/
│   ├── routes/
│   │   ├── config.ts          # Configuration endpoints
│   │   ├── bot.ts              # Bot control endpoints
│   │   ├── trades.ts           # Trade endpoints
│   │   ├── bridges.ts          # Bridge endpoints
│   │   ├── balances.ts         # Balance endpoints
│   │   ├── pnl.ts              # P&L endpoints
│   │   └── health.ts           # Health check endpoints
│   ├── services/
│   │   ├── botManager.ts       # Bot process management
│   │   ├── configService.ts    # Config file operations
│   │   ├── logService.ts       # Log file operations
│   │   ├── tradeAnalyzer.ts    # P&L calculation
│   │   └── websocket.ts       # WebSocket server
│   ├── middleware/
│   │   ├── auth.ts             # Authentication (optional)
│   │   └── errorHandler.ts     # Error handling
│   ├── utils/
│   │   ├── fileUtils.ts        # File system utilities
│   │   └── validators.ts        # Validation utilities
│   └── index.ts                # Express server setup
├── package.json
└── tsconfig.json
```

### Key Services

#### BotManager Service
```typescript
class BotManager {
  start(mode: 'live' | 'dry_run'): Promise<void>
  stop(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  getStatus(): BotStatus
  getProcessInfo(): ProcessInfo
}
```

#### ConfigService
```typescript
class ConfigService {
  readConfig(): BotConfig
  updateConfig(updates: Partial<BotConfig>): void
  validateConfig(config: BotConfig): ValidationResult
  backupConfig(): void
  restoreConfig(backupId: string): void
}
```

#### LogService
```typescript
class LogService {
  readTradeLogs(filters?: LogFilters): TradeLogEntry[]
  readBalanceLogs(filters?: LogFilters): BalanceLogEntry[]
  tailLogs(callback: (entry: LogEntry) => void): void
  exportLogs(format: 'json' | 'csv'): string
}
```

#### TradeAnalyzer
```typescript
class TradeAnalyzer {
  calculatePnL(startDate?: Date, endDate?: Date): PnLSummary
  calculatePnLByToken(): TokenPnL[]
  calculatePnLByDirection(): DirectionPnL[]
  getPerformanceMetrics(): PerformanceMetrics
}
```

---

## Vue.js Frontend Implementation

### Project Structure

```
vue-frontend/
├── src/
│   ├── components/
│   │   ├── common/
│   │   │   ├── StatusIndicator.vue
│   │   │   ├── DataTable.vue
│   │   │   ├── Chart.vue
│   │   │   └── Modal.vue
│   │   ├── config/
│   │   │   ├── TokenConfig.vue
│   │   │   ├── BridgingConfig.vue
│   │   │   ├── InventoryConfig.vue
│   │   │   └── CredentialsConfig.vue
│   │   ├── dashboard/
│   │   │   ├── BotControl.vue
│   │   │   ├── ActivityFeed.vue
│   │   │   ├── TradeHistory.vue
│   │   │   └── PnLDashboard.vue
│   │   └── analytics/
│   │       ├── PerformanceChart.vue
│   │       └── MetricsCard.vue
│   ├── views/
│   │   ├── Dashboard.vue
│   │   ├── Configuration.vue
│   │   ├── Trades.vue
│   │   ├── Bridges.vue
│   │   ├── Analytics.vue
│   │   └── Settings.vue
│   ├── stores/
│   │   ├── bot.ts              # Bot state
│   │   ├── config.ts           # Config state
│   │   ├── trades.ts           # Trades state
│   │   ├── activity.ts          # Activity feed state
│   │   └── pnl.ts              # P&L state
│   ├── services/
│   │   ├── api.ts              # HTTP client
│   │   ├── websocket.ts        # WebSocket client
│   │   └── types.ts            # TypeScript types
│   ├── router/
│   │   └── index.ts            # Vue Router config
│   ├── App.vue
│   └── main.ts
├── package.json
└── vite.config.ts
```

### Key Stores (Pinia)

#### Bot Store
```typescript
export const useBotStore = defineStore('bot', {
  state: () => ({
    status: 'stopped' as BotStatus,
    mode: 'dry_run' as 'live' | 'dry_run',
    uptime: 0,
    lastCycle: null as Date | null,
    errors: [] as Error[]
  }),
  actions: {
    async start(mode: 'live' | 'dry_run') { ... },
    async stop() { ... },
    async pause() { ... },
    async resume() { ... }
  }
})
```

#### Activity Store
```typescript
export const useActivityStore = defineStore('activity', {
  state: () => ({
    events: [] as ActivityEvent[],
    filters: {} as ActivityFilters
  }),
  actions: {
    addEvent(event: ActivityEvent) { ... },
    clearEvents() { ... },
    setFilters(filters: ActivityFilters) { ... }
  }
})
```

#### PnL Store
```typescript
export const usePnLStore = defineStore('pnl', {
  state: () => ({
    summary: null as PnLSummary | null,
    byToken: [] as TokenPnL[],
    timeline: [] as TimelinePoint[]
  }),
  actions: {
    async fetchSummary() { ... },
    async fetchByToken() { ... },
    async fetchTimeline() { ... }
  }
})
```

---

## Data Flow

### Real-Time Updates

1. **Bot Process** → **API Server** (via file watching or process events)
2. **API Server** → **WebSocket** → **Vue Frontend**
3. **Vue Frontend** → **Pinia Store** → **Components**

### Configuration Updates

1. **Vue Frontend** → **API Endpoint** → **ConfigService**
2. **ConfigService** → **Write to config.json**
3. **API Server** → **WebSocket** → **Vue Frontend** (notify config changed)
4. **Bot Process** → **Reload config** (if hot-reload supported)

### Trade Execution Flow

1. **Bot executes trade** → **Writes to trade log**
2. **API Server** → **Watches log file** → **Reads new entry**
3. **API Server** → **WebSocket** → **Vue Frontend**
4. **Vue Frontend** → **Activity Store** → **Activity Feed Component**

---

## Security Considerations

### 1. Authentication (Optional)
- Basic auth or JWT tokens
- Session management
- Role-based access (if multi-user)

### 2. Credential Security
- Never expose private keys in API responses
- Encrypt credentials at rest
- Use environment variables
- Secure credential import/export

### 3. API Security
- Rate limiting
- Input validation
- CORS configuration
- HTTPS in production

### 4. File System Security
- Validate file paths (prevent directory traversal)
- Restrict file access to bot directory only
- Backup before modifications

---

## Deployment

### Development
- API server: `npm run dev` (nodemon)
- Vue frontend: `npm run dev` (Vite dev server)
- Bot process: Run separately or via API

### Production
- API server: PM2 or systemd service
- Vue frontend: Build static files, serve via nginx
- Bot process: PM2 or systemd service
- Reverse proxy: nginx for API and frontend

### Docker (Optional)
- Multi-stage build
- Separate containers for API and frontend
- Volume mounts for config and logs

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Set up API server structure
- [ ] Implement basic REST endpoints
- [ ] Set up Vue.js project
- [ ] Create basic routing and layout
- [ ] Implement bot control (start/stop)

### Phase 2: Configuration (Week 3-4)
- [ ] Token configuration UI
- [ ] Bridging configuration UI
- [ ] Inventory configuration UI
- [ ] Credentials management UI
- [ ] Config validation and error handling

### Phase 3: Activity & Monitoring (Week 5-6)
- [ ] WebSocket server implementation
- [ ] Activity feed component
- [ ] Trade history table
- [ ] Real-time status updates
- [ ] Log viewer

### Phase 4: P&L & Analytics (Week 7-8)
- [ ] P&L calculation service
- [ ] P&L dashboard
- [ ] Performance metrics
- [ ] Charts and visualizations
- [ ] Export functionality

### Phase 5: Advanced Features (Week 9-10)
- [ ] Strategy management
- [ ] Risk dashboard
- [ ] Alerts configuration
- [ ] Manual operations
- [ ] System health monitoring

### Phase 6: Polish & Testing (Week 11-12)
- [ ] UI/UX improvements
- [ ] Error handling
- [ ] Performance optimization
- [ ] Documentation
- [ ] Testing and bug fixes

---

## Technical Considerations

### File Watching
- Use `chokidar` or `fs.watch` to monitor log files
- Debounce file changes to avoid excessive updates
- Handle file rotation

### Process Management
- Use PM2 for production process management
- Track process PID for status checks
- Handle graceful shutdown

### Data Aggregation
- Cache frequently accessed data
- Use background jobs for heavy calculations
- Implement pagination for large datasets

### Performance
- Lazy load components
- Virtual scrolling for large lists
- Debounce search/filter inputs
- Optimize chart rendering

---

## Future Enhancements

1. **Multi-Bot Support**: Manage multiple bot instances
2. **Backtesting**: Test strategies on historical data
3. **Strategy Builder**: Visual strategy builder
4. **Mobile App**: React Native or PWA
5. **Advanced Analytics**: Machine learning insights
6. **Integration**: Connect to external analytics tools
7. **Notifications**: Push notifications for mobile
8. **Export/Import**: Full configuration backup/restore

---

## Conclusion

This Vue.js interface will provide a comprehensive, user-friendly way to manage and monitor the Sol Arbitrage Bot. The modular architecture allows for incremental development and easy extension with additional features. The real-time updates via WebSocket ensure users always have the latest information, while the REST API provides a solid foundation for all operations.

