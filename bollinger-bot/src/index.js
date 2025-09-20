/**
 * GALA (Ethereum v2) Bollinger Band checker (hourly)
 * - Pulls hourly price points from CoinGecko
 * - Computes 20,2 Bollinger Bands
 * - On the top of each hour, logs values + suggested manual action
 *
 * Requirements: Node 18+ (built-in fetch)
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _a, _b, _c, _d, _e;
var CG_KEY = (_a = process.env.CG_KEY) !== null && _a !== void 0 ? _a : ""; // optional demo/pro key
var DAYS = Number((_b = process.env.DAYS) !== null && _b !== void 0 ? _b : 30); // keep 2–90 to get hourly granularity
var N = Number((_c = process.env.BB_N) !== null && _c !== void 0 ? _c : 20); // SMA period
var K = Number((_d = process.env.BB_K) !== null && _d !== void 0 ? _d : 2); // standard deviation multiplier
var VS = (_e = process.env.VS) !== null && _e !== void 0 ? _e : "eth";
// GALA (v2) on Ethereum mainnet:
var GALA_V2_CONTRACT = "0xd1d2eb1b1e90b638588728b4130137d262c87cae";
var COINGECKO_URL = "https://api.coingecko.com/api/v3/coins/ethereum/contract/".concat(GALA_V2_CONTRACT, "/market_chart?vs_currency=").concat(VS, "&days=").concat(DAYS);
function formatET(d) {
    if (d === void 0) { d = new Date(); }
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(d);
}
function stdev(vals) {
    var m = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var v = vals.reduce(function (acc, x) { return acc + Math.pow((x - m), 2); }, 0) / vals.length;
    return Math.sqrt(v);
}
function bb(lastN, n, k) {
    if (lastN.length < n)
        throw new Error("Need at least ".concat(n, " closes, got ").concat(lastN.length));
    var window = lastN.slice(-n);
    var mid = window.reduce(function (a, b) { return a + b; }, 0) / n;
    var sd = stdev(window);
    var upper = mid + k * sd;
    var lower = mid - k * sd;
    return { mid: mid, upper: upper, lower: lower };
}
function fetchCloses() {
    return __awaiter(this, void 0, void 0, function () {
        var headers, res, text, data, closes;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    headers = {};
                    if (CG_KEY)
                        headers["x-cg-demo-api-key"] = CG_KEY; // CoinGecko accepts demo/pro header names
                    return [4 /*yield*/, fetch(COINGECKO_URL, { headers: headers, cache: "no-store" })];
                case 1:
                    res = _a.sent();
                    if (!!res.ok) return [3 /*break*/, 3];
                    return [4 /*yield*/, res.text()];
                case 2:
                    text = _a.sent();
                    throw new Error("CoinGecko error ".concat(res.status, ": ").concat(text));
                case 3: return [4 /*yield*/, res.json()];
                case 4:
                    data = _a.sent();
                    // data.prices = [[ms, price], ...] with hourly points for 2–90 days
                    if (!(data === null || data === void 0 ? void 0 : data.prices) || !Array.isArray(data.prices)) {
                        throw new Error("Unexpected response shape from CoinGecko");
                    }
                    closes = data.prices.map(function (p) { return p[1]; });
                    if (closes.length < N + 1) {
                        throw new Error("Not enough data points: have ".concat(closes.length, ", need at least ").concat(N + 1));
                    }
                    return [2 /*return*/, closes];
            }
        });
    });
}
/**
 * Simple signal logic (manual action):
 * - BUY signal: previous close < lower AND current close >= lower (re-entering band from oversold)
 * - SELL/SHORT signal: previous close > upper AND current close <= upper (re-entering band from overbought)
 * - Else:
 *    - If current < lower -> "Oversold watch"
 *    - If current > upper -> "Overbought watch"
 *    - Otherwise -> "No trade"
 */
function decideAction(prev, curr, bands) {
    var upper = bands.upper, lower = bands.lower;
    if (prev < lower && curr >= lower)
        return "BUY (re-entry from oversold)";
    if (prev > upper && curr <= upper)
        return "SELL/SHORT (re-entry from overbought)";
    if (curr < lower)
        return "Watchlist: oversold (no re-entry yet)";
    if (curr > upper)
        return "Watchlist: overbought (no re-entry yet)";
    return "No trade";
}
function runOnce() {
    return __awaiter(this, arguments, void 0, function (tag) {
        var closes, prev, curr, bands, action, err_1;
        var _a;
        if (tag === void 0) { tag = "scheduled"; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, fetchCloses()];
                case 1:
                    closes = _b.sent();
                    prev = closes[closes.length - 2];
                    curr = closes[closes.length - 1];
                    bands = bb(closes, N, K);
                    action = decideAction(prev, curr, bands);
                    console.log("=======================================");
                    console.log("Time (ET):       ".concat(formatET(new Date()), "  [").concat(tag, "]"));
                    console.log("Pair:            GALA (ERC-20 v2) / ".concat(VS.toUpperCase()));
                    console.log("Period:          1h   Bands: N=".concat(N, ", K=").concat(K));
                    console.log("Last close:      ".concat(curr));
                    console.log("Prev close:      ".concat(prev));
                    console.log("BB Middle:       ".concat(bands.mid));
                    console.log("BB Upper:        ".concat(bands.upper));
                    console.log("BB Lower:        ".concat(bands.lower));
                    console.log("Suggested Action: ".concat(action));
                    console.log("=======================================");
                    return [3 /*break*/, 3];
                case 2:
                    err_1 = _b.sent();
                    console.error("[ERROR ".concat(formatET(), "]"), (_a = err_1 === null || err_1 === void 0 ? void 0 : err_1.message) !== null && _a !== void 0 ? _a : err_1);
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Schedule to the top of the hour.
 * - On start: wait until the next hh:00:00, then run
 * - After first run: run every 60 minutes exactly
 */
function scheduleHourly() {
    var _this = this;
    var now = new Date();
    var next = new Date(now);
    next.setMinutes(0, 0, 0);
    if (next <= now)
        next.setHours(next.getHours() + 1);
    var ms = next.getTime() - now.getTime();
    console.log("Starting\u2026 next check at (ET): ".concat(formatET(next), "; then every 60 minutes."));
    setTimeout(function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, runOnce("on-the-hour")];
                case 1:
                    _a.sent();
                    setInterval(function () { return runOnce("on-the-hour"); }, 60 * 60 * 1000);
                    return [2 /*return*/];
            }
        });
    }); }, ms);
}
// Optional: run an immediate check at launch so you see output right away
runOnce("immediate").then(function () { return scheduleHourly(); });
