## SOL ↔ GalaChain Arbitrage Strategy (Plain-English Overview)

This bot looks for simple, safe chances to make a small profit by selling a token on GalaChain while buying the same token on Solana at nearly the same time. When there is a clear price difference that more than covers all costs, the bot takes the trade and later moves ("bridges") the purchased tokens back to GalaChain. Profits are measured in GALA.

### What the bot tries to do
- **Find clear price gaps**: If a token is worth a little more on GalaChain than on Solana (after all fees), that’s an opportunity.
- **Trade both sides together**: Sell on GalaChain and buy on Solana in the same decision window to avoid market exposure.
- **Accumulate value on GalaChain**: Periodically bridge the tokens bought on Solana back to GalaChain so inventory and profits build up on GalaChain.

### How profit is measured
All profit is tracked in **GALA**. For each potential trade, the bot estimates:
- Money received by selling the token for GALA on GalaChain
- Money spent to buy the same token on Solana (converted to GALA for apples-to-apples comparison)
- Estimated bridge cost for moving tokens from Solana back to GalaChain
- A small extra “safety margin” to account for slippage and timing

If the result (called “Net Edge”) is positive and above a minimum threshold, the bot takes the trade. If not, it skips.

### The basic steps for each opportunity
1) **Get live prices** on both chains for a small, fixed trade size per token.
2) **Check the edge**: Sell value on GalaChain minus buy cost on Solana minus bridge cost minus the safety margin.
3) **Apply guardrails**: Only proceed if the opportunity is clearly profitable, price impact is small, quotes are fresh, and the system is not on cooldown or paused.
4) **Execute the pair**:
   - Primary: Sell token → GALA on GalaChain with tight slippage and a short deadline.
   - Secondary: Buy the token on Solana, at similar protections.
   If one side fails or only partially fills, the other side is canceled or adjusted.
5) **Record the result and cool down**: Update balances and PnL, then briefly wait before trying the same token again.
6) **Bridge periodically**: When enough of a token has accumulated on Solana—or after a set time—the bot bridges that token back to GalaChain and updates inventory when it arrives.

### Which assets it targets (initially)
- FARTCOIN, TRUMP, SOL, and GALA are supported out of the box. More can be added later.

### Inventory mode (why both sides happen together)
The bot doesn’t speculate on direction. It tries to be flat to market moves by selling on GalaChain and buying on Solana within the same decision, so price swings in between legs don’t hurt as much. Any leftover inventory on Solana gets bridged back to GalaChain over time.

### Safety features (guardrails)
- **Minimum profit threshold**: Don’t trade unless the edge is comfortably positive.
- **Max price impact**: Avoid moving the market too much with our order.
- **Short deadlines**: If a transaction doesn’t confirm quickly, it times out.
- **Tight slippage**: Stay close to the quoted price, or don’t fill.
- **Cooldowns**: After each attempt (win or skip), wait briefly before trying again for the same token.
- **Pause conditions**: Ability to pause manually, plus auto-pauses on repeated issues (e.g., bridge delays or slippage problems).

### Costs the bot accounts for
- GalaChain DEX fees (including a fixed GALA-per-hop overhead built into sell estimates)
- Solana DEX and priority fees on the buy side
- Bridge fees (amortized across batches)

### What the bot does NOT do (on purpose, for MVP)
- No complex trade slicing, hedging, or high-frequency tactics
- No multi-route blending or deep MEV/latency optimization
- No dynamic sizing per trade (each token uses a simple, fixed small size)

### A simple example
1) The bot checks TRUMP at a small size.
2) It estimates: “Sell on GalaChain gets me 100 GALA; buy on Solana costs me 99 GALA (after converting); bridge cost is 0.5 GALA; safety margin is 0.2 GALA.”
3) Net Edge = 100 − 99 − 0.5 − 0.2 = 0.3 GALA. If 0.3 GALA is above the configured threshold, it trades.
4) It sells TRUMP → GALA on GalaChain and buys TRUMP on Solana at nearly the same time.
5) After fills, it records profit, updates balances, and starts a cooldown.
6) Later, it bridges the TRUMP purchased on Solana back to GalaChain.

### What you configure
- Which tokens are enabled and the small fixed size per token
- The minimum edge (profit) threshold
- Max price impact and slippage limits
- Bridge rules (e.g., every N minutes or when inventory exceeds a threshold)
- Basic alerts and logging

### Outcome
Over time, the bot only takes the clearest wins, steadily moving value into GalaChain and growing realized profit in GALA—while keeping the logic and risks simple.


