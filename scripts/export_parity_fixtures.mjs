#!/usr/bin/env node
// Golden-fixture exporter — the acceptance gate for the Python port.
//
// Dumps the CURRENT JS behaviour of every layer the Python engine replaces,
// computed on real archive bars, to quant_service/tests/fixtures/. Python is
// then asserted against these, so "port" means "bit-comparable", not "looks right".
//
// Regenerate after any intentional JS change:  node scripts/export_parity_fixtures.mjs

import fs from "fs";
import path from "path";
import { avgRange, findPivots, detectGaps } from "../lib/patterns/core.js";
import { analyzeStructure } from "../lib/bias/structure.js";
import { liquidityMap, detectQML, sessionOf } from "../lib/bias/liquidity.js";
import { fvgZones, detectOrderBlocks } from "../lib/bias/zones.js";
import { profiles, volRatio, relParticipation } from "../lib/bias/volume.js";
import { detectTrendlineLiquidity } from "../lib/bias/buildup.js";
import { strongLevels, sweepWickCandle, vReversal, grindThenDisplacement } from "../lib/bias/reversals.js";
import { detectSetup } from "../lib/bias/playbook.js";
import { computeSymbolBias, aggregate, classifySymbol } from "../lib/bias/engine.js";
import { TELEMETRY_ANALYSIS_FX } from "../lib/algo/pairs.js";
import { loadFrames, FIXTURE_SYMBOLS, CUT_OFFSETS } from "./fixture_common.mjs";

const OUT = path.resolve("quant_service/tests/fixtures");
fs.mkdirSync(OUT, { recursive: true });

const write = (name, data) => {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 1));
  console.log(`  wrote ${name} (${(fs.statSync(p).size / 1024).toFixed(1)} KB)`);
};

// Per-layer fixtures on a single symbol/cut — deep detail, cheap to diff.
console.log("Exporting per-layer fixtures...");
const layers = [];
for (const symbol of FIXTURE_SYMBOLS) {
  for (const cut of CUT_OFFSETS) {
    const frames = loadFrames(symbol, cut);
    if (!frames) continue;
    const { M15, H1, H4, D1 } = frames;
    const aM15 = avgRange(M15), aH1 = avgRange(H1), aH4 = avgRange(H4);
    layers.push({
      symbol, cut,
      bars: { M15: M15.length, H1: H1.length, H4: H4.length, D1: D1.length },
      lastTime: { M15: M15.at(-1).time, H1: H1.at(-1).time, H4: H4.at(-1).time },
      avgRange: { M15: aM15, H1: aH1, H4: aH4 },
      session: sessionOf(M15.at(-1).time),
      pivotsM15: findPivots(M15, 3, 3),
      pivotsM15_44: findPivots(M15, 4, 4),
      gapsM15: detectGaps(M15, aM15, 4.0),
      structure: {
        M15: analyzeStructure(M15, aM15),
        H1: analyzeStructure(H1, aH1),
        H4: analyzeStructure(H4, aH4),
      },
      liquidityM15: liquidityMap(M15, aM15),
      qmlM15: detectQML(M15, aM15),
      fvgM15: fvgZones(M15, aM15),
      fvgH1: fvgZones(H1, aH1),
      obM15: detectOrderBlocks(M15, aM15),
      obH1: detectOrderBlocks(H1, aH1),
      volumeM15: profiles(M15, aM15),
      relParticipationM15: relParticipation(M15),
      buildupM15: detectTrendlineLiquidity(M15, aM15),
      strongLevelsH4: strongLevels(H4, aH4),
      reversalsM15: {
        sweepWick: sweepWickCandle(M15, aM15),
        vReversal: vReversal(M15, aM15),
        grind: grindThenDisplacement(M15, aM15),
      },
      playbookM15: detectSetup(liquidityMap(M15, aM15).sweeps, M15),
      category: classifySymbol(symbol),
    });
  }
}
write("layers.json", layers);

// Full bias output — the composite everything rolls up into.
console.log("Exporting bias fixtures...");
const bias = [];
for (const symbol of FIXTURE_SYMBOLS) {
  for (const cut of CUT_OFFSETS) {
    const frames = loadFrames(symbol, cut);
    if (!frames) continue;
    const r = computeSymbolBias(symbol, frames);
    if (r) bias.push({ symbol, cut, result: r });
  }
}
write("bias.json", bias);

// Aggregate / currency-strength across the full 28-pair universe.
console.log("Exporting aggregate fixtures...");
const aggs = [];
for (const cut of CUT_OFFSETS) {
  const results = [];
  const framesMap = {};
  for (const symbol of TELEMETRY_ANALYSIS_FX) {
    const frames = loadFrames(symbol, cut);
    if (!frames) continue;
    framesMap[symbol] = { M15: frames.M15.length, H1: frames.H1.length, H4: frames.H4.length };
    const r = computeSymbolBias(symbol, frames);
    if (r) results.push(r);
  }
  if (!results.length) continue;
  // aggregate MUTATES results in place — capture scores after the pass
  const { categories, currencyStrength } = aggregate(results);
  aggs.push({
    cut,
    nSymbols: results.length,
    currencyStrength,
    categories,
    finalScores: Object.fromEntries(results.map((r) => [r.symbol, { score: r.score, dir: r.dir, phase: r.phase }])),
  });
}
write("aggregate.json", aggs);

console.log(`\nFixtures written to ${OUT}`);
