import fs from "fs";
import path from "path";
import { FastFeed, computeStats, getSessionName } from "./run_100r_portfolio_backtest.mjs";

const dataDir = path.resolve("quant_service/data");

// Load feeds
const nasFeed = new FastFeed(path.join(dataDir, "nas100_1m.bin"));
const xauFeed = new FastFeed(path.join(dataDir, "xauusd_1m.bin"));
const eurFeed = new FastFeed(path.join(dataDir, "eurusd_1m.bin"));
const feedsMap = { NAS100: nasFeed, XAUUSD: xauFeed, EURUSD: eurFeed };

// Load candidates
const nasRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_staged_candidates.json"), "utf-8"));
const xauRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "xauusd_22h_staged_candidates.json"), "utf-8"));

const eurChunksDir = path.join(dataDir, "chunks_eurusd");
let eurRaw = [];
if (fs.existsSync(eurChunksDir)) {
  for (const f of fs.readdirSync(eurChunksDir).filter(x => x.endsWith(".json"))) {
    eurRaw.push(...JSON.parse(fs.readFileSync(path.join(eurChunksDir, f), "utf-8")));
  }
}
console.log(`Loaded: NAS100 (${nasRaw.length}), XAUUSD (${xauRaw.length}), EURUSD (${eurRaw.length})`);

function simulateTrade(c, feed, params) {
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
      finalR = isBE ? (isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * beLockR) : beLockR) : -1.0;
      exitReason = isBE ? "breakeven" : "stop_loss";
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
      finalR = partialPrice ? (partialPct * partialAtR + (1 - partialPct) * runnerTargetR) : targetR;
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

function runPortfolio(candidates, feedsMap, simParams, maxConcurrent = 5, cooldownSec = 1800) {
  const activePositions = [];
  const lastEntryTimeBySymbol = {};
  const executed = [];

  for (const c of candidates) {
    const curTime = c.t;

    for (let i = activePositions.length - 1; i >= 0; i--) {
      if (activePositions[i].exitTime <= curTime) activePositions.splice(i, 1);
    }

    if (activePositions.length >= maxConcurrent) continue;

    const lastEntry = lastEntryTimeBySymbol[c.symbol] || 0;
    if (curTime - lastEntry < cooldownSec) continue;

    const feed = feedsMap[c.symbol];
    if (!feed) continue;

    const sim = simulateTrade(c, feed, { ...simParams, spreadPoints: c.spreadPoints });
    if (!sim || !sim.filled) continue;

    activePositions.push({ symbol: c.symbol, fillTime: sim.fillTime, exitTime: sim.exitTime });
    lastEntryTimeBySymbol[c.symbol] = sim.fillTime;
    executed.push({ ...sim, symbol: c.symbol, year: new Date(sim.fillTime * 1000).getUTCFullYear() });
  }

  return executed;
}

const exitProfiles = [
  { name: "Prop Lock 2.0R (BE@1.2R)", params: { targetR: 2.0, beTriggerR: 1.2, beLockR: 0.1 } },
  { name: "Prop Lock 2.5R (BE@1.2R)", params: { targetR: 2.5, beTriggerR: 1.2, beLockR: 0.1 } },
  { name: "Prop Lock 2.5R (BE@1.5R)", params: { targetR: 2.5, beTriggerR: 1.5, beLockR: 0.2 } },
  { name: "Prop Lock 3.0R (BE@1.5R)", params: { targetR: 3.0, beTriggerR: 1.5, beLockR: 0.2 } },
  { name: "Milestone 50 (50% @ 2.0R, Runner 3.5R)", params: { partialAtR: 2.0, partialPct: 0.5, runnerTargetR: 3.5, beTriggerR: 1.2, beLockR: 0.2 } },
  { name: "Milestone 40 (40% @ 2.5R, Runner 4.5R)", params: { partialAtR: 2.5, partialPct: 0.4, runnerTargetR: 4.5, beTriggerR: 1.5, beLockR: 0.3 } },
];

console.log("\n=================== 2D PARAMETER & CONFLUENCE MATRIX ===================");

for (const minConf of [60, 65, 70]) {
  const nasFiltered = nasRaw
    .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
    .filter(c => ["breaker_block", "silver_bullet", "turtle_soup"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
    .map(c => ({ ...c, symbol: "NAS100", spreadPoints: 1.0 }));

  const xauFiltered = xauRaw
    .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
    .filter(c => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes("turtle_soup"))
    .map(c => ({ ...c, symbol: "XAUUSD", spreadPoints: 0.25 }));

  const eurFiltered = eurRaw
    .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
    .filter(c => ["fvg_rejection", "breaker_block", "turtle_soup"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
    .map(c => ({ ...c, symbol: "EURUSD", spreadPoints: 0.00010 }));

  const combined = [...nasFiltered, ...xauFiltered, ...eurFiltered].sort((a, b) => a.t - b.t);
  console.log(`\n--- Confluence >= ${minConf} (${combined.length} approved setups) ---`);
  console.log("| Configuration                          | Trades | Win Rate | Profit Factor | Net Return (R) | Max DD (R) |");
  console.log("|----------------------------------------|--------|----------|---------------|----------------|------------|");

  for (const ep of exitProfiles) {
    const trades = runPortfolio(combined, feedsMap, ep.params, 5, 1800);
    const s = computeStats(trades);
    console.log(`| ${ep.name.padEnd(38)} | ${String(s.count).padEnd(6)} | ${String(s.winRate + "%").padEnd(8)} | ${String(s.pf).padEnd(13)} | ${String("+" + s.netR + "R").padEnd(14)} | ${String("-" + s.maxDD + "R").padEnd(10)} |`);
  }
}
