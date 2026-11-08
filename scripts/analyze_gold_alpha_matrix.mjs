import fs from "fs";
import path from "path";
import { OneMinuteFeed, simulateTradeExecution, computeMetrics, simulateConcurrent } from "./run_xauusd_22h_backtest.mjs";

function getSession(t) {
  const d = new Date(t * 1000);
  const hour = d.getUTCHours();
  const min = d.getUTCMinutes();
  const total = hour * 60 + min;
  if (total >= 1260 && total < 1380) return "ROLLOVER";
  if (total >= 1380 || total < 480) return "ASIA";
  if (total >= 480 && total < 810) return "LONDON";
  return "NEW_YORK";
}

async function main() {
  const dataDir = path.resolve("quant_service/data");
  const candidatesPath = path.join(dataDir, "xauusd_22h_staged_candidates.json");
  const bin1MPath = path.join(dataDir, "xauusd_1m.bin");

  const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf-8"));
  const feed1M = new OneMinuteFeed(bin1MPath);

  const dayApproved = candidates.filter(c => (c.approved === true || !c.execution?.vetoes?.length) && c.candidateLevel?.horizon === "day");
  dayApproved.sort((a, b) => a.t - b.t);

  console.log("===============================================================================");
  console.log(" QUANT RESEARCH AUDIT: UNPACKING GOLD ALPHA ACROSS MODELS & SESSIONS");
  console.log("===============================================================================");

  // 1. Turtle Soup Only - All Sessions vs London/NY Only
  const tsAll = dayApproved.filter(c => (c.candidateLevel?.modelName || "").includes("Turtle"));
  const tsLdnNy = tsAll.filter(c => ["LONDON", "NEW_YORK"].includes(getSession(c.t)));
  const tsAsia = tsAll.filter(c => getSession(c.t) === "ASIA");

  console.log(`\n--- TURTLE SOUP DEEP DIVE ---`);
  console.log(`Total Turtle Soup Candidates: ${tsAll.length} (Asia: ${tsAsia.length}, London/NY: ${tsLdnNy.length})`);

  const tsAllTrades = simulateConcurrent(tsAll, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`Turtle Soup (22H Continuous - Mode A):`, computeMetrics(tsAllTrades.map(t => t.defaultLegR)));
  console.log(`Turtle Soup (22H Continuous - Prop 2R):`, computeMetrics(tsAllTrades.map(t => t.propLegR)));

  const tsLdnNyTrades = simulateConcurrent(tsLdnNy, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`Turtle Soup (London + NY Only - Mode A):`, computeMetrics(tsLdnNyTrades.map(t => t.defaultLegR)));
  console.log(`Turtle Soup (London + NY Only - Prop 2R):`, computeMetrics(tsLdnNyTrades.map(t => t.propLegR)));

  const tsAsiaTrades = simulateConcurrent(tsAsia, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`Turtle Soup (Asia Only - Mode A):`, computeMetrics(tsAsiaTrades.map(t => t.defaultLegR)));
  console.log(`Turtle Soup (Asia Only - Prop 2R):`, computeMetrics(tsAsiaTrades.map(t => t.propLegR)));

  // 2. What about London + New York across ALL models?
  console.log(`\n--- LONDON + NEW YORK ONLY (EXCLUDING ASIA) ACROSS ALL MODELS ---`);
  const ldnNyAll = dayApproved.filter(c => ["LONDON", "NEW_YORK"].includes(getSession(c.t)));
  const ldnNyTradesA = simulateConcurrent(ldnNyAll, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`London + NY (All Models - Mode A):`, computeMetrics(ldnNyTradesA.map(t => t.defaultLegR)));
  console.log(`London + NY (All Models - Prop 2R):`, computeMetrics(ldnNyTradesA.map(t => t.propLegR)));

  // 3. What if we EXCLUDE Displacement Breakout entirely? (Just like NAS100)
  console.log(`\n--- EXCLUDING DISPLACEMENT BREAKOUT (SMARTER MODEL SELECTIVITY) ---`);
  const noDisp = dayApproved.filter(c => !(c.candidateLevel?.modelName || "").includes("Displacement"));
  const noDispTradesA = simulateConcurrent(noDisp, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`22H Continuous (Without Displacement Breakout):`, computeMetrics(noDispTradesA.map(t => t.defaultLegR)));
  console.log(`22H Continuous (Without Displacement - Prop 2R):`, computeMetrics(noDispTradesA.map(t => t.propLegR)));

  const noDispLdnNy = noDisp.filter(c => ["LONDON", "NEW_YORK"].includes(getSession(c.t)));
  const noDispLdnNyTrades = simulateConcurrent(noDispLdnNy, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`London + NY (Without Displacement Breakout):`, computeMetrics(noDispLdnNyTrades.map(t => t.defaultLegR)));
  console.log(`London + NY (Without Displacement - Prop 2R):`, computeMetrics(noDispLdnNyTrades.map(t => t.propLegR)));

  // 4. Confluence Score Filtering (e.g. Confluence >= 70 or 75)
  console.log(`\n--- HIGH CONFLUENCE FILTERING (Confluence >= 70) ---`);
  const highConf = dayApproved.filter(c => (c.candidateLevel?.confluenceScore || 0) >= 70);
  const highConfTrades = simulateConcurrent(highConf, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`22H High Confluence (>= 70):`, computeMetrics(highConfTrades.map(t => t.defaultLegR)));

  const highConfLdnNy = highConf.filter(c => ["LONDON", "NEW_YORK"].includes(getSession(c.t)));
  const highConfLdnNyTrades = simulateConcurrent(highConfLdnNy, feed1M, { maxConcurrent: 5, cooldownSec: 1800, allowOvernight: true });
  console.log(`London + NY High Confluence (>= 70):`, computeMetrics(highConfLdnNyTrades.map(t => t.defaultLegR)));

  // 5. Year-by-year for Turtle Soup (22H)
  console.log(`\n--- TURTLE SOUP YEAR-BY-YEAR (22H Continuous) ---`);
  const years = ["2021", "2022", "2023", "2024", "2025", "2026"];
  for (const yr of years) {
    const yrTrades = tsAllTrades.filter(t => (t.candidate?.isoTime || "").startsWith(yr));
    const met = computeMetrics(yrTrades.map(t => t.defaultLegR));
    console.log(`  • ${yr}: ${String(met.count).padStart(3)} trades | WR: ${met.winRate.padStart(5)}% | PF: ${met.pf.padStart(5)} | Net: ${met.netR >= 0 ? "+" : ""}${met.netR.padStart(7)}R | MaxDD: -${met.maxDD}R`);
  }
}

main().catch(console.error);
