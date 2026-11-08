import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";

// Helper to resample closed bars
function resampleClosed(bars, intervalSec) {
  const buckets = new Map();
  for (const b of bars) {
    const bucketTime = Math.floor(b.t / intervalSec) * intervalSec;
    let buck = buckets.get(bucketTime);
    if (!buck) {
      buck = { time: bucketTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0, count: 0 };
      buckets.set(bucketTime, buck);
    } else {
      if (b.high > buck.high) buck.high = b.high;
      if (b.low < buck.low) buck.low = b.low;
      buck.close = b.close;
      buck.volume += (b.volume || 0);
    }
    buck.count++;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

async function testSingleStep() {
  const dataDir = path.resolve("quant_service/data");
  console.log("Loading M15 data...");
  const nasBars = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_15m.json"), "utf-8"));
  const djBars = JSON.parse(fs.readFileSync(path.join(dataDir, "dj30_15m.json"), "utf-8"));
  const spxBars = JSON.parse(fs.readFileSync(path.join(dataDir, "spx500_15m.json"), "utf-8"));

  console.log(`Loaded: NAS100=${nasBars.length}, DJ30=${djBars.length}, SPX500=${spxBars.length}`);

  // Test at bar 1000 (around early 2021)
  const testIdx = 1000;
  const targetT = nasBars[testIdx].t;
  console.log(`Evaluating step at timestamp: ${targetT} (${new Date(targetT * 1000).toISOString()})`);

  // Slice bars strictly <= targetT
  const m15Slice = nasBars.slice(Math.max(0, testIdx - 360), testIdx + 1).map(b => ({ ...b, time: b.t }));
  const djSlice = djBars.filter(b => b.t <= targetT).slice(-360).map(b => ({ ...b, time: b.t }));
  const spxSlice = spxBars.filter(b => b.t <= targetT).slice(-360).map(b => ({ ...b, time: b.t }));

  // Build H1, H4, D1 closed frames
  const allNasUpToT = nasBars.slice(0, testIdx + 1).map(b => ({ ...b, time: b.t }));
  const h1Bars = resampleClosed(allNasUpToT, 3600).slice(-260);
  const h4Bars = resampleClosed(allNasUpToT, 14400).slice(-220);
  const d1Bars = resampleClosed(allNasUpToT, 86400).slice(-100);

  const frames = {
    M15: m15Slice,
    H1: h1Bars,
    H4: h4Bars,
    D1: d1Bars,
  };

  const partnerFrames = {
    DJ30: { M15: djSlice, H1: resampleClosed(djSlice, 3600), H4: resampleClosed(djSlice, 14400) },
    SP500: { M15: spxSlice, H1: resampleClosed(spxSlice, 3600), H4: resampleClosed(spxSlice, 14400) },
  };

  const extras = {
    now: targetT * 1000,
    partnerFrames,
  };

  const t0 = performance.now();
  const bias = computeSymbolBias("NAS100", frames, extras);
  const elapsed = performance.now() - t0;

  console.log(`\ncomputeSymbolBias executed in ${elapsed.toFixed(2)} ms!`);
  console.log("=== RESULTS ===");
  console.log(`Symbol: ${bias.symbol}`);
  console.log(`Score: ${bias.score}`);
  console.log(`Brain Verdict: ${bias.brain?.verdict}`);
  console.log(`Action: ${bias.brain?.action}`);
  console.log(`Macro Bias: ${bias.htfLiquidity?.macroBias}`);
  console.log(`Conviction: ${bias.brain?.horizons?.DAY?.convictionScore || bias.score}`);
  console.log(`DOL Target: ${bias.brain?.targetDOL?.price || bias.htfLiquidity?.drawOnLiquidity?.price}`);
  console.log(`SMT Drives:`, bias.drives?.filter(d => d.label?.includes("SMT")));
}

testSingleStep().catch(console.error);
