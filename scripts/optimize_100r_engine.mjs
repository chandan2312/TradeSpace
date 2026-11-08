import fs from "fs";
import path from "path";
import { FastFeed, computeStats, getSessionName } from "./run_100r_portfolio_backtest.mjs";

const dataDir = path.resolve("quant_service/data");

// Feeds
const nasFeed = new FastFeed(path.join(dataDir, "nas100_1m.bin"));
const xauFeed = new FastFeed(path.join(dataDir, "xauusd_1m.bin"));
const eurFeed = new FastFeed(path.join(dataDir, "eurusd_1m.bin"));
const feedsMap = { NAS100: nasFeed, XAUUSD: xauFeed, EURUSD: eurFeed };

// Candidates
const nasRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_staged_candidates.json"), "utf-8"));
const xauRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "xauusd_22h_staged_candidates.json"), "utf-8"));
const eurRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "eurusd_staged_candidates.json"), "utf-8"));

// Asset-specific premier model filtering
const nasFiltered = nasRaw
  .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= 60))
  .filter(c => ["breaker_block", "silver_bullet", "turtle_soup"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
  .map(c => ({ ...c, symbol: "NAS100", spreadPoints: 1.0 }));

const xauFiltered = xauRaw
  .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= 60))
  .filter(c => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes("turtle_soup"))
  .map(c => ({ ...c, symbol: "XAUUSD", spreadPoints: 0.25 }));

const eurFiltered = eurRaw
  .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= 60))
  .filter(c => ["fvg_rejection", "breaker_block"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
  .map(c => ({ ...c, symbol: "EURUSD", spreadPoints: 0.00010 }));

const allCandidates = [...nasFiltered, ...xauFiltered, ...eurFiltered].sort((a, b) => a.t - b.t);
console.log(`Loaded ${allCandidates.length} high-conviction setups across NAS100 (${nasFiltered.length}), XAUUSD (${xauFiltered.length}), EURUSD (${eurFiltered.length})\n`);

function simulateExecution(c, feed, params) {
  const {
    spreadPoints = 0,
    targetR = 2.5,
    beTriggerR = 1.2,
    beLockR = 0.1,
    partialAtR = null,
    partialPct = 0.5,
    runnerTargetR = 4.0,
    maxPendingBars = 180,
    maxHoldMinutes = 2880,
  } = params;

  const level = c.candidateLevel;
  if (!level) return null;

  const d = c.dir;
  const limitPrice = level.entry;
  const slPrice = level.stopLoss;
  const riskDist = Math.abs(limitPrice - slPrice);
  if (riskDist <= 0) return null;

  const beTriggerPrice = d === 1 ? limitPrice + beTriggerR * riskDist : limitPrice - beTriggerR * riskDist;
  const beLockPrice = d === 1 ? limitPrice + beLockR * riskDist : limitPrice - beLockR * riskDist;
  const targetPrice = d === 1 ? limitPrice + targetR * riskDist : limitPrice - targetR * riskDist;
  const partialPrice = partialAtR ? (d === 1 ? limitPrice + partialAtR * riskDist : limitPrice - partialAtR * riskDist) : null;
  const runnerPrice = runnerTargetR ? (d === 1 ? limitPrice + runnerTargetR * riskDist : limitPrice - runnerTargetR * riskDist) : null;
  const maxRunawayDist = 1.5 * riskDist;

  const startT = c.t + 900;
  let idx = feed.findIndex(startT);
  if (idx < 0) return null;

  let isFilled = false;
  let fillPrice = limitPrice;
  let fillTime = 0;

  for (let step = 0; step < maxPendingBars && idx < feed.totalBars; step++, idx++) {
    const bar = feed.getBar(idx);
    if (!bar) break;

    const moveInDir = d === 1 ? (bar.high - c.currentPrice) : (c.currentPrice - bar.low);
    if (moveInDir >= maxRunawayDist) return null;

    const hitEarly = d === 1 ? bar.high >= targetPrice : bar.low <= targetPrice;
    if (hitEarly) return null;

    const canFill = d === 1 ? (bar.low < limitPrice - spreadPoints) : (bar.high > limitPrice + spreadPoints);
    if (canFill) {
      isFilled = true;
      fillTime = bar.t;
      break;
    }
  }

  if (!isFilled) return null;

  let isBE = false;
  let isPartialTaken = false;
  let currentSL = slPrice;
  let finalR = 0;
  let exitReason = "";
  let exitTime = 0;

  for (let step = 0; step < maxHoldMinutes && idx < feed.totalBars; step++, idx++) {
    const bar = feed.getBar(idx);
    if (!bar) break;

    const hitSL = d === 1 ? bar.low <= currentSL + spreadPoints : bar.high >= currentSL - spreadPoints;
    if (hitSL) {
      exitTime = bar.t;
      if (isBE) {
        finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * beLockR) : beLockR;
        exitReason = "breakeven";
      } else {
        finalR = -1.0;
        exitReason = "stop_loss";
      }
      return { filled: true, fillTime, exitTime, finalR, exitReason, candidate: c };
    }

    if (!isBE) {
      const hitBE = d === 1 ? bar.high >= beTriggerPrice : bar.low <= beTriggerPrice;
      if (hitBE) {
        isBE = true;
        currentSL = beLockPrice;
      }
    }

    if (partialPrice && !isPartialTaken) {
      const hitPartial = d === 1 ? bar.high >= partialPrice : bar.low <= partialPrice;
      if (hitPartial) {
        isPartialTaken = true;
        isBE = true;
        currentSL = beLockPrice;
      }
    }

    const hitTarget = partialPrice
      ? (d === 1 ? bar.high >= runnerPrice : bar.low <= runnerPrice)
      : (d === 1 ? bar.high >= targetPrice : bar.low <= targetPrice);

    if (hitTarget) {
      exitTime = bar.t;
      if (partialPrice) {
        finalR = partialPct * partialAtR + (1 - partialPct) * runnerTargetR;
      } else {
        finalR = targetR;
      }
      exitReason = "target_exit";
      return { filled: true, fillTime, exitTime, finalR, exitReason, candidate: c };
    }
  }

  const lastBar = feed.getBar(idx - 1);
  const px = lastBar ? lastBar.close : fillPrice;
  const floatingR = (px - fillPrice) * d / riskDist;
  finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * floatingR) : floatingR;
  return { filled: true, fillTime, exitTime: lastBar?.t || fillTime, finalR, exitReason: "timeout", candidate: c };
}

function runSimulation(params, maxConcurrent = 5, cooldownSec = 1800) {
  const activePositions = [];
  const lastEntryTimeBySymbol = {};
  const executed = [];

  for (const c of allCandidates) {
    const curTime = c.t;

    for (let i = activePositions.length - 1; i >= 0; i--) {
      if (activePositions[i].exitTime <= curTime) activePositions.splice(i, 1);
    }

    if (activePositions.length >= maxConcurrent) continue;

    const lastEntry = lastEntryTimeBySymbol[c.symbol] || 0;
    if (curTime - lastEntry < cooldownSec) continue;

    const feed = feedsMap[c.symbol];
    if (!feed) continue;

    const sim = simulateExecution(c, feed, { ...params, spreadPoints: c.spreadPoints });
    if (!sim || !sim.filled) continue;

    activePositions.push({ symbol: c.symbol, fillTime: sim.fillTime, exitTime: sim.exitTime });
    lastEntryTimeBySymbol[c.symbol] = sim.fillTime;
    executed.push({ ...sim, symbol: c.symbol, year: new Date(sim.fillTime * 1000).getUTCFullYear() });
  }

  return executed;
}

const strategies = [
  { name: "Prop Lock 2.0R (BE@1.2R)", p: { targetR: 2.0, beTriggerR: 1.2, beLockR: 0.1 } },
  { name: "Prop Lock 2.5R (BE@1.2R)", p: { targetR: 2.5, beTriggerR: 1.2, beLockR: 0.1 } },
  { name: "Prop Lock 2.5R (BE@1.5R)", p: { targetR: 2.5, beTriggerR: 1.5, beLockR: 0.2 } },
  { name: "Milestone 50 (50% @ 2.0R, Runner 3.5R)", p: { partialAtR: 2.0, partialPct: 0.5, runnerTargetR: 3.5, beTriggerR: 1.2, beLockR: 0.2 } },
  { name: "Milestone 40 (40% @ 2.5R, Runner 4.5R)", p: { partialAtR: 2.5, partialPct: 0.4, runnerTargetR: 4.5, beTriggerR: 1.5, beLockR: 0.3 } },
  { name: "Milestone 30 (30% @ 2.0R, Runner 5.0R)", p: { partialAtR: 2.0, partialPct: 0.3, runnerTargetR: 5.0, beTriggerR: 1.2, beLockR: 0.3 } },
  { name: "Milestone 50-Aggressive (50% @ 2.5R, Runner 5.0R)", p: { partialAtR: 2.5, partialPct: 0.5, runnerTargetR: 5.0, beTriggerR: 1.5, beLockR: 0.5 } },
];

console.log("| Strategy                                   | Trades | Win Rate | Profit Factor | Net Return (R) | Max DD (R) | Avg R/yr |");
console.log("|--------------------------------------------|--------|----------|---------------|----------------|------------|----------|");

for (const s of strategies) {
  const trades = runSimulation(s.p, 5, 1800);
  const st = computeStats(trades);
  const avgPerYr = (parseFloat(st.netR) / 5.6).toFixed(1);
  console.log(`| ${s.name.padEnd(42)} | ${String(st.count).padEnd(6)} | ${String(st.winRate + "%").padEnd(8)} | ${String(st.pf).padEnd(13)} | ${String("+" + st.netR + "R").padEnd(14)} | ${String("-" + st.maxDD + "R").padEnd(10)} | ${String("+" + avgPerYr + "R/yr").padEnd(8)} |`);
}
