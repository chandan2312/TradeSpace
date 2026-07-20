// Self-check for lib/executor (run: node lib/executor/selfcheck.mjs)
import { decideMode, candleConfirm, structuralConfirm, hardInvalidation } from "./modes.js";
import { assessContext } from "./context.js";

// NB: intentionally do NOT import ./store.js — it transitively loads mongo.js,
// which instantiates a MongoClient at import time. The pure logic under test
// never needs Mongo, so we inline the config defaults the tests rely on.
const cfg = { directMin: 70, confirmMin: 45, approachMult: 1.5 };

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error("FAIL:", msg); } };
ok(decideMode(85, cfg) === "direct", "score 85 → direct");
ok(decideMode(70, cfg) === "direct", "score 70 (== directMin) → direct");
ok(decideMode(60, cfg) === "candle", "score 60 → candle");
ok(decideMode(45, cfg) === "candle", "score 45 (== confirmMin) → candle");
ok(decideMode(30, cfg) === "structural", "score 30 → structural");

// ---- candleConfirm ----
// bullish rejection candle: long lower wick, close in upper half
const rejBull = [
  { open: 1.10, high: 1.101, low: 1.099, close: 1.1005 },
  { open: 1.1005, high: 1.1008, low: 1.099, close: 1.1004 },
  { open: 1.1000, high: 1.1012, low: 1.0985, close: 1.1010 }, // lower wick 25p of 27p range, closes up
];
const cbc = candleConfirm(rejBull, "buy");
ok(cbc.pass, "bullish rejection candle confirms buy, got: " + cbc.note);
// no-confirm: bearish candle for a buy
const bear = [
  { open: 1.10, high: 1.101, low: 1.099, close: 1.0995 },
  { open: 1.0995, high: 1.0996, low: 1.098, close: 1.0985 },
  { open: 1.0985, high: 1.0987, low: 1.097, close: 1.0972 }, // strong down close
];
ok(!candleConfirm(bear, "buy").pass, "bearish candle does not confirm buy");
// engulfing bull
const engulf = [
  { open: 1.10, high: 1.1005, low: 1.0995, close: 1.0998 },
  { open: 1.0998, high: 1.1000, low: 1.0990, close: 1.0994 }, // small down candle
  { open: 1.0993, high: 1.1015, low: 1.0992, close: 1.1012 }, // engulfs prior, closes above prior high
];
ok(candleConfirm(engulf, "buy").pass, "engulfing candle confirms buy, got: " + candleConfirm(engulf, "buy").note);

// ---- hardInvalidation: price through SL ----
const setup = { entry: 1.10, sl: 1.095, tp: 1.11, tf: "M15" };
ok(hardInvalidation(null, "buy", setup, 1.094).dead, "price below SL → dead (buy)");
ok(!hardInvalidation(null, "buy", setup, 1.099).dead, "price above SL → alive (buy)");
const setupS = { entry: 1.10, sl: 1.105, tp: 1.09, tf: "M15" };
ok(hardInvalidation(null, "sell", setupS, 1.106).dead, "price above SL → dead (sell)");

// ---- structuralConfirm without frames ----
ok(!structuralConfirm({}, "buy").pass, "no M15 → structural not confirmed");

// ---- assessContext on synthetic frames (fx + non-fx) ----
function mkBars(n, tfSec, dir = 1, start = 1_700_000_000) {
  const bars = []; let p = 1.10;
  for (let i = 0; i < n; i++) {
    const up = (i % 10) < 6;
    p += (up ? 0.0012 : -0.0006) * dir;
    bars.push({ time: start + i * tfSec, open: p - 0.0002 * dir, high: p + 0.0004, low: p - 0.0004, close: p, v: 100 });
  }
  return bars;
}
const frames = { H4: mkBars(120, 14400), H1: mkBars(240, 3600), M15: mkBars(320, 900) };
const csFx = [{ ccy: "EUR", score: 40 }, { ccy: "USD", score: -30 }, { ccy: "JPY", score: -10 }, { ccy: "GBP", score: 15 }];

const ctxFx = assessContext("EURUSD", frames, "buy", { entry: 1.10, sl: 1.095, tp: 1.115, tf: "M15" }, cfg, csFx);
ok(ctxFx && typeof ctxFx.score === "number" && ctxFx.score >= 0 && ctxFx.score <= 100, "fx context score in 0..100, got " + ctxFx?.score);
ok(["strong", "ok", "weak"].includes(ctxFx.grade), "fx grade valid, got " + ctxFx.grade);
ok(ctxFx.checks.some((c) => c.name === "strength" && c.applies), "fx: strength check applies");
ok(ctxFx.snapshot && ctxFx.snapshot.range, "fx: snapshot has range");

// non-fx: strength/correlation should NOT apply, score still 0..100
const ctxIdx = assessContext("US30", { H4: mkBars(120, 14400), H1: mkBars(240, 3600), M15: mkBars(320, 900) }, "buy", { entry: 1.10, sl: 1.095, tp: 1.115, tf: "M15" }, cfg, csFx);
ok(ctxIdx.score >= 0 && ctxIdx.score <= 100, "indices context score in 0..100, got " + ctxIdx.score);
ok(!ctxIdx.checks.find((c) => c.name === "strength")?.applies, "indices: strength check does not apply");
ok(!ctxIdx.checks.find((c) => c.name === "correlation")?.applies, "indices: correlation does not apply");

// missing frames → weak, score 0
const ctxEmpty = assessContext("EURUSD", { H1: null, M15: null }, "buy", { entry: 1, sl: 0.9, tp: 1.2 }, cfg, csFx);
ok(ctxEmpty.score === 0 && ctxEmpty.grade === "weak", "missing frames → 0/weak");

// ---- sizing math (reimplement the pure part to validate the formula) ----
// riskCash / (riskDistance × contract), clamped to step/min/max
function sizeTest(equity, riskPct, entry, sl, contract) {
  const risk = Math.abs(entry - sl);
  const riskCash = equity * (riskPct / 100);
  const lots = riskCash / (risk * contract);
  return Math.round(lots * 100) / 100;
}
// $10000 equity, 1% = $100 risk; EURUSD entry 1.10 SL 1.095 (0.005 move), contract 100000
// lots = 100 / (0.005 × 100000) = 100/500 = 0.2
ok(sizeTest(10000, 1, 1.10, 1.095, 100000) === 0.2, "risk-% sizing: 0.2 lots for $100 risk on 50-pip stop, got " + sizeTest(10000, 1, 1.10, 1.095, 100000));

console.log(failed ? `${failed} FAILED` : "executor checks pass");
process.exit(failed ? 1 : 0);
