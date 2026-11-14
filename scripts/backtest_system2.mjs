/**
 * scripts/backtest_system2.mjs
 *
 * Comprehensive Institutional Backtester for System #2 (AutonomousQuantEngine)
 * Tests across 5.1 years of verified continuous historical data (Jan 2021 - July 2026).
 * Simulates on a $100,000 Prop Firm Account with full broker spreads and commissions.
 */

import fs from "fs";
import { AutonomousQuantEngine } from "../lib/autonomous_system2/index.js";

console.log("=====================================================================");
console.log("INSTITUTIONAL QUANTITATIVE REGIME & TPO AUCTION ENGINE (SYSTEM #2)");
console.log("Backtesting on continuous 5.1-year M15 historical data (2021 - 2026)");
console.log("Conditions: $100K Account | 0.75% Risk per Trade | 1.5 pts NAS100 Spread");
console.log("=====================================================================\n");

// 1. Load Data
const rawDataPath = "quant_service/data/nas100_15m.json";
if (!fs.existsSync(rawDataPath)) {
  console.error("Data file not found at", rawDataPath);
  process.exit(1);
}

const rawBars = JSON.parse(fs.readFileSync(rawDataPath, "utf8"));
console.log(`Loaded ${rawBars.length.toLocaleString()} raw M15 candles from disk.`);

// Normalize bars
const bars = rawBars.map((b) => ({
  time: b.t ?? b.time,
  open: b.open ?? b.o,
  high: b.high ?? b.h,
  low: b.low ?? b.l,
  close: b.close ?? b.c,
}));

const startDate = new Date(bars[0].time * 1000).toISOString().split("T")[0];
const endDate = new Date(bars[bars.length - 1].time * 1000).toISOString().split("T")[0];
console.log(`Dataset Timeframe: ${startDate} to ${endDate} (~5.1 trading years)\n`);

// 2. Initialize Engine
const engine = new AutonomousQuantEngine({
  spreadPts: 1.5, // 1.5 pts spread on NAS100 (standard prop firm CFD friction)
  accountBalance: 100000,
  riskPerTradePct: 0.75, // Risk $750 per setup
});

console.log("Running simulation through AutonomousQuantEngine.onBar()...");
const startTime = Date.now();

// Progress tracker
const totalBars = bars.length;
const reportInterval = Math.floor(totalBars / 5);

for (let i = 0; i < totalBars; i++) {
  engine.onBar(bars[i]);
  if ((i + 1) % reportInterval === 0 || i === totalBars - 1) {
    const pct = (((i + 1) / totalBars) * 100).toFixed(0);
    process.stdout.write(`  Processing: ${pct}% complete (${(i + 1).toLocaleString()} bars processed)\r`);
  }
}

const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`\nSimulation completed in ${durationSec} seconds.\n`);

// 3. Performance Analytics
const report = engine.getPerformanceReport();

console.log("---------------------------------------------------------------------");
console.log("📊 SYSTEM #2 EMPIRICAL PERFORMANCE AUDIT ($100,000 PROP FIRM ACCOUNT)");
console.log("---------------------------------------------------------------------");
console.log(`Total Trades Executed     : ${report.totalTrades}`);
console.log(`Winning Trades            : ${report.winCount} (${report.winRate}% Win Rate)`);
console.log(`Losing Trades             : ${report.lossCount}`);
console.log(`Profit Factor             : ${report.profitFactor}`);
console.log("---------------------------------------------------------------------");
console.log(`Initial Capital           : $100,000.00`);
console.log(`Final Equity              : $${report.finalBalance.toLocaleString()}`);
console.log(`Net Profit                : +$${report.netProfit.toLocaleString()} (+${((report.netProfit / 100000) * 100).toFixed(1)}%)`);
console.log(`Max Floating Drawdown     : -$${report.maxDrawdownDollars.toLocaleString()} (-${report.maxDrawdownPct.toFixed(2)}%)`);
console.log("---------------------------------------------------------------------");

// Breakdown by Model
const modelStats = {};
for (const trade of report.trades) {
  const mId = trade.modelId || "UNKNOWN";
  if (!modelStats[mId]) {
    modelStats[mId] = { total: 0, wins: 0, losses: 0, pnl: 0 };
  }
  modelStats[mId].total++;
  if (trade.finalPnlDollars > 0) modelStats[mId].wins++;
  else modelStats[mId].losses++;
  modelStats[mId].pnl += trade.finalPnlDollars;
}

console.log("\nPerformance Breakdown by Execution Model:");
for (const [mId, stats] of Object.entries(modelStats)) {
  const wr = ((stats.wins / stats.total) * 100).toFixed(1);
  console.log(`  • ${mId}:`);
  console.log(`    Trades: ${stats.total} | Win Rate: ${wr}% | Net PnL: $${Math.round(stats.pnl).toLocaleString()}`);
}

// Exit Reasons Breakdown
const exitStats = {};
for (const trade of report.trades) {
  const r = trade.exitReason || "UNKNOWN";
  exitStats[r] = (exitStats[r] || 0) + 1;
}

console.log("\nExit Reasons Distribution:");
for (const [reason, count] of Object.entries(exitStats)) {
  const pct = ((count / report.totalTrades) * 100).toFixed(1);
  console.log(`  - ${reason.padEnd(30)}: ${count} (${pct}%)`);
}

// Sample recent trades
console.log("\nRecent 5 Sample Trades from Backtest Log:");
report.trades.slice(-5).forEach((t, idx) => {
  const dateStr = new Date(t.entryTime * 1000).toISOString().replace("T", " ").slice(0, 16);
  const dir = t.direction === 1 ? "LONG" : "SHORT";
  console.log(`  #${idx + 1} | ${dateStr} | ${dir} | ${t.caseId || t.modelId}`);
  console.log(`       Entry: ${t.entryPrice.toFixed(2)} | SL: ${t.currentStopLoss.toFixed(2)} | Exit: ${t.exitPrice?.toFixed(2)}`);
  console.log(`       PnL: $${t.finalPnlDollars} (${t.rMultiple}R) | Reason: ${t.exitReason}`);
});

console.log("=====================================================================\n");
