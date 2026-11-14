/**
 * scripts/backtest_system2_multi_asset.mjs
 *
 * Multi-Asset Institutional Robustness Benchmark for System #2 (AutonomousQuantEngine)
 * Evaluates the 4-Pillar Continuous Confluence Engine across 7 global asset classes:
 * - US Equities: NAS100, SPX500, DJ30
 * - European Equities: GER40 (DAX)
 * - Commodities: XAUUSD (Gold)
 * - Foreign Exchange: EURUSD, GBPUSD
 *
 * Over 150,000 continuous M15 candles (~5.5 years, 2021-2026) per asset.
 * Conditions: $100,000 Prop Firm Account | 0.75% Risk per Setup ($750) | Full realistic spreads.
 */

import fs from "fs";
import { AutonomousQuantEngine } from "../lib/autonomous_system2/index.js";

const ASSET_CONFIGS = [
  {
    symbol: "NAS100",
    name: "Nasdaq 100 Index",
    category: "US Equities",
    dataPath: "quant_service/data/nas100_15m.json",
    spreadPts: 1.5,
    minSlPoints: 30.0,
    maxSlPoints: 140.0,
  },
  {
    symbol: "SPX500",
    name: "S&P 500 Index",
    category: "US Equities",
    dataPath: "quant_service/data/spx500_15m.json",
    spreadPts: 0.5,
    minSlPoints: 5.0,
    maxSlPoints: 28.0,
  },
  {
    symbol: "GER40",
    name: "DAX 40 Index",
    category: "European Equities",
    dataPath: "quant_service/data/ger40_15m.json",
    spreadPts: 2.0,
    minSlPoints: 25.0,
    maxSlPoints: 130.0,
  },
  {
    symbol: "DJ30",
    name: "Dow Jones 30 Index",
    category: "US Equities",
    dataPath: "quant_service/data/dj30_15m.json",
    spreadPts: 3.0,
    minSlPoints: 40.0,
    maxSlPoints: 200.0,
  },
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar",
    category: "Commodities",
    dataPath: "quant_service/data/xauusd_15m.json",
    spreadPts: 0.30,
    minSlPoints: 4.0,
    maxSlPoints: 25.0,
  },
  {
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    category: "Foreign Exchange",
    dataPath: "quant_service/data/eurusd_15m.json",
    spreadPts: 0.00010,
    minSlPoints: 0.0006,
    maxSlPoints: 0.0035,
  },
  {
    symbol: "GBPUSD",
    name: "British Pound / US Dollar",
    category: "Foreign Exchange",
    dataPath: "quant_service/data/gbpusd_15m.json",
    spreadPts: 0.00015,
    minSlPoints: 0.0008,
    maxSlPoints: 0.0045,
  },
];

console.log("=========================================================================================");
console.log("SYSTEM #2: MULTI-ASSET INSTITUTIONAL ROBUSTNESS BENCHMARK (5.5 YEARS, 2021-2026)");
console.log("Simulating on $100K Prop Firm Account | 0.75% Risk per Setup | Realistic Broker Spreads");
console.log("=========================================================================================\n");

const overallResults = [];

for (const cfg of ASSET_CONFIGS) {
  if (!fs.existsSync(cfg.dataPath)) {
    console.warn(`[WARN] Skipping ${cfg.symbol}: data file not found at ${cfg.dataPath}`);
    continue;
  }

  process.stdout.write(`Benchmarking ${cfg.symbol.padEnd(8)} (${cfg.category.padEnd(17)})... `);
  const t0 = Date.now();

  const rawBars = JSON.parse(fs.readFileSync(cfg.dataPath, "utf8"));
  const bars = rawBars.map((b) => ({
    time: b.t ?? b.time,
    open: b.open ?? b.o,
    high: b.high ?? b.h,
    low: b.low ?? b.l,
    close: b.close ?? b.c,
  }));

  const engine = new AutonomousQuantEngine({
    spreadPts: cfg.spreadPts,
    accountBalance: 100000,
    riskPerTradePct: 0.75,
    minSlPoints: cfg.minSlPoints,
    maxSlPoints: cfg.maxSlPoints,
  });

  for (let i = 0; i < bars.length; i++) {
    engine.onBar(bars[i]);
  }

  const durationMs = Date.now() - t0;
  const report = engine.getPerformanceReport();

  // Model breakdown
  const modelStats = {};
  for (const t of report.trades) {
    if (!modelStats[t.modelId]) {
      modelStats[t.modelId] = { count: 0, wins: 0, pnl: 0 };
    }
    modelStats[t.modelId].count++;
    if (t.finalPnlDollars > 0) modelStats[t.modelId].wins++;
    modelStats[t.modelId].pnl += t.finalPnlDollars;
  }

  const res = {
    symbol: cfg.symbol,
    name: cfg.name,
    category: cfg.category,
    barCount: bars.length,
    spreadPts: cfg.spreadPts,
    totalTrades: report.totalTrades,
    winRate: report.winRate,
    profitFactor: report.profitFactor,
    netProfit: report.netProfit,
    finalBalance: report.finalBalance,
    maxDrawdownPct: report.maxDrawdownPct,
    maxDrawdownDollars: report.maxDrawdownDollars,
    modelStats,
    durationMs,
  };

  overallResults.push(res);
  console.log(`Done in ${(durationMs / 1000).toFixed(1)}s! Trades: ${res.totalTrades} | WR: ${res.winRate}% | PF: ${res.profitFactor} | Net: $${res.netProfit.toLocaleString()} | MaxDD: -${res.maxDrawdownPct}%`);
}

console.log("\n=========================================================================================");
console.log("MULTI-ASSET PERFORMANCE SUMMARY TABLE");
console.log("=========================================================================================");
console.log(
  "Symbol".padEnd(8) +
  "Category".padEnd(18) +
  "Trades".padStart(7) +
  "WinRate".padStart(9) +
  "PF".padStart(7) +
  "Net Profit ($)".padStart(16) +
  "Max DD (%)".padStart(12) +
  "Spread".padStart(10)
);
console.log("-".repeat(87));

let portfolioNetProfit = 0;
let portfolioTrades = 0;

for (const r of overallResults) {
  portfolioNetProfit += r.netProfit;
  portfolioTrades += r.totalTrades;
  const profitStr = (r.netProfit >= 0 ? "+$" : "-$") + Math.abs(r.netProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log(
    r.symbol.padEnd(8) +
    r.category.padEnd(18) +
    r.totalTrades.toString().padStart(7) +
    `${r.winRate.toFixed(1)}%`.padStart(9) +
    r.profitFactor.toFixed(2).padStart(7) +
    profitStr.padStart(16) +
    `-${r.maxDrawdownPct.toFixed(1)}%`.padStart(12) +
    r.spreadPts.toString().padStart(10)
  );
}
console.log("-".repeat(87));
const totalProfitStr = (portfolioNetProfit >= 0 ? "+$" : "-$") + Math.abs(portfolioNetProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(
  "TOTAL".padEnd(8) +
  "7 Global Assets".padEnd(18) +
  portfolioTrades.toString().padStart(7) +
  "".padStart(9) +
  "".padStart(7) +
  totalProfitStr.padStart(16)
);
console.log("=========================================================================================\n");

// Detailed Breakdown per Asset
for (const r of overallResults) {
  console.log(`--- [ ${r.symbol} (${r.name}) - ${r.category} ] ---`);
  console.log(`  Candles: ${r.barCount.toLocaleString()} M15 | Spread: ${r.spreadPts} pts | Net Profit: $${r.netProfit.toLocaleString()} | Max DD: -${r.maxDrawdownPct}%`);
  console.log(`  Model Breakdown:`);
  for (const [mId, s] of Object.entries(r.modelStats)) {
    const wr = s.count > 0 ? ((s.wins / s.count) * 100).toFixed(1) : "0.0";
    const pnlStr = (s.pnl >= 0 ? "+$" : "-$") + Math.abs(s.pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    console.log(`    * ${mId.padEnd(35)}: ${s.count.toString().padStart(4)} trades | WR: ${wr.padStart(5)}% | PnL: ${pnlStr}`);
  }
  console.log("");
}
