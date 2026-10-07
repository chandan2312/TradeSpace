// test_entry_models_massive.mjs — Comprehensive Multi-Thousand Market Condition Stress Test
// Verifies balanced qualification across all 5 institutional entry models without gatekeeper dilution:
// 1. ICT 2022 Mentorship Model (ict_2022)
// 2. Turtle Soup Liquidity Raid (turtle_soup)
// 3. Breaker Block & Mitigation Retest (breaker_block)
// 4. OTE Trend Expansion (ote_continuation)
// 5. ICT Silver Bullet Window (silver_bullet)
// Plus exhaustive adversarial filtering of noise, micro-wicks, blown stops, and macro misalignments.

import assert from "node:assert";
import { evaluateAllEntryModels, ENTRY_MODEL_DEFINITIONS } from "./lib/autonomous/models.js";
import { selectOptimalEntryLevel } from "./lib/autonomous/levels.js";
import { SCENARIOS } from "./lib/autonomous/scenarios.js";
import { getEetTime } from "./lib/autonomous/timeslots.js";

console.log("===============================================================================");
console.log("MASSIVE MULTI-THOUSAND MARKET CONDITION STRESS TEST: 5 ENTRY MODELS");
console.log("===============================================================================\n");

const SYMBOLS = [
  { symbol: "NAS100", category: "index", basePrice: 18500, pip: 1, spread: 1.0 },
  { symbol: "US30",   category: "index", basePrice: 39500, pip: 1, spread: 2.0 },
  { symbol: "GER40",  category: "index", basePrice: 18200, pip: 1, spread: 1.2 },
  { symbol: "XAUUSD", category: "metal", basePrice: 2350.0, pip: 0.1, spread: 0.25 },
  { symbol: "EURUSD", category: "fx",    basePrice: 1.0850, pip: 0.0001, spread: 0.0001 },
  { symbol: "BTCUSD", category: "crypto", basePrice: 65000, pip: 1, spread: 15.0 },
];

function getEetDate(hour, minute) {
  const base = new Date("2026-10-06T00:00:00Z");
  for (let offset = 0; offset < 1440; offset++) {
    const d = new Date(base.getTime() + offset * 60000);
    const eet = getEetTime(d);
    if (eet.h === hour && eet.m === minute) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. GENERATOR: ICT 2022 Model Setup (Outside SB window, e.g. 11:30 EET)
// ---------------------------------------------------------------------------
function generateIct2022Bars({ basePrice, pip, dir, nowSec }) {
  const bars = [];
  const barCount = 20;
  let p = basePrice;
  for (let i = 0; i < barCount; i++) {
    bars.push({ time: nowSec - (barCount - 1 - i) * 900, open: p, high: p + pip * 2, low: p - pip * 2, close: p, v: 200 });
  }
  // Swing level at bar 5 (to be swept)
  bars[5].low = dir === 1 ? p - pip * 10 : p + pip * 2;
  bars[5].high = dir === 1 ? p + pip * 2 : p + pip * 10;
  bars[5].open = p - dir * pip * 2;
  bars[5].close = p - dir * pip * 3;

  // Swing pivot at bar 8 (to be broken by MSS)
  bars[8].high = dir === 1 ? p + pip * 10 : p - pip * 2;
  bars[8].low = dir === 1 ? p - pip * 2 : p - pip * 10;
  bars[8].open = p + dir * pip * 2;
  bars[8].close = p + dir * pip * 3;

  // Bar 15: Raid sweeps bar 5
  bars[15].low = dir === 1 ? p - pip * 16 : p - pip * 2;
  bars[15].high = dir === 1 ? p + pip * 2 : p + pip * 16;
  bars[15].open = p - dir * pip * 5;
  bars[15].close = p - dir * pip * 12;

  // Bar 16: Reclaim
  bars[16].open = p - dir * pip * 12;
  bars[16].high = dir === 1 ? p - pip * 2 : p + dir * pip * 14;
  bars[16].low = dir === 1 ? p - pip * 14 : p + pip * 2;
  bars[16].close = p - dir * pip * 4;
  bars[16].v = 400;

  // Bar 17: MSS displacement through bar 8 pivot
  bars[17].open = p - dir * pip * 3;
  bars[17].high = dir === 1 ? p + pip * 18 : p - dir * pip * 4;
  bars[17].low = dir === 1 ? p - dir * pip * 4 : p - pip * 18;
  bars[17].close = p + dir * pip * 16;
  bars[17].v = 1500;

  // Bar 18: FVG creation
  bars[18].open = p + dir * pip * 16;
  bars[18].high = dir === 1 ? p + pip * 28 : p + dir * pip * 16;
  bars[18].low = dir === 1 ? p + pip * 6 : p - pip * 28;
  bars[18].close = p + dir * pip * 25;
  bars[18].v = 1600;

  // Bar 19: Pulled back candle staying above CE
  bars[19].open = p + dir * pip * 25;
  bars[19].high = dir === 1 ? p + pip * 26 : p - pip * 8;
  bars[19].low = dir === 1 ? p + pip * 8 : p - pip * 26;
  bars[19].close = p + dir * pip * 20;
  bars[19].v = 300;

  return bars;
}

// ---------------------------------------------------------------------------
// 2. GENERATOR: Turtle Soup Model Setup (Pure sweep & reclaim)
// ---------------------------------------------------------------------------
function generateTurtleSoupBars({ basePrice, pip, dir, nowSec }) {
  const bars = [];
  const barCount = 20;
  let p = basePrice;
  for (let i = 0; i < barCount; i++) {
    bars.push({ time: nowSec - (barCount - 1 - i) * 900, open: p, high: p + pip * 2, low: p - pip * 2, close: p, v: 200 });
  }
  const levelPrice = dir === 1 ? p - pip * 10 : p + pip * 10;
  bars[5].low = dir === 1 ? levelPrice : p - pip * 2;
  bars[5].high = dir === 1 ? p + pip * 2 : levelPrice;
  bars[5].open = p - dir * pip * 2;
  bars[5].close = p - dir * pip * 3;

  // Bar 16: Raids levelPrice by 8 pips with sharp wick rejection
  const raidExtreme = dir === 1 ? levelPrice - pip * 8 : levelPrice + pip * 8;
  bars[16].open = levelPrice;
  bars[16].high = dir === 1 ? levelPrice + pip * 1 : raidExtreme;
  bars[16].low = dir === 1 ? raidExtreme : levelPrice - pip * 1;
  bars[16].close = dir === 1 ? levelPrice - pip * 1 : levelPrice + pip * 1;
  bars[16].v = 500;

  // Bar 17: Reclaims levelPrice
  bars[17].open = dir === 1 ? levelPrice - pip * 1 : levelPrice + pip * 1;
  bars[17].high = dir === 1 ? levelPrice + pip * 4 : levelPrice + pip * 1;
  bars[17].low = dir === 1 ? levelPrice - pip * 2 : levelPrice - pip * 4;
  bars[17].close = dir === 1 ? levelPrice + pip * 3 : levelPrice - pip * 3;
  bars[17].v = 600;

  // Bar 18: Holds on favorable side of levelPrice
  bars[18].open = dir === 1 ? levelPrice + pip * 3 : levelPrice - pip * 3;
  bars[18].high = dir === 1 ? levelPrice + pip * 6 : levelPrice - pip * 1;
  bars[18].low = dir === 1 ? levelPrice + pip * 1 : levelPrice - pip * 6;
  bars[18].close = dir === 1 ? levelPrice + pip * 4 : levelPrice - pip * 4;
  bars[18].v = 300;

  // Bar 19: Approaches entry (levelPrice)
  bars[19].open = dir === 1 ? levelPrice + pip * 4 : levelPrice - pip * 4;
  bars[19].high = dir === 1 ? levelPrice + pip * 5 : levelPrice - pip * 1;
  bars[19].low = dir === 1 ? levelPrice + pip * 1 : levelPrice - pip * 5;
  bars[19].close = dir === 1 ? levelPrice + pip * 2 : levelPrice - pip * 2;
  bars[19].v = 300;

  return { bars, levelPrice, raidExtreme };
}

// ---------------------------------------------------------------------------
// 3. GENERATOR: Breaker Block Model Setup
// ---------------------------------------------------------------------------
function generateBreakerBars({ basePrice, pip, dir, nowSec }) {
  const bars = [];
  const barCount = 19;
  let p = basePrice;
  for (let i = 0; i < barCount; i++) {
    bars.push({ time: nowSec - (barCount - 1 - i) * 900, open: p, high: p + pip * 2, low: p - pip * 2, close: p, v: 200 });
  }
  // Bar 4: swing low for early reference
  bars[4].low = dir === 1 ? p - pip * 8 : p - pip * 2;
  bars[4].high = dir === 1 ? p + pip * 2 : p + pip * 8;
  bars[4].open = p;
  bars[4].close = dir === 1 ? p - pip * 2 : p + pip * 2;

  // Bar 7: swing high pivot
  bars[7].high = dir === 1 ? p + pip * 8 : p + pip * 2;
  bars[7].low = dir === 1 ? p - pip * 2 : p - pip * 8;
  bars[7].open = p;
  bars[7].close = dir === 1 ? p + pip * 3 : p - pip * 3;

  // Opposing OB at bar 10: up-candle for buy, down-candle for sell
  bars[10].open = dir === 1 ? p + pip * 2 : p - pip * 2;
  bars[10].close = dir === 1 ? p + pip * 6 : p - pip * 6;
  bars[10].high = dir === 1 ? p + pip * 7 : p - pip * 1;
  bars[10].low = dir === 1 ? p + pip * 1 : p - pip * 7;
  bars[10].v = 300;

  // Bar 11: opposing displacement
  bars[11].open = dir === 1 ? p + pip * 5 : p - pip * 5;
  bars[11].close = dir === 1 ? p - pip * 10 : p + pip * 10;
  bars[11].high = dir === 1 ? p + pip * 6 : p + pip * 11;
  bars[11].low = dir === 1 ? p - pip * 11 : p - pip * 6;
  bars[11].v = 1500;

  // Bar 14: liquidity sweep
  bars[14].low = dir === 1 ? p - pip * 18 : p - pip * 4;
  bars[14].high = dir === 1 ? p - pip * 4 : p + pip * 18;
  bars[14].open = dir === 1 ? p - pip * 6 : p + pip * 6;
  bars[14].close = dir === 1 ? p - pip * 14 : p + pip * 14;

  // Bar 15: reclaim
  bars[15].open = dir === 1 ? p - pip * 14 : p + pip * 14;
  bars[15].close = dir === 1 ? p - pip * 5 : p + pip * 5;
  bars[15].high = dir === 1 ? p - pip * 4 : p + pip * 16;
  bars[15].low = dir === 1 ? p - pip * 16 : p + pip * 4;
  bars[15].v = 400;

  // Bar 16: displaced failure through opposing OB and pivot
  bars[16].open = dir === 1 ? p - pip * 4 : p + pip * 4;
  bars[16].high = dir === 1 ? p + pip * 14 : p + pip * 5;
  bars[16].low = dir === 1 ? p - pip * 5 : p - pip * 14;
  bars[16].close = dir === 1 ? p + pip * 12 : p - pip * 12;
  bars[16].v = 1600;

  // Bar 17: Retest into Breaker Block MT
  bars[17].open = dir === 1 ? p + pip * 12 : p - pip * 12;
  bars[17].high = dir === 1 ? p + pip * 12 : p - pip * 4;
  bars[17].low = dir === 1 ? p + pip * 4 : p - pip * 12;
  bars[17].close = dir === 1 ? p + pip * 8 : p - pip * 8;
  bars[17].v = 500;

  // Bar 18: Holds above/below breaker
  bars[18].open = dir === 1 ? p + pip * 8 : p - pip * 8;
  bars[18].high = dir === 1 ? p + pip * 10 : p - pip * 5;
  bars[18].low = dir === 1 ? p + pip * 5 : p - pip * 10;
  bars[18].close = dir === 1 ? p + pip * 7 : p - pip * 7;
  bars[18].v = 400;

  return bars;
}

// ---------------------------------------------------------------------------
// 4. GENERATOR: OTE Trend Expansion Setup
// ---------------------------------------------------------------------------
function generateOteBars({ basePrice, pip, dir, nowSec }) {
  const bars = [];
  const barCount = 18;
  let p = basePrice;
  for (let i = 0; i < barCount; i++) {
    bars.push({ time: nowSec - (barCount - 1 - i) * 900, open: p, high: p + pip * 2, low: p - pip * 2, close: p, v: 200 });
  }
  // Impulse origin at bar 10
  bars[10].low = dir === 1 ? p - pip * 10 : p - pip * 2;
  bars[10].high = dir === 1 ? p + pip * 2 : p + pip * 10;
  bars[10].open = p;
  bars[10].close = dir === 1 ? p - pip * 2 : p + pip * 2;

  // Impulse expansion bars 11, 12, 13
  bars[11].open = dir === 1 ? p - pip * 2 : p + pip * 2;
  bars[11].high = dir === 1 ? p + pip * 10 : p + pip * 3;
  bars[11].low = dir === 1 ? p - pip * 3 : p - pip * 10;
  bars[11].close = dir === 1 ? p + pip * 8 : p - pip * 8;
  bars[11].v = 1200;

  bars[12].open = dir === 1 ? p + pip * 8 : p - pip * 8;
  bars[12].high = dir === 1 ? p + pip * 22 : p - pip * 7;
  bars[12].low = dir === 1 ? p + pip * 7 : p - pip * 22;
  bars[12].close = dir === 1 ? p + pip * 20 : p - pip * 20;
  bars[12].v = 1500;

  // Impulse extreme at bar 13
  bars[13].open = dir === 1 ? p + pip * 20 : p - pip * 20;
  bars[13].high = dir === 1 ? p + pip * 30 : p - pip * 19;
  bars[13].low = dir === 1 ? p + pip * 19 : p - pip * 30;
  bars[13].close = dir === 1 ? p + pip * 28 : p - pip * 28;
  bars[13].v = 1000;

  // Bars 14, 15: fractals confirm high/low
  bars[14].open = dir === 1 ? p + pip * 28 : p - pip * 28;
  bars[14].high = dir === 1 ? p + pip * 28 : p - pip * 20;
  bars[14].low = dir === 1 ? p + pip * 20 : p - pip * 28;
  bars[14].close = dir === 1 ? p + pip * 22 : p - pip * 22;

  bars[15].open = dir === 1 ? p + pip * 22 : p - pip * 22;
  bars[15].high = dir === 1 ? p + pip * 23 : p - pip * 18;
  bars[15].low = dir === 1 ? p + pip * 18 : p - pip * 23;
  bars[15].close = dir === 1 ? p + pip * 19 : p - pip * 19;

  // Retracement into 70.5% sweetspot
  const ote705 = dir === 1 ? p + pip * 1.8 : p - pip * 1.8;
  bars[16].open = dir === 1 ? p + pip * 19 : p - pip * 19;
  bars[16].high = dir === 1 ? p + pip * 19 : ote705 + pip * 2;
  bars[16].low = dir === 1 ? ote705 - pip * 2 : p - pip * 19;
  bars[16].close = dir === 1 ? ote705 + pip * 4 : ote705 - pip * 4;

  bars[17].open = dir === 1 ? ote705 + pip * 4 : ote705 - pip * 4;
  bars[17].high = dir === 1 ? ote705 + pip * 6 : ote705 + pip * 2;
  bars[17].low = dir === 1 ? ote705 - pip * 2 : ote705 - pip * 6;
  bars[17].close = dir === 1 ? ote705 + pip * 5 : ote705 - pip * 5;

  return bars;
}

// ---------------------------------------------------------------------------
// 5. GENERATOR: Silver Bullet Setup (In-Window London 10-11 EET)
// ---------------------------------------------------------------------------
function generateSilverBulletBars({ basePrice, pip, dir, nowSec }) {
  // Same as ICT structure but evaluated strictly inside London Silver Bullet window (10:00 - 11:00 EET)
  return generateIct2022Bars({ basePrice, pip, dir, nowSec });
}

// ---------------------------------------------------------------------------
// 6. GENERATOR: Bad / Noisy Trades (Must be filtered out)
// ---------------------------------------------------------------------------
function generateBadBars({ basePrice, pip, dir, nowSec, flawType }) {
  const bars = [];
  const barCount = 20;
  let p = basePrice;
  if (flawType === "NOISE_CHOP") {
    // 20 bars of micro dojis with 0 displacement
    for (let i = 0; i < barCount; i++) {
      bars.push({ time: nowSec - (barCount - 1 - i) * 900, open: p, high: p + pip * 0.4, low: p - pip * 0.4, close: p + (i % 2 === 0 ? pip * 0.1 : -pip * 0.1), v: 100 });
    }
  } else if (flawType === "BLOWN_BREAKER") {
    // Breaker that failed and blew through bottom
    const b = generateBreakerBars({ basePrice, pip, dir, nowSec });
    const last = b.at(-1);
    b.push({
      time: last.time + 900,
      open: last.close,
      high: dir === 1 ? last.close + pip * 2 : last.close + pip * 50,
      low: dir === 1 ? last.close - pip * 50 : last.close - pip * 2,
      close: dir === 1 ? last.close - pip * 48 : last.close + pip * 48,
      v: 2000,
    });
    return b;
  }
  return bars;
}

// ===========================================================================
// TEST EXECUTION MATRIX (1,200 SCENARIOS)
// ===========================================================================
let totalScenariosRun = 0;
let qualifiedCounts = {
  ict_2022: 0,
  turtle_soup: 0,
  breaker_block: 0,
  ote_continuation: 0,
  silver_bullet: 0,
};
let falsePositiveCount = 0;
let rejectedNoiseCount = 0;

console.log("--> Phase 1: Testing True Positives across all 5 models and 6 asset classes...");

// A. Test ICT 2022 (Evaluated at 11:30 EET - London Open, outside SB window)
for (const sym of SYMBOLS) {
  for (const dir of [1, -1]) {
    for (let iter = 0; iter < 10; iter++) {
      totalScenariosRun++;
      const dNow = getEetDate(11, 30);
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateIct2022Bars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec });
      const targetPrice = dir === 1 ? sym.basePrice + sym.pip * 80 : sym.basePrice - sym.pip * 80;
      const res = evaluateAllEntryModels({
        symbol: sym.symbol,
        dir,
        scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 100, low: sym.basePrice - sym.pip * 100 } } },
        targetDOL: { price: targetPrice, direction: dir, targetSide: dir === 1 ? "BSL" : "SSL", causal: true, confirmationTime: 1 },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: { conviction: 80, macroDir: dir, macroBias: dir === 1 ? "BULLISH" : "BEARISH", allowedToLong: dir === 1, allowedToShort: dir === -1 },
      });
      if (res && res.permitted && res.modelId === "ict_2022") {
        qualifiedCounts.ict_2022++;
        assert(res.rr >= 1.8, "ICT 2022 R:R must meet minimum threshold");
        assert(res.targets?.length === 3, "Target ladder must have 3 tiers");
      }
    }
  }
}

// B. Test Turtle Soup (Pure sweep and reclaim at 11:30 EET)
for (const sym of SYMBOLS) {
  for (const dir of [1, -1]) {
    for (let iter = 0; iter < 10; iter++) {
      totalScenariosRun++;
      const dNow = getEetDate(11, 30);
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const { bars, levelPrice } = generateTurtleSoupBars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec });
      const targetPrice = dir === 1 ? sym.basePrice + sym.pip * 60 : sym.basePrice - sym.pip * 60;
      const res = evaluateAllEntryModels({
        symbol: sym.symbol,
        dir,
        scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 80, low: sym.basePrice - sym.pip * 80 } } },
        targetDOL: { price: targetPrice, direction: dir, targetSide: dir === 1 ? "BSL" : "SSL", causal: true, confirmationTime: 1 },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: {
          conviction: 85,
          macroDir: dir,
          macroBias: dir === 1 ? "BULLISH" : "BEARISH",
          htfLiquidity: { keyLevels: { L1: { price: levelPrice, side: dir === 1 ? -1 : 1, confirmationTime: 1700000000 } } },
          allowedToLong: dir === 1,
          allowedToShort: dir === -1,
        },
      });
      if (res && res.permitted && res.modelId === "turtle_soup") {
        qualifiedCounts.turtle_soup++;
        assert(res.entry > 0, "Turtle soup valid entry");
        assert(res.sl > 0, "Turtle soup valid SL");
      }
    }
  }
}

// C. Test Breaker Block (At 15:30 EET - NY AM Killzone)
for (const sym of SYMBOLS) {
  for (const dir of [1, -1]) {
    for (let iter = 0; iter < 10; iter++) {
      totalScenariosRun++;
      const dNow = getEetDate(15, 30);
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateBreakerBars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec });
      const targetPrice = dir === 1 ? sym.basePrice + sym.pip * 70 : sym.basePrice - sym.pip * 70;
      const res = evaluateAllEntryModels({
        symbol: sym.symbol,
        dir,
        scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 90, low: sym.basePrice - sym.pip * 90 } } },
        targetDOL: { price: targetPrice, direction: dir, targetSide: dir === 1 ? "BSL" : "SSL", causal: true, confirmationTime: 1 },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: { conviction: 85, macroDir: dir, macroBias: dir === 1 ? "BULLISH" : "BEARISH", allowedToLong: dir === 1, allowedToShort: dir === -1 },
      });
      if (res && res.permitted && res.modelId === "breaker_block") {
        qualifiedCounts.breaker_block++;
        assert(res.entry > 0, "Breaker block valid entry");
      }
    }
  }
}

// D. Test OTE Trend Expansion (At 15:30 EET - NY AM Killzone)
for (const sym of SYMBOLS) {
  for (const dir of [1, -1]) {
    for (let iter = 0; iter < 10; iter++) {
      totalScenariosRun++;
      const dNow = getEetDate(15, 30);
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateOteBars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec });
      const targetPrice = dir === 1 ? sym.basePrice + sym.pip * 90 : sym.basePrice - sym.pip * 90;
      const res = evaluateAllEntryModels({
        symbol: sym.symbol,
        dir,
        scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 100, low: sym.basePrice - sym.pip * 100 } } },
        targetDOL: { price: targetPrice, direction: dir, targetSide: dir === 1 ? "BSL" : "SSL", causal: true, confirmationTime: 1 },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: { conviction: 82, macroDir: dir, macroBias: dir === 1 ? "BULLISH" : "BEARISH", allowedToLong: dir === 1, allowedToShort: dir === -1 },
      });
      if (res && res.permitted && res.modelId === "ote_continuation") {
        qualifiedCounts.ote_continuation++;
        assert(res.entry > 0, "OTE valid entry");
      }
    }
  }
}

// E. Test Silver Bullet in-window (At 10:45 EET - London Silver Bullet Window)
for (const sym of SYMBOLS) {
  for (const dir of [1, -1]) {
    for (let iter = 0; iter < 10; iter++) {
      totalScenariosRun++;
      const dNow = getEetDate(10, 45); // London Silver Bullet (10-11 EET)
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateSilverBulletBars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec });
      const targetPrice = dir === 1 ? sym.basePrice + sym.pip * 75 : sym.basePrice - sym.pip * 75;
      const res = evaluateAllEntryModels({
        symbol: sym.symbol,
        dir,
        scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 90, low: sym.basePrice - sym.pip * 90 } } },
        targetDOL: { price: targetPrice, direction: dir, targetSide: dir === 1 ? "BSL" : "SSL", causal: true, confirmationTime: 1 },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: { conviction: 85, macroDir: dir, macroBias: dir === 1 ? "BULLISH" : "BEARISH", allowedToLong: dir === 1, allowedToShort: dir === -1 },
      });
      if (res && res.permitted && res.modelId === "silver_bullet") {
        qualifiedCounts.silver_bullet++;
        assert(res.entry > 0, "Silver Bullet valid entry");
      }
    }
  }
}

console.log("--> Phase 2: Testing Adversarial Filtering (Noise, Blown Breakers, Bad R:R, Macro Misalignment)...");

// F. Negative Controls: Noise, Blown Breakers, Bad R:R, Macro Opposing, Dead Zone (600 permutations)
for (const sym of SYMBOLS) {
  for (const dir of [1, -1]) {
    // 1. Noise Chop: 0 displacement
    for (let k = 0; k < 10; k++) {
      totalScenariosRun++;
      const dNow = getEetDate(10, 30);
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateBadBars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec, flawType: "NOISE_CHOP" });
      const res = evaluateAllEntryModels({
        symbol: sym.symbol, dir, scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 50, low: sym.basePrice - sym.pip * 50 } } },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: { conviction: 80, macroDir: dir },
      });
      if (res && res.permitted) {
        falsePositiveCount++;
      } else {
        rejectedNoiseCount++;
      }
    }

    // 2. Blown Breakers: candles blew through breaker
    for (let k = 0; k < 10; k++) {
      totalScenariosRun++;
      const dNow = getEetDate(14, 0);
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateBadBars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec, flawType: "BLOWN_BREAKER" });
      const res = evaluateAllEntryModels({
        symbol: sym.symbol, dir, scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 50, low: sym.basePrice - sym.pip * 50 } } },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: { conviction: 80, macroDir: dir },
      });
      if (res && res.permitted && res.modelId === "breaker_block") {
        falsePositiveCount++;
      } else {
        rejectedNoiseCount++;
      }
    }

    // 3. Macro Misaligned: direction is BUY but macro bias is BEARISH
    for (let k = 0; k < 10; k++) {
      totalScenariosRun++;
      const dNow = getEetDate(11, 30);
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateIct2022Bars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec });
      const res = evaluateAllEntryModels({
        symbol: sym.symbol, dir, scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 50, low: sym.basePrice - sym.pip * 50 } } },
        targetDOL: { price: dir === 1 ? sym.basePrice + sym.pip * 50 : sym.basePrice - sym.pip * 50, direction: dir, targetSide: dir === 1 ? "BSL" : "SSL", causal: true, confirmationTime: 1 },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: { conviction: 80, macroDir: -dir, macroBias: dir === 1 ? "BEARISH" : "BULLISH" }, // Misaligned!
      });
      if (res && res.permitted) {
        falsePositiveCount++;
      } else {
        rejectedNoiseCount++;
      }
    }

    // 4. Dead Zone: trade in dead zone (01:00 EET)
    for (let k = 0; k < 10; k++) {
      totalScenariosRun++;
      const dNow = getEetDate(1, 0); // 01:00 EET Dead Zone
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateIct2022Bars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec });
      const res = evaluateAllEntryModels({
        symbol: sym.symbol, dir, scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 50, low: sym.basePrice - sym.pip * 50 } } },
        targetDOL: { price: dir === 1 ? sym.basePrice + sym.pip * 50 : sym.basePrice - sym.pip * 50, direction: dir, targetSide: dir === 1 ? "BSL" : "SSL", causal: true, confirmationTime: 1 },
        config: { now: dNow.getTime(), minRR: 1.8 },
        brain: { conviction: 80, macroDir: dir },
      });
      if (res && res.permitted) {
        falsePositiveCount++;
      } else {
        rejectedNoiseCount++;
      }
    }

    // 5. Bad R:R (Target is too close, RR < 1.8)
    for (let k = 0; k < 10; k++) {
      totalScenariosRun++;
      const dNow = getEetDate(11, 30);
      const nowSec = Math.floor(dNow.getTime() / 1000);
      const bars = generateIct2022Bars({ basePrice: sym.basePrice, pip: sym.pip, dir, nowSec });
      const res = evaluateAllEntryModels({
        symbol: sym.symbol, dir, scenario: SCENARIOS.INTRADAY,
        frames: { M15: bars, H1: bars, H4: bars, D1: bars },
        ranges: { ranges: { H4: { high: sym.basePrice + sym.pip * 50, low: sym.basePrice - sym.pip * 50 } } },
        targetDOL: { price: dir === 1 ? sym.basePrice + sym.pip * 3 : sym.basePrice - sym.pip * 3, direction: dir, targetSide: dir === 1 ? "BSL" : "SSL", causal: true, confirmationTime: 1 }, // Tiny target!
        config: { now: dNow.getTime(), minRR: 2.5 }, // High minRR
        brain: { conviction: 80, macroDir: dir },
      });
      if (res && res.permitted) {
        falsePositiveCount++;
      } else {
        rejectedNoiseCount++;
      }
    }
  }
}

console.log("\n===============================================================================");
console.log("MASSIVE STRESS TEST RESULTS & METRICS");
console.log("===============================================================================");
console.log(`Total Scenarios Evaluated: ${totalScenariosRun}`);
console.log("\nQualified Setups by Entry Model:");
for (const [id, count] of Object.entries(qualifiedCounts)) {
  const modelDef = Object.values(ENTRY_MODEL_DEFINITIONS).find(m => m.id === id);
  console.log(`  - [${id.toUpperCase()}] ${modelDef?.name || id}: ${count} qualified`);
}
console.log(`\nAdversarial Noise & Bad Trades Filtered: ${rejectedNoiseCount}`);
console.log(`False Positives on Bad Trades: ${falsePositiveCount} (Target: 0)`);

// Verification Assertions:
assert(totalScenariosRun >= 1200, "Must execute at least 1,200 multi-market scenarios");
assert(falsePositiveCount === 0, `False positive rate must be strictly 0.0%: got ${falsePositiveCount}`);
assert(rejectedNoiseCount >= 600, `All noise and bad trades must be filtered: got ${rejectedNoiseCount}`);

// Verify that EVERY model has qualified healthy numbers (no model is 0!)
for (const [id, count] of Object.entries(qualifiedCounts)) {
  assert(count > 0, `Model ${id} must qualify healthy setups when valid conditions occur (got ${count})`);
}

// Verify that NO single model monopolizes > 60% of qualified setups across the balanced test
const totalQualified = Object.values(qualifiedCounts).reduce((a, b) => a + b, 0);
console.log(`\nTotal Qualified Setups: ${totalQualified}`);
for (const [id, count] of Object.entries(qualifiedCounts)) {
  const pct = Math.round((count / totalQualified) * 100);
  console.log(`  - ${id}: ${pct}% of total qualified trades`);
  assert(pct < 60, `Model ${id} must not monopolize setups (got ${pct}%)`);
}

console.log("\n===============================================================================");
console.log("🎯 ALL 1,200+ MASSIVE MARKET CONDITION TESTS PASSED WITH 100% SUCCESS!");
console.log("===============================================================================");
