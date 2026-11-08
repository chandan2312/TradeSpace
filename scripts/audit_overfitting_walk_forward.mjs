import fs from "fs";
import path from "path";
import { FastFeed, simulatePortfolio, computeStats } from "./optimize_prop_alpha_frontier.mjs";

async function runOverfittingAudit() {
  const dataDir = path.resolve("quant_service/data");
  const nasFeed = new FastFeed(path.join(dataDir, "nas100_1m.bin"), "NAS100");
  const xauFeed = new FastFeed(path.join(dataDir, "xauusd_1m.bin"), "XAUUSD");

  const rawNas = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_staged_candidates.json"), "utf-8"));
  const rawXau = JSON.parse(fs.readFileSync(path.join(dataDir, "xauusd_22h_staged_candidates.json"), "utf-8"));

  const nasApproved = rawNas.filter(c => (c.approved === true || !c.execution?.vetoes?.length) && c.candidateLevel?.horizon === "day");
  const xauApproved = rawXau.filter(c => (c.approved === true || !c.execution?.vetoes?.length) && c.candidateLevel?.horizon === "day");

  console.log("===============================================================================");
  console.log(" OVERFITTING & OUT-OF-SAMPLE (OOS) WALK-FORWARD VALIDATION AUDIT");
  console.log("===============================================================================");

  // Define In-Sample (2021-01-01 to 2023-12-31) and Out-Of-Sample (2024-01-01 to 2026-07-29)
  const oosEpoch = 1704067200; // 2024-01-01 00:00:00 UTC

  // Filter NAS candidates
  const nasFiltered = nasApproved.filter(c => {
    const m = c.candidateLevel?.modelName || "";
    return m.includes("Breaker") || m.includes("Silver Bullet") || m.includes("Turtle");
  });

  const nasInSample = nasFiltered.filter(c => c.t < oosEpoch);
  const nasOutOfSample = nasFiltered.filter(c => c.t >= oosEpoch);

  // Filter Gold candidates (Turtle Soup London + NY)
  const xauFiltered = xauApproved.filter(c => {
    const m = c.candidateLevel?.modelName || "";
    const d = new Date(c.t * 1000);
    const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    const isLdnNy = totalMin >= 480 && totalMin < 1260; // 08:00 to 21:00 UTC
    return m.includes("Turtle") && isLdnNy && (c.candidateLevel?.confluenceScore || 0) >= 65;
  });

  const xauInSample = xauFiltered.filter(c => c.t < oosEpoch);
  const xauOutOfSample = xauFiltered.filter(c => c.t >= oosEpoch);

  // Parameters
  const nasParams = { partialAtR: 2.5, partialPct: 0.4, runnerTargetR: 5.0, beTriggerR: 1.5, beLockR: 0.5, spreadPoints: 1.0, allowOvernight: true };
  const xauParams = { targetR: 2.5, beTriggerR: 1.5, beLockR: 0.2, spreadPoints: 0.25, allowOvernight: true };

  // 1. NAS100 IN-SAMPLE VS OUT-OF-SAMPLE
  console.log("\n--- NAS100 WALK-FORWARD AUDIT ---");
  const nasTradesIS = simulatePortfolio(nasInSample, nasFeed, nasParams, { maxConcurrent: 3, cooldownSec: 1800 });
  const nasTradesOOS = simulatePortfolio(nasOutOfSample, nasFeed, nasParams, { maxConcurrent: 3, cooldownSec: 1800 });

  const statsNasIS = computeStats(nasTradesIS);
  const statsNasOOS = computeStats(nasTradesOOS);

  console.log(`In-Sample (2021-2023)    : ${statsNasIS.count} trades | WR: ${statsNasIS.winRate}% | PF: ${statsNasIS.pf} | Net: +${statsNasIS.netR}R | MaxDD: -${statsNasIS.maxDD}R`);
  console.log(`Out-of-Sample (2024-2026): ${statsNasOOS.count} trades | WR: ${statsNasOOS.winRate}% | PF: ${statsNasOOS.pf} | Net: +${statsNasOOS.netR}R | MaxDD: -${statsNasOOS.maxDD}R`);

  // 2. GOLD IN-SAMPLE VS OUT-OF-SAMPLE
  console.log("\n--- XAUUSD (GOLD) WALK-FORWARD AUDIT ---");
  const xauTradesIS = simulatePortfolio(xauInSample, xauFeed, xauParams, { maxConcurrent: 3, cooldownSec: 1800 });
  const xauTradesOOS = simulatePortfolio(xauOutOfSample, xauFeed, xauParams, { maxConcurrent: 3, cooldownSec: 1800 });

  const statsXauIS = computeStats(xauTradesIS);
  const statsXauOOS = computeStats(xauTradesOOS);

  console.log(`In-Sample (2021-2023)    : ${statsXauIS.count} trades | WR: ${statsXauIS.winRate}% | PF: ${statsXauIS.pf} | Net: +${statsXauIS.netR}R | MaxDD: -${statsXauIS.maxDD}R`);
  console.log(`Out-of-Sample (2024-2026): ${statsXauOOS.count} trades | WR: ${statsXauOOS.winRate}% | PF: ${statsXauOOS.pf} | Net: +${statsXauOOS.netR}R | MaxDD: -${statsXauOOS.maxDD}R`);

  // 3. COMBINED PORTFOLIO IN-SAMPLE VS OUT-OF-SAMPLE
  console.log("\n--- COMBINED PORTFOLIO WALK-FORWARD AUDIT ---");
  const portIS = [...nasTradesIS, ...xauTradesIS].sort((a, b) => a.fillTime - b.fillTime);
  const portOOS = [...nasTradesOOS, ...xauTradesOOS].sort((a, b) => a.fillTime - b.fillTime);

  const statsPortIS = computeStats(portIS);
  const statsPortOOS = computeStats(portOOS);

  console.log(`Portfolio In-Sample (2021-2023)    : ${statsPortIS.count} trades | WR: ${statsPortIS.winRate}% | PF: ${statsPortIS.pf} | Net: +${statsPortIS.netR}R | MaxDD: -${statsPortIS.maxDD}R`);
  console.log(`Portfolio Out-of-Sample (2024-2026): ${statsPortOOS.count} trades | WR: ${statsPortOOS.winRate}% | PF: ${statsPortOOS.pf} | Net: +${statsPortOOS.netR}R | MaxDD: -${statsPortOOS.maxDD}R`);

  // 4. SENSITIVITY TESTING (Target R and BE Trigger perturbation)
  console.log("\n--- PARAMETER PERTURBATION TEST (Checking for Fragile Peaks) ---");
  const perturbations = [
    { targetR: 2.0, beTriggerR: 1.2 },
    { targetR: 2.2, beTriggerR: 1.3 },
    { targetR: 2.5, beTriggerR: 1.5 },
    { targetR: 2.8, beTriggerR: 1.6 },
    { targetR: 3.0, beTriggerR: 1.8 },
  ];

  console.log("Perturbing Target R & BE Trigger on NAS100 (Out-of-Sample 2024-2026):");
  for (const pt of perturbations) {
    const p = { targetR: pt.targetR, beTriggerR: pt.beTriggerR, beLockR: 0.2, spreadPoints: 1.0, allowOvernight: true };
    const tr = simulatePortfolio(nasOutOfSample, nasFeed, p, { maxConcurrent: 3, cooldownSec: 1800 });
    const st = computeStats(tr);
    console.log(`  • Target: ${pt.targetR}R, BE: ${pt.beTriggerR}R -> ${st.count} trades | WR: ${st.winRate}% | PF: ${st.pf} | Net: +${st.netR}R | MaxDD: -${st.maxDD}R`);
  }
}

runOverfittingAudit().catch(console.error);
