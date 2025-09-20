/**
 * Bollinger Band Backtester (1h, CoinGecko data for GALA v2 on Ethereum)
 *
 * Entries:
 *   - Configurable: "reentry" (default), "touch", or "touch_or_reentry"
 *     - reentry:    prev bar outside band, current bar back inside
 *     - touch:      current close outside band
 *     - touch_or_reentry: either of the above
 * Filters:
 *   - Trend filter via EMA with selectable scope: "both" | "longs_only" | "shorts_only" | "off"
 *   - Overshoot requirement (depth beyond band, as % of band width)
 *   - Max relative bandwidth (skip very wide/trending hours)
 * Exits:
 *   - Cross of middle band (mean target), OR opposite **filtered** entry signal, OR time cap
 * Risk/Costs:
 *   - Per-side fee (bps) applied on entry and exit
 * Ops:
 *   - Cooldown between entries
 *
 * Run: npm run backtest
 * Tweak: edit CONFIG below or set env vars (same names).
 */

/* =========================
   CONFIG — tweak here
   ========================= */
   const CONFIG = {
     // Data / pair
     VS: "eth",           // CoinGecko vs_currency ("eth" or "usd")
     DAYS: 90,            // lookback (2–90 -> hourly data from market_chart)
   
     // Bollinger params
     BB_N: 20,            // periods
     BB_K: 2.0,           // stdev multiplier
   
     // Entry logic
     ENTRY_MODE: "touch_or_reentry" as "reentry" | "touch" | "touch_or_reentry",
   
     // Trend filter scope
     TREND_FILTER_MODE: "shorts_only" as "both" | "longs_only" | "shorts_only" | "off",
     EMA_N: 150,          // EMA length
   
     // Additional filters
     OVERSHOOT_B: 0.05,   // require overshoot beyond band by this fraction of band width (0.05 = 5%)
     BW_MAX: 0.16,        // skip trades if (upper-lower)/mid > BW_MAX
   
     // Trade management
     COOLDOWN_HOURS: 2,   // hours between *exits* and next entry
     MAX_HOLD_HOURS: 72,  // safety cap
   
     // Fees/costs
     FEE_BPS: 10,         // per-side fee (10 = 0.10% at entry + 0.10% at exit)
   
     // Output
     PRINT_TRADES: 12     // show last N trades
   } as const;
  
  /* ===== Optional env overrides (keep simple to use) ===== */
  function numEnv(name: keyof typeof CONFIG): number | undefined {
    const v = process.env[name as string];
    return v !== undefined ? Number(v) : undefined;
  }
  function strEnv<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const v = process.env[name];
    if (!v) return fallback;
    const vv = v.toLowerCase() as T;
    return (allowed as readonly string[]).includes(vv) ? vv as T : fallback;
  }
  
  const VS               = process.env.VS               ?? CONFIG.VS;
  const DAYS             = numEnv("DAYS")               ?? CONFIG.DAYS;
  const BB_N             = numEnv("BB_N")               ?? CONFIG.BB_N;
  const BB_K             = numEnv("BB_K")               ?? CONFIG.BB_K;
  const ENTRY_MODE       = strEnv("ENTRY_MODE", ["reentry","touch","touch_or_reentry"] as const, CONFIG.ENTRY_MODE);
  const TREND_FILTER_MODE= strEnv("TREND_FILTER_MODE", ["both","longs_only","shorts_only","off"] as const, CONFIG.TREND_FILTER_MODE);
  const EMA_N            = numEnv("EMA_N")              ?? CONFIG.EMA_N;
  const OVERSHOOT_B      = numEnv("OVERSHOOT_B")        ?? CONFIG.OVERSHOOT_B;
  const BW_MAX           = numEnv("BW_MAX")             ?? CONFIG.BW_MAX;
  const COOLDOWN_HOURS   = numEnv("COOLDOWN_HOURS")     ?? CONFIG.COOLDOWN_HOURS;
  const MAX_HOLD_HOURS   = numEnv("MAX_HOLD_HOURS")     ?? CONFIG.MAX_HOLD_HOURS;
  const FEE_BPS          = numEnv("FEE_BPS")            ?? CONFIG.FEE_BPS;
  const PRINT_TRADES     = numEnv("PRINT_TRADES")       ?? CONFIG.PRINT_TRADES;
  
  /* =========================
     Backtest implementation
     ========================= */
  
  // CoinGecko (GALA v2 on Ethereum) hourly price series:
  const GALA_V2_CONTRACT = "0xd1d2eb1b1e90b638588728b4130137d262c87cae";
  const API_URL =
    `https://api.coingecko.com/api/v3/coins/ethereum/contract/${GALA_V2_CONTRACT}/market_chart?vs_currency=${VS}&days=${DAYS}`;
  const CG_KEY = process.env.CG_KEY ?? ""; // optional demo/pro key
  
  type Candle = { t: number; c: number };
  type Side = "LONG" | "SHORT";
  type Trade = {
    side: Side;
    entryIdx: number;
    entryT: number; entry: number;
    exitIdx?: number;
    exitT?: number; exit?: number;
    bars?: number;
    pnl?: number;
    reason?: string;
  };
  
  function stdev(vals: number[]): number {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((acc, x) => acc + (x - m) ** 2, 0) / vals.length;
    return Math.sqrt(v);
  }
  function ema(series: number[], n: number): number {
    if (series.length === 0) return 0;
    // seed with SMA of first n or all if shorter
    const seedLen = Math.min(n, series.length);
    let e = series.slice(0, seedLen).reduce((a,b)=>a+b,0) / seedLen;
    const k = 2 / (n + 1);
    for (let i = seedLen; i < series.length; i++) e = series[i] * k + e * (1 - k);
    return e;
  }
  function bbFrom(window: number[]) {
    const mid = window.reduce((a, b) => a + b, 0) / window.length;
    const sd = stdev(window);
    return { mid, upper: mid + BB_K * sd, lower: mid - BB_K * sd };
  }
  function crossMid(prev: number, curr: number, midPrev: number, midCurr: number, side: Side) {
    // LONG exits on upward cross of mid; SHORT exits on downward cross
    if (side === "LONG") return prev < midPrev && curr >= midCurr;
    return prev > midPrev && curr <= midCurr;
  }
  async function fetchCloses(): Promise<Candle[]> {
    const headers: Record<string, string> = {};
    if (CG_KEY) headers["x-cg-demo-api-key"] = CG_KEY;
    const res = await fetch(API_URL, { headers, cache: "no-store" });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    if (!data?.prices) throw new Error("Bad response shape");
    return data.prices.map((p: [number, number]) => ({ t: p[0], c: p[1] }));
  }
  function fmtISO(ms: number) {
    return new Date(ms).toISOString().replace(".000Z","Z");
  }
  
  /** Apply trend filter scope: return whether LONG/SHORT is allowed at this bar */
  function trendAllows(side: Side, emaCurr: number, curr: number): boolean {
    if (TREND_FILTER_MODE === "off") return true;
    const wantLongCheck = (TREND_FILTER_MODE === "both" || TREND_FILTER_MODE === "longs_only");
    const wantShortCheck = (TREND_FILTER_MODE === "both" || TREND_FILTER_MODE === "shorts_only");
    if (side === "LONG")  return wantLongCheck  ? (curr >= emaCurr) : true;
    if (side === "SHORT") return wantShortCheck ? (curr <= emaCurr) : true;
    return true;
  }
  
  async function main() {
    const candles = await fetchCloses();
    const closes = candles.map(x => x.c);
    if (closes.length < BB_N + 5) throw new Error("Not enough data for backtest.");
  
    let lastSignalAt: number | undefined; // ms since exit to next entry (cooldown)
    let position: Trade | null = null;
    const trades: Trade[] = [];
  
    for (let i = BB_N; i < closes.length; i++) {
      const prev = closes[i - 1];
      const curr = closes[i];
  
      // Bands (current and previous)
      const winCurr = closes.slice(i - BB_N, i);
      const bandsCurr = bbFrom(winCurr);
  
      const winPrev = closes.slice(i - BB_N - 1, i - 1);
      const bandsPrev = winPrev.length === BB_N ? bbFrom(winPrev) : bandsCurr;
  
      // Re-entry conditions
      const reEntryBuy  = (prev < bandsCurr.lower && curr >= bandsCurr.lower);
      const reEntrySell = (prev > bandsCurr.upper && curr <= bandsCurr.upper);
      // Touch conditions
      const touchBuy  = (curr < bandsCurr.lower);
      const touchSell = (curr > bandsCurr.upper);
  
      // Overshoot checks:
      // - For reentry: previous bar must be beyond band by OVERSHOOT_B of band width
      // - For touch:   current bar must be beyond band by OVERSHOOT_B of band width
      const bwPrev = bandsPrev.upper - bandsPrev.lower;
      const bPrev = (prev - bandsPrev.lower) / bwPrev; // <0 below lower, >1 above upper
      const bwCurr = bandsCurr.upper - bandsCurr.lower;
      const bCurr = (curr - bandsCurr.lower) / bwCurr;
  
      // Relative bandwidth filter (skip very wide bands)
      const relBW = bwCurr / bandsCurr.mid;
  
      // Build raw signal per ENTRY_MODE
      let signal: "BUY" | "SELL" | "NONE" = "NONE";
      if (ENTRY_MODE === "reentry") {
        if (reEntryBuy && (bPrev < -OVERSHOOT_B)) signal = "BUY";
        if (reEntrySell && (bPrev > 1 + OVERSHOOT_B)) signal = "SELL";
      } else if (ENTRY_MODE === "touch") {
        if (touchBuy && (bCurr < -OVERSHOOT_B)) signal = "BUY";
        if (touchSell && (bCurr > 1 + OVERSHOOT_B)) signal = "SELL";
      } else { // touch_or_reentry
        const buyOK  = (reEntryBuy  && (bPrev < -OVERSHOOT_B)) || (touchBuy  && (bCurr < -OVERSHOOT_B));
        const sellOK = (reEntrySell && (bPrev > 1 + OVERSHOOT_B)) || (touchSell && (bCurr > 1 + OVERSHOOT_B));
        if (buyOK)  signal = "BUY";
        if (sellOK) signal = "SELL";
      }
  
      // Skip if bandwidth too wide
      if (signal !== "NONE" && relBW > BW_MAX) signal = "NONE";
  
      // Trend filter (scope-aware)
      if (signal !== "NONE") {
        const emaCurr = ema(closes.slice(0, i + 1), EMA_N);
        const side = signal === "BUY" ? "LONG" : "SHORT";
        if (!trendAllows(side, emaCurr, curr)) signal = "NONE";
      }
  
      // Midline values for exit check
      const midPrev = bandsPrev.mid;
      const midCurr = bandsCurr.mid;
  
      // --- Manage open position first: exits ---
      if (position) {
        const side = position.side;
        const barAge = i - position.entryIdx; // 1h bars
        let exit = false;
        let reason = "";
  
        // 1) Midline cross
        if (crossMid(prev, curr, midPrev, midCurr, side)) {
          exit = true; reason = "midline";
        }
  
        // 2) Opposite filtered entry signal (consistent with your entry filters)
        if (!exit) {
          const oppositeNow = (signal === "BUY" && side === "SHORT") || (signal === "SELL" && side === "LONG");
          if (oppositeNow) { exit = true; reason = "opposite-signal"; }
        }
  
        // 3) Time cap
        if (!exit && barAge >= MAX_HOLD_HOURS) { exit = true; reason = "time-cap"; }
  
        if (exit) {
          position.exit = curr;
          position.exitT = candles[i].t;
          position.exitIdx = i;
          position.bars = barAge;
  
          // PnL per unit in quote currency, minus fees on both sides
          const feeRate = FEE_BPS / 10_000;
          const gross = (side === "LONG") ? (position.exit - position.entry)
                                          : (position.entry - position.exit);
          const fees = position.entry * feeRate + position.exit * feeRate;
          position.pnl = gross - fees;
  
          position.reason = reason;
          trades.push(position);
          position = null;
          lastSignalAt = candles[i].t; // cooldown starts after exit
          continue; // don't enter on same bar as exit
        }
      }
  
      // --- Flat: consider entry (respect cooldown) ---
      if (!position && (signal === "BUY" || signal === "SELL")) {
        const nowT = candles[i].t;
        const okCooldown = !lastSignalAt || ((nowT - lastSignalAt) / 3_600_000) >= COOLDOWN_HOURS;
        if (okCooldown) {
          position = {
            side: signal === "BUY" ? "LONG" : "SHORT",
            entry: curr,
            entryT: nowT,
            entryIdx: i
          };
        }
      }
    }
  
    // Close any open position at the end
    if (position) {
      const last = candles[candles.length - 1];
      position.exit = last.c;
      position.exitT = last.t;
      position.exitIdx = candles.length - 1;
      position.bars = position.exitIdx - position.entryIdx;
  
      const feeRate = FEE_BPS / 10_000;
      const gross = (position.side === "LONG") ? (position.exit - position.entry)
                                              : (position.entry - position.exit);
      const fees = position.entry * feeRate + position.exit * feeRate;
      position.pnl = gross - fees;
  
      position.reason = "eod";
      trades.push(position);
    }
  
    // --- Stats ---
    const total = trades.length;
    const wins = trades.filter(t => (t.pnl ?? 0) > 0).length;
    const sum = trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
    const avg = total ? sum / total : 0;
  
    const posSum = trades.filter(t => (t.pnl ?? 0) > 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
    const negSum = trades.filter(t => (t.pnl ?? 0) < 0).reduce((a, t) => a + (t.pnl ?? 0), 0);
    const profitFactor = negSum !== 0 ? (posSum / Math.abs(negSum)) : Infinity;
  
    // Equity & drawdown
    const equity: number[] = [];
    let eq = 0;
    for (const tr of trades) { eq += tr.pnl ?? 0; equity.push(eq); }
    let peak = -Infinity, maxDD = 0;
    for (const v of equity) { peak = Math.max(peak, v); maxDD = Math.min(maxDD, v - peak); }
  
    const weeks = DAYS / 7;
    const tradesPerWeek = weeks ? (total / weeks) : total;
  
    console.log("=== Backtest Summary ===");
    console.log(`Pair: GALA / ${VS.toUpperCase()} (1h)`);
    console.log(`Lookback: ${DAYS}d   Bands: N=${BB_N}, K=${BB_K}`);
    console.log(`Entry: ${ENTRY_MODE}   Trend: ${TREND_FILTER_MODE === "off" ? "off" : `EMA(${EMA_N}) scope=${TREND_FILTER_MODE}`}`);
    console.log(`Filters: Overshoot=${OVERSHOOT_B}  BW_MAX=${BW_MAX}  Cooldown=${COOLDOWN_HOURS}h  MaxHold=${MAX_HOLD_HOURS}h  Fees=${FEE_BPS}bps/side`);
    console.log(`Trades: ${total}  (${tradesPerWeek.toFixed(1)}/wk)  Wins: ${wins}  Win%: ${total ? (100*wins/total).toFixed(1) : "0"}%`);
    console.log(`Total PnL (per unit): ${sum}`);
    console.log(`Avg PnL/trade:        ${avg}`);
    console.log(`Profit factor:        ${profitFactor.toFixed(2)}`);
    console.log(`Max drawdown:         ${maxDD}`);
    console.log("");
  
    const n = Math.min(PRINT_TRADES, trades.length);
    console.log(`Last ${n} trades:`);
    for (const tr of trades.slice(-n)) {
      console.log(
        `${tr.side.padEnd(5)} entry=${tr.entry?.toFixed(8)} @ ${fmtISO(tr.entryT!)} -> `
        + `exit=${tr.exit?.toFixed(8)} @ ${fmtISO(tr.exitT!)}  `
        + `bars=${tr.bars}  pnl=${tr.pnl?.toFixed(8)}  reason=${tr.reason}`
      );
    }
  }
  
  main().catch(e => { console.error(e); process.exit(1); });
  