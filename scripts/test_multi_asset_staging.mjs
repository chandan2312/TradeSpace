import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";

function resampleSeries(bars, intervalSec) {
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

async function testAsset(symbol, primaryFile, partnerSymbol, partnerFile) {
  console.log(`\n=== Testing Asset: ${symbol} with Partner: ${partnerSymbol} ===`);
  const dataDir = path.resolve("quant_service/data");
  const bars = JSON.parse(fs.readFileSync(path.join(dataDir, primaryFile), "utf-8"));
  const pBars = JSON.parse(fs.readFileSync(path.join(dataDir, partnerFile), "utf-8"));

  for (let b of bars) b.time = b.t;
  for (let b of pBars) b.time = b.t;

  const fullH1 = resampleSeries(bars, 3600);
  const fullH4 = resampleSeries(bars, 14400);
  const fullD1 = resampleSeries(bars, 86400);

  const fullM15_p = pBars;
  const fullH1_p = resampleSeries(pBars, 3600);
  const fullH4_p = resampleSeries(pBars, 14400);

  const cfg = {
    minConviction: 60,
    confluenceThreshold: 60,
    enforceSymbolSessions: false,
    sessionFilters: { london: true, newyork: true, asia: true },
    allowedTimeSlots: {
      asian_range: true,
      off_session_lull: true,
      pre_london_prep: true,
      london_open: true,
      london_lunch: true,
      pre_ny_prep: true,
      ny_open: true,
      ny_silver_bullet: true,
      london_close: true,
      ny_pm: true,
    },
    enabledHorizons: { day: true, scalp: false, swing: false },
    enabledModels: {
      ict_2022: true,
      turtle_soup: true,
      breaker_block: true,
      ote_continuation: true,
      silver_bullet: true,
      judas_swing: true,
      smt_divergence_sweep: true,
      fvg_rejection: true,
      po3_daily_cycle: true,
      displacement_breakout: false,
    },
  };

  const staged = [];
  let ptrH1 = 0, ptrH4 = 0, ptrD1 = 0;
  let ptrM15_p = 0, ptrH1_p = 0, ptrH4_p = 0;

  const t0 = performance.now();
  const startIdx = 20000;
  const endIdx = 22000;

  for (let i = startIdx; i <= endIdx && i < bars.length; i++) {
    const curBar = bars[i];
    const targetT = curBar.t;
    const barCloseT = targetT + 900;

    const m15Slice = bars.slice(Math.max(0, i - 360), i + 1);

    while (ptrH1 + 1 < fullH1.length && fullH1[ptrH1 + 1].time + 3600 <= barCloseT) ptrH1++;
    const idxH1 = (fullH1[ptrH1]?.time + 3600 <= barCloseT) ? ptrH1 : -1;
    const h1Bars = idxH1 >= 0 ? fullH1.slice(Math.max(0, idxH1 - 259), idxH1 + 1) : [];

    while (ptrH4 + 1 < fullH4.length && fullH4[ptrH4 + 1].time + 14400 <= barCloseT) ptrH4++;
    const idxH4 = (fullH4[ptrH4]?.time + 14400 <= barCloseT) ? ptrH4 : -1;
    const h4Bars = idxH4 >= 0 ? fullH4.slice(Math.max(0, idxH4 - 219), idxH4 + 1) : [];

    while (ptrD1 + 1 < fullD1.length && fullD1[ptrD1 + 1].time + 86400 <= barCloseT) ptrD1++;
    const idxD1 = (fullD1[ptrD1]?.time + 86400 <= barCloseT) ? ptrD1 : -1;
    const d1Bars = idxD1 >= 0 ? fullD1.slice(Math.max(0, idxD1 - 99), idxD1 + 1) : [];

    const frames = { M15: m15Slice, H1: h1Bars, H4: h4Bars, D1: d1Bars };

    while (ptrM15_p + 1 < fullM15_p.length && fullM15_p[ptrM15_p + 1].time + 900 <= barCloseT) ptrM15_p++;
    const idxM15_p = (fullM15_p[ptrM15_p]?.time + 900 <= barCloseT) ? ptrM15_p : -1;
    const pSlice = idxM15_p >= 0 ? fullM15_p.slice(Math.max(0, idxM15_p - 359), idxM15_p + 1) : [];

    while (ptrH1_p + 1 < fullH1_p.length && fullH1_p[ptrH1_p + 1].time + 3600 <= barCloseT) ptrH1_p++;
    const idxH1_p = (fullH1_p[ptrH1_p]?.time + 3600 <= barCloseT) ? ptrH1_p : -1;
    const pH1 = idxH1_p >= 0 ? fullH1_p.slice(Math.max(0, idxH1_p - 259), idxH1_p + 1) : [];

    while (ptrH4_p + 1 < fullH4_p.length && fullH4_p[ptrH4_p + 1].time + 14400 <= barCloseT) ptrH4_p++;
    const idxH4_p = (fullH4_p[ptrH4_p]?.time + 14400 <= barCloseT) ? ptrH4_p : -1;
    const pH4 = idxH4_p >= 0 ? fullH4_p.slice(Math.max(0, idxH4_p - 219), idxH4_p + 1) : [];

    const partnerFramesObj = { [partnerSymbol]: { M15: pSlice, H1: pH1, H4: pH4 } };
    const gathered = new Map();
    gathered.set(partnerSymbol, partnerFramesObj[partnerSymbol]);

    const extras = { now: targetT * 1000, partnerFrames: partnerFramesObj };
    const bias = computeSymbolBias(symbol, frames, extras);
    const evalResult = evaluateSymbol(symbol, frames, gathered, cfg, targetT * 1000, null, bias);

    if (evalResult.stagedLevel) {
      staged.push({
        barIdx: i,
        t: targetT,
        dir: evalResult.dir,
        model: evalResult.stagedLevel.modelId || evalResult.stagedLevel.id,
        entry: evalResult.stagedLevel.entry,
        sl: evalResult.stagedLevel.sl,
        tp: evalResult.stagedLevel.tp,
        rr: evalResult.stagedLevel.rr,
        confluenceScore: evalResult.stagedLevel.confluenceScore,
        approved: evalResult.execution?.approved === true || (!evalResult.execution?.vetoes?.length),
      });
    }
  }

  const durationSec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`Processed 2,000 bars for ${symbol} in ${durationSec}s! Found ${staged.length} candidates.`);
  const modelBreakdown = {};
  for (const s of staged) {
    modelBreakdown[s.model] = (modelBreakdown[s.model] || 0) + 1;
  }
  console.log("Model Breakdown:", modelBreakdown);
  if (staged.length > 0) {
    console.log("Sample Candidate:", staged[0]);
  }
}

async function main() {
  await testAsset("EURUSD", "eurusd_15m.json", "GBPUSD", "gbpusd_15m.json");
  await testAsset("GER40", "ger40_15m.json", "SPX500", "spx500_15m.json");
}

main().catch(console.error);
