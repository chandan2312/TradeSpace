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

async function profile() {
  const dataDir = path.resolve("quant_service/data");
  const bars = JSON.parse(fs.readFileSync(path.join(dataDir, "eurusd_15m.json"), "utf-8"));
  const pBars = JSON.parse(fs.readFileSync(path.join(dataDir, "gbpusd_15m.json"), "utf-8"));

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
      london_open: true,
      london_lunch: true,
      pre_ny_prep: true,
      ny_open: true,
      ny_silver_bullet: true,
      london_close: true,
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

  let ptrH1 = 0, ptrH4 = 0, ptrD1 = 0;
  let ptrM15_p = 0, ptrH1_p = 0, ptrH4_p = 0;

  let biasTotal = 0;
  let evalTotal = 0;
  let sliceTotal = 0;

  const N = 100;
  const startIdx = 20000;

  for (let i = startIdx; i < startIdx + N; i++) {
    const curBar = bars[i];
    const targetT = curBar.t;
    const barCloseT = targetT + 900;

    const tSlice0 = performance.now();
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

    const partnerFramesObj = { GBPUSD: { M15: pSlice, H1: pH1, H4: pH4 } };
    const gathered = new Map();
    gathered.set("GBPUSD", partnerFramesObj.GBPUSD);
    sliceTotal += (performance.now() - tSlice0);

    const tBias0 = performance.now();
    const extras = { now: targetT * 1000, partnerFrames: partnerFramesObj };
    const bias = computeSymbolBias("EURUSD", frames, extras);
    biasTotal += (performance.now() - tBias0);

    const tEval0 = performance.now();
    const evalResult = evaluateSymbol("EURUSD", frames, gathered, cfg, targetT * 1000, null, bias);
    evalTotal += (performance.now() - tEval0);
  }

  console.log(`Profile over ${N} bars:`);
  console.log(`- Slicing: ${(sliceTotal / N).toFixed(2)} ms/bar`);
  console.log(`- Bias Engine: ${(biasTotal / N).toFixed(2)} ms/bar`);
  console.log(`- Scanner & Models: ${(evalTotal / N).toFixed(2)} ms/bar`);
  console.log(`- Total per bar: ${((sliceTotal + biasTotal + evalTotal) / N).toFixed(2)} ms/bar`);
}

profile().catch(console.error);
