/**
 * GALA (Ethereum v2) Bollinger Band hourly checker (CoinGecko)
 * - Mirrors backtester logic/parameters so live signals match backtests
 * - Entry modes: "reentry" | "touch" | "touch_or_reentry"
 * - Trend filter scope: "both" | "longs_only" | "shorts_only" | "off"
 * - Filters: overshoot (%B cushion), max relative bandwidth
 * - Cooldown persisted in ./state.json (by default)
 *
 * Output: logs current band values + final actionable suggestion (manual)
 *
 * Requirements: Node 18+ (built-in fetch)
 */

import { config } from "dotenv";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Load environment variables from .env file
config();
import { 
  PriceSourceManager, 
  CoinGeckoSource, 
  GSwapSource, 
  BinanceSource,
  formatPriceComparison,
  shouldProceedWithTrade,
  type PriceComparison 
} from "./priceSources.js";

/* =========================
   CONFIG — tweak here (or via env)
   ========================= */
const CONFIG = {
  // Data / pair
  VS: "eth" as "eth" | "usd",
  DAYS: 30,              // 2–90 → hourly data from CoinGecko market_chart

  // Bollinger params
  BB_N: 20,
  BB_K: 2.0,

  // Entry logic
  ENTRY_MODE: "touch_or_reentry" as "reentry" | "touch" | "touch_or_reentry",

  // Trend filter scope (like backtest)
  TREND_FILTER_MODE: "shorts_only" as "both" | "longs_only" | "shorts_only" | "off",
  EMA_N: 150,

  // Filters
  OVERSHOOT_B: 0.05,     // 5% of band width beyond band
  BW_MAX: 0.16,          // skip if (upper-lower)/mid > 0.16

  // Cooldown & persistence
  COOLDOWN_HOURS: 3,
  STATE_FILE: "state.json", // default written next to compiled file (dist/state.json)

  // Price comparison
  ENABLE_PRICE_COMPARISON: true,
  PRIMARY_PRICE_SOURCE: "coingecko",
  SECONDARY_PRICE_SOURCE: "gswap",
  PRICE_DISCREPANCY_THRESHOLD: 0.02, // 2%
} as const;

/* ===== Optional env overrides ===== */
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
const VS               = (process.env.VS as "eth" | "usd") ?? CONFIG.VS;
const DAYS             = numEnv("DAYS")             ?? CONFIG.DAYS;
const BB_N             = numEnv("BB_N")             ?? CONFIG.BB_N;
const BB_K             = numEnv("BB_K")             ?? CONFIG.BB_K;
const ENTRY_MODE       = strEnv("ENTRY_MODE", ["reentry","touch","touch_or_reentry"] as const, CONFIG.ENTRY_MODE);
const TREND_FILTER_MODE= strEnv("TREND_FILTER_MODE", ["both","longs_only","shorts_only","off"] as const, CONFIG.TREND_FILTER_MODE);
const EMA_N            = numEnv("EMA_N")            ?? CONFIG.EMA_N;
const OVERSHOOT_B      = numEnv("OVERSHOOT_B")      ?? CONFIG.OVERSHOOT_B;
const BW_MAX           = numEnv("BW_MAX")           ?? CONFIG.BW_MAX;
const COOLDOWN_HOURS   = numEnv("COOLDOWN_HOURS")   ?? CONFIG.COOLDOWN_HOURS;
const ENABLE_PRICE_COMPARISON = process.env.ENABLE_PRICE_COMPARISON === "true" || CONFIG.ENABLE_PRICE_COMPARISON;
const PRIMARY_PRICE_SOURCE = process.env.PRIMARY_PRICE_SOURCE ?? CONFIG.PRIMARY_PRICE_SOURCE;
const SECONDARY_PRICE_SOURCE = process.env.SECONDARY_PRICE_SOURCE ?? CONFIG.SECONDARY_PRICE_SOURCE;
const PRICE_DISCREPANCY_THRESHOLD = numEnv("PRICE_DISCREPANCY_THRESHOLD") ?? CONFIG.PRICE_DISCREPANCY_THRESHOLD;

/* =========================
   Setup & helpers
   ========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type BotState = { lastSignalAt?: number; lastAction?: "BUY" | "SELL" };

const STATE_FILE_PATH = path.isAbsolute(CONFIG.STATE_FILE)
  ? CONFIG.STATE_FILE
  : path.join(__dirname, CONFIG.STATE_FILE); // dist/state.json by default

const CG_KEY = process.env.CG_KEY ?? ""; // CoinGecko demo/pro key if you have one
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? ""; // Private key for GSwap SDK

// GALA (v2) on Ethereum:
const GALA_V2_CONTRACT = "0xd1d2eb1b1e90b638588728b4130137d262c87cae";
const API_URL =
  `https://api.coingecko.com/api/v3/coins/ethereum/contract/${GALA_V2_CONTRACT}/market_chart?vs_currency=${VS}&days=${DAYS}`;

// Initialize price source manager
const priceManager = new PriceSourceManager(PRICE_DISCREPANCY_THRESHOLD);
priceManager.addSource("coingecko", new CoinGeckoSource(CG_KEY));
priceManager.addSource("gswap", new GSwapSource(PRIVATE_KEY));
priceManager.addSource("binance", new BinanceSource());

function formatET(d = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(d);
}
async function loadState(): Promise<BotState> {
  try {
    if (!existsSync(STATE_FILE_PATH)) return {};
    const raw = await readFile(STATE_FILE_PATH, "utf-8");
    return JSON.parse(raw) as BotState;
  } catch { return {}; }
}
async function saveState(s: BotState) {
  try { await writeFile(STATE_FILE_PATH, JSON.stringify(s, null, 2), "utf-8"); }
  catch (e) { console.error("Failed saving state:", e); }
}

function stdev(vals: number[]): number {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const v = vals.reduce((acc, x) => acc + (x - m) ** 2, 0) / vals.length;
  return Math.sqrt(v);
}
function ema(series: number[], n: number): number {
  if (series.length === 0) return 0;
  const seedLen = Math.min(n, series.length);
  let e = series.slice(0, seedLen).reduce((a,b)=>a+b,0) / seedLen;
  const k = 2 / (n + 1);
  for (let i = seedLen; i < series.length; i++) {
    const value = series[i];
    if (value !== undefined) {
      e = value * k + e * (1 - k);
    }
  }
  return e;
}
function bandsFrom(win: number[]) {
  const mid = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = stdev(win);
  return { mid, upper: mid + BB_K * sd, lower: mid - BB_K * sd };
}

async function fetchCloses(): Promise<number[]> {
  const headers: Record<string, string> = {};
  if (CG_KEY) headers["x-cg-demo-api-key"] = CG_KEY; // optional
  const res = await fetch(API_URL, { headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CoinGecko error ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (!data?.prices || !Array.isArray(data.prices)) {
    throw new Error("Unexpected response shape from CoinGecko");
  }
  return data.prices.map((p: [number, number]) => p[1]);
}

/** Decide raw BUY/SELL/NONE using the same logic as backtest + give filter reasons */
function decideSignal(closes: number[]) {
  const i = closes.length - 1;
  const prev = closes[i - 1];
  const curr = closes[i];

  // Check for undefined values
  if (prev === undefined || curr === undefined) {
    return { signal: "NONE" as const, prev: 0, curr: 0, bandsCurr: { mid: 0, upper: 0, lower: 0 }, bandsPrev: { mid: 0, upper: 0, lower: 0 }, relBW: 0, bPrev: 0, bCurr: 0, reasons: ["insufficient data"] };
  }

  // Bands current & previous
  const winCurr = closes.slice(i - BB_N, i);
  const bandsCurr = bandsFrom(winCurr);

  const winPrev = closes.slice(i - BB_N - 1, i - 1);
  const bandsPrev = winPrev.length === BB_N ? bandsFrom(winPrev) : bandsCurr;

  // Re-entry & touch conditions
  const reEntryBuy  = (prev < bandsCurr.lower && curr >= bandsCurr.lower);
  const reEntrySell = (prev > bandsCurr.upper && curr <= bandsCurr.upper);
  const touchBuy  = (curr < bandsCurr.lower);
  const touchSell = (curr > bandsCurr.upper);

  // Overshoot: bPrev for reentry depth, bCurr for touch depth
  const bwPrev = bandsPrev.upper - bandsPrev.lower;
  const bPrev = (prev - bandsPrev.lower) / bwPrev;
  const bwCurr = bandsCurr.upper - bandsCurr.lower;
  const bCurr = (curr - bandsCurr.lower) / bwCurr;

  const relBW = bwCurr / bandsCurr.mid;

  // Build raw signal based on ENTRY_MODE + overshoot
  let signal: "BUY" | "SELL" | "NONE" = "NONE";
  let reasons: string[] = [];

  if (ENTRY_MODE === "reentry") {
    if (reEntryBuy && (bPrev < -OVERSHOOT_B)) signal = "BUY"; else reasons.push("overshoot/reentry");
    if (reEntrySell && (bPrev > 1 + OVERSHOOT_B)) signal = "SELL"; else if (signal==="NONE") reasons.push("overshoot/reentry");
  } else if (ENTRY_MODE === "touch") {
    if (touchBuy && (bCurr < -OVERSHOOT_B)) signal = "BUY"; else reasons.push("overshoot/touch");
    if (touchSell && (bCurr > 1 + OVERSHOOT_B)) signal = "SELL"; else if (signal==="NONE") reasons.push("overshoot/touch");
  } else { // touch_or_reentry
    const buyOK  = (reEntryBuy  && (bPrev < -OVERSHOOT_B)) || (touchBuy  && (bCurr < -OVERSHOOT_B));
    const sellOK = (reEntrySell && (bPrev > 1 + OVERSHOOT_B)) || (touchSell && (bCurr > 1 + OVERSHOOT_B));
    if (buyOK)  signal = "BUY";
    if (sellOK) signal = "SELL";
    if (signal === "NONE") reasons.push("no reentry/touch with overshoot");
  }

  // Bandwidth cap
  if (signal !== "NONE" && relBW > BW_MAX) {
    reasons.push(`bandwidth>${BW_MAX}`);
    signal = "NONE";
  }

  // Trend filter (scope-aware)
  if (signal !== "NONE" && TREND_FILTER_MODE !== "off") {
    const emaCurr = ema(closes, EMA_N);
    const wantLongCheck = (TREND_FILTER_MODE === "both" || TREND_FILTER_MODE === "longs_only");
    const wantShortCheck = (TREND_FILTER_MODE === "both" || TREND_FILTER_MODE === "shorts_only");
    if ((signal === "BUY"  && wantLongCheck  && curr < emaCurr) ||
        (signal === "SELL" && wantShortCheck && curr > emaCurr)) {
      reasons.push(`trend(${TREND_FILTER_MODE})`);
      signal = "NONE";
    }
  }

  return { signal, prev, curr, bandsCurr, bandsPrev, relBW, bPrev, bCurr, reasons };
}

function formatNum(n: number) {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1) return n.toFixed(8);
  if (abs >= 1e-4) return n.toFixed(8);
  return n.toExponential(3);
}

async function comparePrices(): Promise<PriceComparison | null> {
  if (!ENABLE_PRICE_COMPARISON) return null;
  
  try {
    const symbol = VS === "eth" ? "GALAETH" : "GALAUSDT";
    return await priceManager.comparePrices(symbol, PRIMARY_PRICE_SOURCE, SECONDARY_PRICE_SOURCE);
  } catch (error) {
    console.warn(`Price comparison failed: ${error}`);
    return null;
  }
}

async function runOnce(tag = "scheduled") {
  try {
    const closes = await fetchCloses();
    if (closes.length < BB_N + 2) throw new Error(`Need at least ${BB_N + 2} closes`);

    const { signal, prev, curr, bandsCurr, relBW, reasons } = decideSignal(closes);
    
    // Perform price comparison
    const priceComparison = await comparePrices();

    // Cooldown gate for actionable signals
    const actionable = signal === "BUY" || signal === "SELL";
    const state = await loadState();
    const nowMs = Date.now();

    // Check price comparison validity
    const priceValid = !priceComparison || shouldProceedWithTrade(priceComparison);
    const priceNote = priceComparison && !priceValid ? " (PRICE DISCREPANCY)" : "";

    let finalAction = (signal === "BUY")
      ? `BUY (re-entry/touch qualified)${priceNote}`
      : (signal === "SELL") ? `SELL/SHORT (re-entry/touch qualified)${priceNote}`
      : "No trade";

    let cooldownNote = "";
    if (actionable && priceValid) {
      const lastAt = state.lastSignalAt ?? 0;
      const hoursSince = (nowMs - lastAt) / 3_600_000;
      if (hoursSince < COOLDOWN_HOURS) {
        finalAction = `COOLDOWN (${(COOLDOWN_HOURS - hoursSince).toFixed(2)}h left) – ${finalAction}`;
        cooldownNote = "suppressed due to cooldown";
      } else {
        // record new signal time & type
        state.lastSignalAt = nowMs;
        state.lastAction = signal as "BUY" | "SELL";
        await saveState(state);
      }
    }

    console.log("=======================================");
    console.log(`Time (ET):         ${formatET(new Date())}  [${tag}]`);
    console.log(`Pair:              GALA (ERC-20 v2) / ${VS.toUpperCase()}`);
    console.log(`Period/Params:     1h  N=${BB_N}  K=${BB_K}  Entry=${ENTRY_MODE}`);
    console.log(`Trend filter:      ${TREND_FILTER_MODE === "off" ? "off" : `EMA(${EMA_N}) scope=${TREND_FILTER_MODE}`}`);
    console.log(`Filters:           Overshoot=${OVERSHOOT_B}  BW_MAX=${BW_MAX}  Cooldown=${COOLDOWN_HOURS}h`);
    console.log(`Closes:            prev=${formatNum(prev ?? 0)}  curr=${formatNum(curr ?? 0)}`);
    console.log(`Bands:             mid=${formatNum(bandsCurr.mid)}  upper=${formatNum(bandsCurr.upper)}  lower=${formatNum(bandsCurr.lower)}`);
    console.log(`Rel bandwidth:     ${(relBW * 100).toFixed(2)}%`);
    if (reasons.length) console.log(`Filters hit:       ${reasons.join(", ")}`);
    if (priceComparison) {
      console.log(`Price comparison:  ${formatPriceComparison(priceComparison)}`);
    }
    console.log(`Suggested Action:  ${finalAction} ${cooldownNote}`);
    console.log(`State file:        ${STATE_FILE_PATH}`);
    console.log("=======================================");
  } catch (err: any) {
    console.error(`[ERROR ${formatET()}]`, err?.message ?? err);
  }
}

/** Schedule to top of hour */
function scheduleHourly() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  if (next <= now) next.setHours(next.getHours() + 1);
  console.log(`Starting… next check at (ET): ${formatET(next)}; then every 60 minutes.`);
  setTimeout(async () => {
    await runOnce("on-the-hour");
    setInterval(() => runOnce("on-the-hour"), 60 * 60 * 1000);
  }, next.getTime() - now.getTime());
}

// Kick off
runOnce("immediate").then(() => scheduleHourly());
