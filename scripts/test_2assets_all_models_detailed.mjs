import fs from "fs";
import path from "path";
import { FastFeed, simulateExecution, simulatePortfolio, computeStats } from "./optimize_prop_alpha_frontier.mjs";

async function runDetailed2AssetAudit() {
  const dataDir = path.resolve("quant_service/data");
  console.log("===============================================================================");
  console.log(" 2-ASSET COMPREHENSIVE ENTRY MODEL AUDIT (NAS100 + XAUUSD: 2021-2026)");
  console.log(" Testing ALL Entry Models Individually and Combined Across 6 Full Years");
  console.log("===============================================================================\n");

  const nasFeed = new FastFeed(path.join(dataDir, "nas100_1m.bin"), "NAS100");
  const xauFeed = new FastFeed(path.join(dataDir, "xauusd_1m.bin"), "XAUUSD");

  const rawNas = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_staged_candidates.json"), "utf-8"));
  const rawXau = JSON.parse(fs.readFileSync(path.join(dataDir, "xauusd_22h_staged_candidates.json"), "utf-8"));

  const nasApproved = rawNas.filter(c => c.approved === true || !c.execution?.vetoes?.length);
  const xauApproved = rawXau.filter(c => c.approved === true || !c.execution?.vetoes?.length);

  console.log(`Total Approved Candidates: NAS100 = ${nasApproved.length} | XAUUSD = ${xauApproved.length}`);

  const nasParams = { targetR: 2.2, beTriggerR: 1.2, beLockR: 0.1, spreadPoints: 1.0, allowOvernight: true };
  const xauParams = { targetR: 2.2, beTriggerR: 1.2, beLockR: 0.1, spreadPoints: 0.25, allowOvernight: true };

  const allModels = [
    "silver_bullet",
    "ict_2022",
    "turtle_soup",
    "breaker_block",
    "ote_continuation",
    "displacement_breakout",
  ];

  // Helper to format table rows
  function printModelStats(name, stats, candidateCount) {
    const wr = Number(stats.winRate || 0).toFixed(1).padStart(5) + "%";
    const pfVal = Number(stats.pf || 0);
    const pf = (pfVal >= 99 ? "Inf" : pfVal.toFixed(2)).padStart(5);
    const netVal = Number(stats.netR || 0);
    const net = (netVal >= 0 ? "+" : "") + netVal.toFixed(2) + "R";
    const ddVal = Number(stats.maxDD || 0);
    const dd = ddVal.toFixed(2) + "R";
    const count = String(stats.count).padStart(5);
    const candStr = String(candidateCount).padStart(5);
    const avgR = (stats.count > 0 ? (netVal / stats.count).toFixed(3) : "0.000") + "R";
    console.log(`│ ${name.padEnd(23)} │ ${candStr} │ ${count} │ ${wr} │ ${pf} │ ${net.padStart(9)} │ ${dd.padStart(8)} │ ${avgR.padStart(8)} │`);
  }

  const tableHeader = () => {
    console.log("┌─────────────────────────┬───────┬───────┬────────┬───────┬───────────┬──────────┬──────────┐");
    console.log("│ Entry Model             │ Cands │ Trade │ WinRate│   PF  │  Net PnL  │  Max DD  │ Expect/Tr│");
    console.log("├─────────────────────────┼───────┼───────┼────────┼───────┼───────────┼──────────┼──────────┤");
  };
  const tableFooter = () => {
    console.log("└─────────────────────────┴───────┴───────┴────────┴───────┴───────────┴──────────┴──────────┘");
  };

  // --------------------------------------------------------------------------
  // PART 1: NAS100 MODEL-BY-MODEL BREAKDOWN
  // --------------------------------------------------------------------------
  console.log("\n===============================================================================");
  console.log(" 1. NAS100 (US TECH EQUITIES): MODEL-BY-MODEL PERFORMANCE (2021-2026)");
  console.log("===============================================================================");
  tableHeader();

  const nasModelTrades = {};
  for (const mId of allModels) {
    const cands = nasApproved.filter(c => (c.candidateLevel?.modelId || "").toLowerCase().includes(mId));
    const trades = simulatePortfolio(cands, nasFeed, nasParams, { maxConcurrent: 2, cooldownSec: 1800 });
    nasModelTrades[mId] = trades;
    const stats = computeStats(trades);
    printModelStats(mId, stats, cands.length);
  }
  tableFooter();

  // --------------------------------------------------------------------------
  // PART 2: XAUUSD MODEL-BY-MODEL BREAKDOWN
  // --------------------------------------------------------------------------
  console.log("\n===============================================================================");
  console.log(" 2. XAUUSD (SPOT GOLD): MODEL-BY-MODEL PERFORMANCE (2021-2026)");
  console.log("===============================================================================");
  tableHeader();

  const xauModelTrades = {};
  for (const mId of allModels) {
    const cands = xauApproved.filter(c => (c.candidateLevel?.modelId || "").toLowerCase().includes(mId));
    const trades = simulatePortfolio(cands, xauFeed, xauParams, { maxConcurrent: 2, cooldownSec: 1800 });
    xauModelTrades[mId] = trades;
    const stats = computeStats(trades);
    printModelStats(mId, stats, cands.length);
  }
  tableFooter();

  // --------------------------------------------------------------------------
  // PART 3: COMBINED PORTFOLIO COMPARISON (ALL MODELS VS INSTITUTIONAL CORE)
  // --------------------------------------------------------------------------
  console.log("\n===============================================================================");
  console.log(" 3. COMBINED PORTFOLIO AUDIT (NAS100 + XAUUSD TOGETHER)");
  console.log("===============================================================================");

  // Scenario A: ALL 6 Models Combined on Both Assets (Raw Everything)
  const allNasTrades = simulatePortfolio(nasApproved, nasFeed, nasParams, { maxConcurrent: 3, cooldownSec: 1800 });
  const allXauTrades = simulatePortfolio(xauApproved, xauFeed, xauParams, { maxConcurrent: 3, cooldownSec: 1800 });
  const combinedAll = [...allNasTrades, ...allXauTrades].sort((a, b) => a.fillTime - b.fillTime);
  const statsAll = computeStats(combinedAll);

  // Scenario B: Institutional Core Models (Excluding Displacement Breakout which chases)
  const coreModels = ["silver_bullet", "ict_2022", "turtle_soup", "breaker_block", "ote_continuation"];
  const coreNasCands = nasApproved.filter(c => coreModels.some(m => (c.candidateLevel?.modelId || "").toLowerCase().includes(m)));
  const coreXauCands = xauApproved.filter(c => coreModels.some(m => (c.candidateLevel?.modelId || "").toLowerCase().includes(m)));
  const coreNasTrades = simulatePortfolio(coreNasCands, nasFeed, nasParams, { maxConcurrent: 3, cooldownSec: 1800 });
  const coreXauTrades = simulatePortfolio(coreXauCands, xauFeed, xauParams, { maxConcurrent: 3, cooldownSec: 1800 });
  const combinedCore = [...coreNasTrades, ...coreXauTrades].sort((a, b) => a.fillTime - b.fillTime);
  const statsCore = computeStats(combinedCore);

  console.log("\n--- SCENARIO A: ALL MODELS ACTIVE (Including Momentum Breakout) ---");
  console.log(`• Total Trades Executed : ${statsAll.count} trades across 67 active months`);
  console.log(`• Monthly Trade Velocity: ${(statsAll.count / 67).toFixed(1)} trades/month (${(statsAll.count / (67 * 4.33)).toFixed(1)} trades/week)`);
  console.log(`• Overall Win Rate      : ${Number(statsAll.winRate || 0).toFixed(1)}%`);
  console.log(`• Profit Factor         : ${Number(statsAll.pf || 0).toFixed(2)}`);
  console.log(`• Net PnL (Alpha)       : ${Number(statsAll.netR || 0) >= 0 ? "+" : ""}${Number(statsAll.netR || 0).toFixed(2)}R`);
  console.log(`• Maximum Drawdown      : ${Number(statsAll.maxDD || 0).toFixed(2)}R`);
  console.log(`• Average Net Expectancy: ${(statsAll.count > 0 ? Number(statsAll.netR || 0) / statsAll.count : 0).toFixed(3)}R per trade`);

  console.log("\n--- SCENARIO B: INSTITUTIONAL RETRACEMENT CORE (Excluding Toxic Breakouts) ---");
  console.log(`• Total Trades Executed : ${statsCore.count} trades across 67 active months`);
  console.log(`• Monthly Trade Velocity: ${(statsCore.count / 67).toFixed(1)} trades/month (${(statsCore.count / (67 * 4.33)).toFixed(1)} trades/week)`);
  console.log(`• Overall Win Rate      : ${Number(statsCore.winRate || 0).toFixed(1)}%`);
  console.log(`• Profit Factor         : ${Number(statsCore.pf || 0).toFixed(2)}`);
  console.log(`• Net PnL (Alpha)       : ${Number(statsCore.netR || 0) >= 0 ? "+" : ""}${Number(statsCore.netR || 0).toFixed(2)}R`);
  console.log(`• Maximum Drawdown      : ${Number(statsCore.maxDD || 0).toFixed(2)}R`);
  console.log(`• Average Net Expectancy: ${(statsCore.count > 0 ? Number(statsCore.netR || 0) / statsCore.count : 0).toFixed(3)}R per trade`);

  // Year-by-Year breakdown for Scenario B
  console.log("\n===============================================================================");
  console.log(" YEAR-BY-YEAR CONSISTENCY: INSTITUTIONAL CORE (NAS100 + XAUUSD)");
  console.log("===============================================================================");
  const years = [2021, 2022, 2023, 2024, 2025, 2026];
  for (const yr of years) {
    const yrStart = new Date(`${yr}-01-01T00:00:00Z`).getTime() / 1000;
    const yrEnd = new Date(`${yr + 1}-01-01T00:00:00Z`).getTime() / 1000;
    const yrTrades = combinedCore.filter(t => t.fillTime >= yrStart && t.fillTime < yrEnd);
    const st = computeStats(yrTrades);
    const yrNet = (Number(st.netR || 0) >= 0 ? "+" : "") + Number(st.netR || 0).toFixed(2) + "R";
    const stPf = Number(st.pf || 0);
    console.log(`Year ${yr} (${st.count.toString().padStart(3)} trades) │ Win Rate: ${Number(st.winRate || 0).toFixed(1).padStart(5)}% │ PF: ${(stPf >= 99 ? "Inf" : stPf.toFixed(2)).padStart(5)} │ Net: ${yrNet.padStart(8)} │ MaxDD: ${Number(st.maxDD || 0).toFixed(2).padStart(6)}R`);
  }
  console.log("===============================================================================\n");
}

runDetailed2AssetAudit().catch(console.error);
