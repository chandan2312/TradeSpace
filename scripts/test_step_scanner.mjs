import fs from "fs";
import path from "path";
import { computeSymbolBias } from "../lib/bias/engine.js";
import { evaluateSymbol } from "../lib/autonomous/scanner.js";

function resampleClosed(bars, intervalSec) {
  const buckets = new Map();
  for (const b of bars) {
    const bucketTime = Math.floor(b.t / intervalSec) * intervalSec;
    let buck = buckets.get(bucketTime);
    if (!buck) {
      buck = { time: bucketTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 };
      buckets.set(bucketTime, buck);
    } else {
      if (b.high > buck.high) buck.high = b.high;
      if (b.low < buck.low) buck.low = b.low;
      buck.close = b.close;
      buck.volume += (b.volume || 0);
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

async function testScannerStep() {
  const dataDir = path.resolve("quant_service/data");
  const nasBars = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_15m.json"), "utf-8"));
  const djBars = JSON.parse(fs.readFileSync(path.join(dataDir, "dj30_15m.json"), "utf-8"));
  const spxBars = JSON.parse(fs.readFileSync(path.join(dataDir, "spx500_15m.json"), "utf-8"));

  const testIdx = 1200;
  const targetT = nasBars[testIdx].t;
  console.log(`Evaluating step at timestamp: ${targetT} (${new Date(targetT * 1000).toISOString()})`);

  const m15Slice = nasBars.slice(Math.max(0, testIdx - 360), testIdx + 1).map(b => ({ ...b, time: b.t }));
  const djSlice = djBars.filter(b => b.t <= targetT).slice(-360).map(b => ({ ...b, time: b.t }));
  const spxSlice = spxBars.filter(b => b.t <= targetT).slice(-360).map(b => ({ ...b, time: b.t }));

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

  const partnerDJ = { M15: djSlice, H1: resampleClosed(djSlice, 3600), H4: resampleClosed(djSlice, 14400) };
  const partnerSPX = { M15: spxSlice, H1: resampleClosed(spxSlice, 3600), H4: resampleClosed(spxSlice, 14400) };

  const partnerFrames = { DJ30: partnerDJ, SP500: partnerSPX };
  const gathered = new Map();
  gathered.set("DJ30", partnerDJ);
  gathered.set("SP500", partnerSPX);

  const extras = {
    now: targetT * 1000,
    partnerFrames,
  };

  const bias = computeSymbolBias("NAS100", frames, extras);
  console.log(`Bias: ${bias.score} | Brain: ${bias.brain?.verdict} | Action: ${bias.brain?.action}`);

  const cfg = {
    minConviction: 60,
    confluenceThreshold: 60,
    enabledHorizons: { day: true, scalp: true, swing: true },
    models: {
      ict_2022: true,
      turtle_soup: true,
      breaker_block: true,
      ote_continuation: true,
      silver_bullet: true,
    },
  };

  const evalResult = evaluateSymbol("NAS100", frames, gathered, cfg, targetT * 1000, null, bias);
  console.log("Scanner Evaluation Result:", {
    symbol: evalResult.symbol,
    tier: evalResult.tier,
    direction: evalResult.dir,
    decisionReason: evalResult.decisionReason,
    hasCandidateLevel: Boolean(evalResult.candidateLevel),
    primeCount: evalResult.primeSetups?.length || 0,
  });

  if (evalResult.candidateLevel) {
    console.log("Candidate Level Details:", evalResult.candidateLevel);
  }
}

testScannerStep().catch(console.error);
