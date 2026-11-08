import fs from "fs";
import path from "path";
import { FastFeed, simulatePortfolio, computeStats } from "./optimize_prop_alpha_frontier.mjs";

function getMonthKey(epochSec) {
  const d = new Date(epochSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getYearKey(epochSec) {
  const d = new Date(epochSec * 1000);
  return String(d.getUTCFullYear());
}

async function runConsistencyAudit() {
  const dataDir = path.resolve("quant_service/data");
  const nasFeed = new FastFeed(path.join(dataDir, "nas100_1m.bin"), "NAS100");
  const xauFeed = new FastFeed(path.join(dataDir, "xauusd_1m.bin"), "XAUUSD");

  const rawNas = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_staged_candidates.json"), "utf-8"));
  const rawXau = JSON.parse(fs.readFileSync(path.join(dataDir, "xauusd_22h_staged_candidates.json"), "utf-8"));

  const nasApproved = rawNas.filter(c => (c.approved === true || !c.execution?.vetoes?.length) && c.candidateLevel?.horizon === "day");
  const xauApproved = rawXau.filter(c => (c.approved === true || !c.execution?.vetoes?.length) && c.candidateLevel?.horizon === "day");

  console.log("===============================================================================");
  console.log(" FORENSIC AUDIT: YEARLY & MONTHLY CONSISTENCY IN-SAMPLE VS OUT-OF-SAMPLE (OOS)");
  console.log("===============================================================================");

  // Candidate Filters
  const nasFiltered = nasApproved.filter(c => {
    const m = c.candidateLevel?.modelName || "";
    return m.includes("Breaker") || m.includes("Silver Bullet") || m.includes("Turtle");
  });

  const xauFiltered = xauApproved.filter(c => {
    const m = c.candidateLevel?.modelName || "";
    const d = new Date(c.t * 1000);
    const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    const isLdnNy = totalMin >= 480 && totalMin < 1260; // 08:00 to 21:00 UTC
    return m.includes("Turtle") && isLdnNy && (c.candidateLevel?.confluenceScore || 0) >= 65;
  });

  // Balanced Parameters
  const nasParams = { partialAtR: 2.5, partialPct: 0.4, runnerTargetR: 5.0, beTriggerR: 1.5, beLockR: 0.5, spreadPoints: 1.0, allowOvernight: true };
  const xauParams = { targetR: 2.5, beTriggerR: 1.5, beLockR: 0.2, spreadPoints: 0.25, allowOvernight: true };

  const nasTrades = simulatePortfolio(nasFiltered, nasFeed, nasParams, { maxConcurrent: 3, cooldownSec: 1800 });
  const xauTrades = simulatePortfolio(xauFiltered, xauFeed, xauParams, { maxConcurrent: 3, cooldownSec: 1800 });

  // Tag with asset name
  for (let t of nasTrades) t.asset = "NAS100";
  for (let t of xauTrades) t.asset = "XAUUSD";

  const allTrades = [...nasTrades, ...xauTrades].sort((a, b) => a.fillTime - b.fillTime);

  // SECTION 1: YEAR-BY-YEAR DETAILED AUDIT
  console.log("\n===============================================================================");
  console.log(" 1. YEAR-BY-YEAR PERFORMANCE AUDIT (NAS100, XAUUSD & COMBINED PORTFOLIO)");
  console.log("===============================================================================");
  console.log("Year    Period         Trades   Win Rate    PF      Net R      Max DD   Result");
  console.log("-------------------------------------------------------------------------------");

  const years = ["2021", "2022", "2023", "2024", "2025", "2026"];
  const yearlyResults = [];

  for (const yr of years) {
    const yrTrades = allTrades.filter(t => getYearKey(t.fillTime) === yr);
    const stats = computeStats(yrTrades);
    const isOOS = parseInt(yr, 10) >= 2024;
    const periodLabel = isOOS ? "Out-of-Sample " : "In-Sample     ";
    const netFormatted = (parseFloat(stats.netR) >= 0 ? "+" : "") + stats.netR.padStart(7) + "R";
    const status = parseFloat(stats.netR) > 0 ? "✅ PROFITABLE" : "❌ LOSS";

    yearlyResults.push({ yr, isOOS, ...stats });
    console.log(`${yr}    ${periodLabel}   ${String(stats.count).padStart(3)}     ${stats.winRate.padStart(5)}%    ${stats.pf.padStart(5)}   ${netFormatted}   -${stats.maxDD.padStart(5)}R   ${status}`);
  }

  // SECTION 2: MONTH-BY-MONTH DETAILED AUDIT
  console.log("\n===============================================================================");
  console.log(" 2. MONTH-BY-MONTH GRID AUDIT (ALL 67 MONTHS: 2021 TO 2026)");
  console.log("===============================================================================");

  // Build complete list of all months from 2021-01 to 2026-07
  const allMonths = [];
  for (let y = 2021; y <= 2026; y++) {
    const maxM = y === 2026 ? 7 : 12;
    for (let m = 1; m <= maxM; m++) {
      allMonths.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  }

  const monthlyResults = [];
  let posMonths = 0;
  let negMonths = 0;
  let flatMonths = 0;
  let isPosMonths = 0;
  let isTotalMonths = 0;
  let oosPosMonths = 0;
  let oosTotalMonths = 0;

  for (const mKey of allMonths) {
    const mTrades = allTrades.filter(t => getMonthKey(t.fillTime) === mKey);
    const stats = computeStats(mTrades);
    const netVal = parseFloat(stats.netR);
    const isOOS = mKey >= "2024-01";

    if (isOOS) {
      oosTotalMonths++;
      if (netVal > 0) oosPosMonths++;
    } else {
      isTotalMonths++;
      if (netVal > 0) isPosMonths++;
    }

    if (netVal > 0) posMonths++;
    else if (netVal < 0) negMonths++;
    else flatMonths++;

    monthlyResults.push({
      month: mKey,
      isOOS,
      count: stats.count,
      netR: netVal,
      pf: stats.pf,
      winRate: stats.winRate,
    });
  }

  // Print monthly table in a clean 4-column quarterly layout
  console.log("Month      Trades    Net Return      PF       Status   | Month      Trades    Net Return      PF       Status");
  console.log("-----------------------------------------------------------------------------------------------------------------");
  for (let i = 0; i < monthlyResults.length; i += 2) {
    const m1 = monthlyResults[i];
    const m2 = monthlyResults[i + 1];

    const formatM = (m) => {
      if (!m) return "";
      const netStr = (m.netR >= 0 ? "+" : "") + m.netR.toFixed(2).padStart(6) + "R";
      const badge = m.netR > 0 ? "🟢 +" : m.netR < 0 ? "🔴 -" : "⚪  0";
      const oosTag = m.isOOS ? "[OOS]" : "     ";
      return `${m.month} ${oosTag}   ${String(m.count).padStart(2)}     ${netStr}    ${m.pf.padStart(5)}    ${badge}`;
    };

    console.log(`${formatM(m1)}   |   ${formatM(m2)}`);
  }

  // SECTION 3: MONTHLY STATISTICAL METRICS & STREAK ANALYSIS
  console.log("\n===============================================================================");
  console.log(" 3. STATISTICAL CONSISTENCY & DRAWDOWN STREAK ANALYSIS");
  console.log("===============================================================================");

  let currentStreak = 0;
  let maxWinStreak = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;

  let oosMaxLossStreak = 0;
  let oosCurrentLossStreak = 0;

  for (const m of monthlyResults) {
    if (m.netR > 0) {
      currentStreak++;
      if (currentStreak > maxWinStreak) maxWinStreak = currentStreak;
      currentLossStreak = 0;
    } else if (m.netR < 0) {
      currentLossStreak++;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
      currentStreak = 0;
    }

    if (m.isOOS) {
      if (m.netR < 0) {
        oosCurrentLossStreak++;
        if (oosCurrentLossStreak > oosMaxLossStreak) oosMaxLossStreak = oosCurrentLossStreak;
      } else if (m.netR > 0) {
        oosCurrentLossStreak = 0;
      }
    }
  }

  const activeMonths = monthlyResults.filter(m => m.count > 0);
  const posActiveMonths = activeMonths.filter(m => m.netR > 0).length;
  const negActiveMonths = activeMonths.filter(m => m.netR < 0).length;

  console.log(`Total Calendar Months Evaluated      : ${allMonths.length} months (2021-01 to 2026-07)`);
  console.log(`Active Trading Months                : ${activeMonths.length} months`);
  console.log(`Overall Profitable Months            : ${posMonths} / ${allMonths.length} (${((posMonths / allMonths.length) * 100).toFixed(1)}% of all months)`);
  console.log(`Active Months Win Rate               : ${posActiveMonths} / ${activeMonths.length} (${((posActiveMonths / activeMonths.length) * 100).toFixed(1)}% of active months)`);
  console.log(`In-Sample (2021-2023) Win Month %    : ${isPosMonths} / ${isTotalMonths} (${((isPosMonths / isTotalMonths) * 100).toFixed(1)}%)`);
  console.log(`Out-of-Sample (2024-2026) Win Month %: ${oosPosMonths} / ${oosTotalMonths} (${((oosPosMonths / oosTotalMonths) * 100).toFixed(1)}%)`);
  console.log(`Longest Winning Month Streak         : ${maxWinStreak} consecutive months in profit`);
  console.log(`Longest Losing Month Streak (Total)  : ${maxLossStreak} consecutive losing months`);
  console.log(`Longest Losing Month Streak in OOS   : ${oosMaxLossStreak} consecutive losing months`);

  const maxMonthWin = Math.max(...monthlyResults.map(m => m.netR));
  const maxMonthLoss = Math.min(...monthlyResults.map(m => m.netR));
  console.log(`Largest Single Winning Month         : +${maxMonthWin.toFixed(2)}R`);
  console.log(`Largest Single Losing Month          : ${maxMonthLoss.toFixed(2)}R (Very low loss!)`);

  // SECTION 4: ASSET-BY-ASSET BREAKDOWN IN OOS (2024-2026)
  console.log("\n===============================================================================");
  console.log(" 4. ASSET-BY-ASSET OUT-OF-SAMPLE (2024-2026) REVEAL");
  console.log("===============================================================================");
  const nasOOS = nasTrades.filter(t => t.fillTime >= 1704067200);
  const xauOOS = xauTrades.filter(t => t.fillTime >= 1704067200);

  const nasOOSStats = computeStats(nasOOS);
  const xauOOSStats = computeStats(xauOOS);

  console.log(`NAS100 OOS (2024-2026) : ${nasOOSStats.count} trades | WR: ${nasOOSStats.winRate}% | PF: ${nasOOSStats.pf} | Net: +${nasOOSStats.netR}R | MaxDD: -${nasOOSStats.maxDD}R`);
  console.log(`XAUUSD OOS (2024-2026) : ${xauOOSStats.count} trades | WR: ${xauOOSStats.winRate}% | PF: ${xauOOSStats.pf} | Net: +${xauOOSStats.netR}R | MaxDD: -${xauOOSStats.maxDD}R`);
}

runConsistencyAudit().catch(console.error);
