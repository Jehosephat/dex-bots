## Live Fire Prep Notes

This document lists what to prepare before enabling live trading: wallets, inventory, config, and preflight checks.

### GalaChain (Sell Leg)
- Wallet/Keys:
  - `GALACHAIN_PRIVATE_KEY`
  - `GALACHAIN_WALLET_ADDRESS`
- Inventory (See Suggested Starting Allocation below):
  - Sufficient balance of each target token you intend to sell
  - GALA buffer for DEX fees (keep several GALA)
- Tokens/Routes:
  - Use wrapped symbols with `G` prefix where applicable (e.g., `GSOL`, `GTRUMP`)
  - Ensure pools are public/accessible (or that you’re whitelisted if needed)
 - API/SDK Endpoints in use (already configured in code):
   - DEX API: `https://gateway-mainnet.galachain.com/api/asset/dexv3-contract/GetCompositePool`
   - Local quoting via `@gala-chain/dex` (QuoteExactAmount, etc.)

### Solana (Buy Leg)
- Wallet/Keys:
  - `SOLANA_PRIVATE_KEY` (base58 or JSON array as used by your tooling)
  - `SOLANA_WALLET_ADDRESS`
  - `SOLANA_RPC_URL` Using Chainstack
- Inventory (See Suggested Starting Allocation below):
  - Quote currency balance matching `solQuoteVia` (e.g., USDC) for your targets
  - SOL balance for network/priority fees (maintain a healthy buffer)
- Token Accounts:
  - Ensure associated token accounts exist for quote currency and purchased tokens (auto-create or precreate)
- Jupiter:
  - `JUPITER_API_KEY` (optional but recommended)
  - Confirm route preferences/toggles if you add them later

### Bridge (Phase 4 Readiness)
- Credentials:
  - Any keys/seeds/API tokens required by your chosen bridge client (e.g., GalaConnect)
- Fee Buffers:
  - Funds on both chains sufficient to pay bridge fees (GALA side and SOL side as applicable)
- Asset Support:
  - Verify assets are bridgable over the intended routes

### Bot Config/Env
- Trading Guardrails (from `config/config.json`):
  - `minEdgeBps`, `maxSlippageBps`, `maxPriceImpactBps`, `cooldownMinutes`, `maxDailyTrades`
- Monitoring/Telemetry:
  - `enableAlerts`, `SLACK_WEBHOOK_URL` or `DISCORD_WEBHOOK_URL`
  - `LOG_LEVEL` (use `info` in prod), optional `LOG_FILE`
  - Persisted `state.json` on durable storage
- External Rates:
  - `COINGECKO_API_KEY` (optional; rate limits)
- Tokens/Tokens Map (`config/tokens.json`):
  - Ensure `galaChainMint` (with `G` prefix where needed), `solanaMint`, `decimals`, `tradeSize`, `enabled`
  - `gcQuoteVia` (usually `GALA`) and `solQuoteVia` (e.g., `USDC`)
- Quote Tokens (`quoteTokens`):
  - Verify mints/decimals for `GALA`, `USDC`, and `SOL`

### Preflight Checklist
1. Providers Online: Verify GalaChain and Solana providers initialize successfully
2. Quotes Healthy: Confirm quotes for each enabled token at your intended trade sizes
3. Allowances: Confirm DexV3 swap allowances exist and are sufficient on GalaChain
4. Balances:
   - GC: Token balances to sell + GALA fee buffer
   - Solana: Quote currency (e.g., USDC) + SOL fee buffer
5. Deadlines/Slippage: Tune slippage and deadline to match your latency/RPC performance
6. Cooldowns/Limits: Set `cooldownMinutes` and `maxDailyTrades` to your risk appetite
7. Alerts: Ensure Slack/Discord webhooks work; start with `enableAlerts=true`
8. State: Confirm `state.json` path is writable and persists across restarts
9. Dry-Run Flow: Run coordinator + risk manager dry-run and review decisions

### Suggested Starting Allocation (≈$1000 budget)
- Hold back fee buffers (don’t deploy):
  - GalaChain fee buffer: ~5% (~$50) in GALA
  - Solana fee buffer: ~2% (~$20) in SOL (≈0.10 SOL)
- Split remaining working capital (~93% ≈ $930):
  - GalaChain working bucket: ~60% of working capital (≈$558)
  - Solana working bucket: ~40% of working capital (≈$372)
- Inside each chain:
  - GalaChain (sell leg):
    - Target-token inventory (e.g., GSOL): ~80% of GC bucket (≈$446)
    - Liquid GALA for slippage/allowances: ~20% of GC bucket (≈$112)
  - Solana (buy leg):
    - Quote currency (USDC if `solQuoteVia=USDC`): ~90% of SOL bucket (≈$335)
    - Extra SOL beyond 0.10 SOL buffer: ~10% of SOL bucket (≈$37)

Notes:
- Maintain at least 5–10× `tradeSize` on each side to allow retries without immediate rebalance.
- Adjust percentages as you scale to additional target tokens (mirror this pattern per token).

### Suggested Commands
- Test providers/quotes:
```
npx ts-node src/test-price-discovery.ts
```
- Test executors (dry-run):
```
npx ts-node src/test-gc-executor.ts
npx ts-node src/test-sol-executor.ts
```
- Test dual-leg (dry-run):
```
npx ts-node src/test-dual-leg.ts
```
- Test risk manager:
```
npx ts-node src/test-risk-manager.ts
```

### Go‑Live Tips
- Start with small `tradeSize` and conservative guardrails
- Monitor logs and alerts closely for the first sessions
- Increase sizes gradually after confirming stable behavior


