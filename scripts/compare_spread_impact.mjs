/**
 * scripts/compare_spread_impact.mjs
 *
 * Side-by-Side Spread Drag & Stop Loss Sizing Audit for System #2
 * Compares:
 * 1. Zero Spread (Gross Market Edge)
 * 2. ECN Low Spread (0.75 pts each way = 1.5 pts RT)
 * 3. Standard Retail Prop Spread (1.5 pts each way = 3.0 pts RT)
 * Analyzes Stop Loss Sizing Sanity (Spread-to-SL ratio, average SL in points, etc.)
 */

import fs from "fs";
import { AutonomousQuantEngine } from "../lib/autonomous_system2/index.js";

const rawBars = JSON.parse(fs.readFileSync("quant_service/data/nas100_15m.json", "utf8"));
const bars = rawBars.map((b) => ({
  time: b.t ?? b.time,
  open: b.open ?? b.o,
  high: b.high ?? b.h,
  low: b.low ?? b.l,
  close: b.close ?? b.c,
}));

console.log(`=====================================================================`);
console.log(`SYSTEM #2: SPREAD DRAG & STOP LOSS SIZING AUDIT`);
console.log(`Total Dataset: ${bars.length.toLocaleString()} continuous M15 bars (2021 - 2026)`);
console.log(`=====================================================================\n`);

const spreadConfigs = [
  { name: "Zero Spread (Gross Edge)", spreadPts: 0.0 },
  { name: "Low ECN Spread (1.5 pts RT)", spreadPts: 0.75 },
  { name: "Standard Prop Firm Spread (3.0 pts RT)", spreadPts: 1.5 },
];

const results = [];

for (const cfg of spreadConfigs) {
  process.stdout.write(`Running simulation: ${cfg.name}... `);
  const engine = new AutonomousQuantEngine({
    spreadPts: cfg.spreadPts,
    accountBalance: 100000,
    riskPerTradePct: 0.75,
  });

  for (let i = 0; i < bars.length; i++) {
    engine.onBar(bars[i]);
  }

  const rep = engine.getPerformanceReport();
  
  // Calculate Stop Loss statistics
  const slDistances = rep.trades.map((t) => t.stopDistancePoints);
  const avgSlPoints = slDistances.length > 0 ? slDistances.reduce((a, b) => a + b, 0) / slDistances.length : 0;
  const minSlPoints = slDistances.length > 0 ? Math.min(...slDistances) : 0;
  const maxSlPoints = slDistances.length > 0 ? Math.max(...slDistances) : 0;

  // Spread-to-SL ratio
  const avgSpreadRatio = avgSlPoints > 0 ? ((cfg.spreadPts * 2) / avgSlPoints) * 100 : 0;

  results.push({
    name: cfg.name,
    spreadPts: cfg.spreadPts,
    trades: rep.totalTrades,
    winRate: rep.winRate,
    pf: rep.profitFactor,
    netProfit: rep.netProfit,
    finalBalance: rep.finalBalance,
    maxDD: rep.maxDrawdownDollars,
    maxDDPct: rep.maxDrawdownPct,
    avgSlPoints: Math.round(avgSlPoints * 10) / 10,
    minSlPoints: Math.round(minSlPoints * 10) / 10,
    maxSlPoints: Math.round(maxSlPoints * 10) / 10,
    avgSpreadRatio: Math.round(avgSpreadRatio * 10) / 10,
  });

  console.log(`DONE. (Net: $${rep.netProfit.toLocaleString()} | PF: ${rep.profitFactor})`);
}

console.log("\n=======================================================================================================");
console.log("📊 COMPARATIVE AUDIT TABLE: FRICTION IMPACT ACROSS 5.1 YEARS (132,401 M15 BARS)");
console.log("=======================================================================================================");
console.log(
  "Spread Environment".padEnd(38) +
  "Trades".padEnd(8) +
  "WinRate".padEnd(9) +
  "PF".padEnd(7) +
  "Net Profit".padEnd(14) +
  "Max DD %".padEnd(11) +
  "Spread Drag"
);
console.log("-".repeat(103));

const grossProfit = results[0].netProfit;

results.forEach((r, idx) => {
  const spreadDragDollars = grossProfit - r.netProfit;
  const spreadDragPct = grossProfit > 0 ? ((spreadDragDollars / grossProfit) * 100).toFixed(1) + "%" : "0%";
  const dragStr = idx === 0 ? "BASELINE" : `-$${Math.round(spreadDragDollars).toLocaleString()} (-${spreadDragPct})`;
  
  console.log(
    r.name.padEnd(38) +
    r.trades.toString().padEnd(8) +
    (r.winRate.toFixed(1) + "%").padEnd(9) +
    r.pf.toFixed(2).padEnd(7) +
    ("$" + r.netProfit.toLocaleString()).padEnd(14) +
    ("-" + r.maxDDPct.toFixed(1) + "%").padEnd(11) +
    dragStr
  );
});

console.log("\n=======================================================================================================");
console.log("📐 STOP LOSS SIZING & BUFFER HEALTH ANALYSIS");
console.log("=======================================================================================================");
results.forEach((r) => {
  console.log(`• ${r.name}:`);
  console.log(`  - Average Stop Loss Distance : ${r.avgSlPoints} points on NAS100`);
  console.log(`  - Min / Max Stop Range       : ${r.minSlPoints} pts  -->  ${r.maxSlPoints} pts`);
  console.log(`  - Spread as % of Stop Loss   : ${r.avgSpreadRatio}% of total risk`);
});
console.log("=======================================================================================================\n");
