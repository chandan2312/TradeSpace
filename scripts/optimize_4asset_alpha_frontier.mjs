import fs from "fs";
import path from "path";
import { FastFeed, computeStats, getSessionName } from "./run_100r_portfolio_backtest.mjs";

const dataDir = path.resolve("quant_service/data");

// Feeds
const nasFeed = new FastFeed(path.join(dataDir, "nas100_1m.bin"));
const xauFeed = new FastFeed(path.join(dataDir, "xauusd_1m.bin"));
const eurFeed = new FastFeed(path.join(dataDir, "eurusd_1m.bin"));
const gerFeed = new FastFeed(path.join(dataDir, "ger40_1m.bin"));
const feedsMap = { NAS100: nasFeed, XAUUSD: xauFeed, EURUSD: eurFeed, GER40: gerFeed };

// Candidates
const nasRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "nas100_staged_candidates.json"), "utf-8"));
const xauRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "xauusd_22h_staged_candidates.json"), "utf-8"));
const eurRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "eurusd_staged_candidates.json"), "utf-8"));
const gerRaw = JSON.parse(fs.readFileSync(path.join(dataDir, "ger40_staged_candidates.json"), "utf-8"));

console.log(`Loaded 4-Asset Universe: NAS100 (${nasRaw.length}), XAUUSD (${xauRaw.length}), EURUSD (${eurRaw.length}), GER40 (${gerRaw.length})`);

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
    allowOvernight = true,
    intradayCutoffUtcMin = 1260, // 21:00 UTC
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

    if (!allowOvernight) {
      const dDate = new Date(bar.t * 1000);
      const curMin = dDate.getUTCHours() * 60 + dDate.getUTCMinutes();
      if (curMin >= intradayCutoffUtcMin) {
        exitTime = bar.t;
        const floatingR = (bar.close - fillPrice) * d / riskDist;
        finalR = isPartialTaken ? (partialPct * partialAtR + (1 - partialPct) * floatingR) : floatingR;
        exitReason = "intraday_close";
        return { filled: true, fillTime, exitTime, finalR, exitReason, candidate: c };
      }
    }

    // SL check
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

    // BE check
    if (!isBE) {
      const hitBE = d === 1 ? bar.high >= beTriggerPrice : bar.low <= beTriggerPrice;
      if (hitBE) {
        isBE = true;
        currentSL = beLockPrice;
      }
    }

    // Partial Target Check
    if (partialPrice && !isPartialTaken) {
      const hitPartial = d === 1 ? bar.high >= partialPrice : bar.low <= partialPrice;
      if (hitPartial) {
        isPartialTaken = true;
        isBE = true;
        currentSL = beLockPrice;
      }
    }

    // Full Target Check
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

function runPortfolio(candidates, simParams, options = {}) {
  const { maxConcurrent = 5, cooldownSec = 1800 } = options;
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

    const sim = simulateExecution(c, feed, { ...simParams, spreadPoints: c.spreadPoints });
    if (!sim || !sim.filled) continue;

    activePositions.push({ symbol: c.symbol, fillTime: sim.fillTime, exitTime: sim.exitTime });
    lastEntryTimeBySymbol[c.symbol] = sim.fillTime;
    executed.push({
      ...sim,
      symbol: c.symbol,
      model: c.candidateLevel?.modelId || c.candidateLevel?.modelName || c.model,
      year: new Date(sim.fillTime * 1000).getUTCFullYear(),
      month: new Date(sim.fillTime * 1000).toISOString().slice(0, 7),
    });
  }

  return executed;
}

// Asset filtering configurations
const ASSET_FILTERS = [
  {
    name: "Core Institutional Alpha (High Conviction)",
    getSetups: (minConf) => {
      const nas = nasRaw
        .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
        .filter(c => ["breaker_block", "silver_bullet", "turtle_soup"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
        .map(c => ({ ...c, symbol: "NAS100", spreadPoints: 1.0 }));

      const xau = xauRaw
        .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
        .filter(c => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes("turtle_soup"))
        .filter(c => ["LONDON", "NEW_YORK", "ASIA"].includes(getSessionName(c.t)))
        .map(c => ({ ...c, symbol: "XAUUSD", spreadPoints: 0.25 }));

      const eur = eurRaw
        .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
        .filter(c => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes("fvg_rejection"))
        .filter(c => ["LONDON", "NEW_YORK"].includes(getSessionName(c.t)))
        .map(c => ({ ...c, symbol: "EURUSD", spreadPoints: 0.00010 }));

      const ger = gerRaw
        .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
        .filter(c => ["breaker_block", "po3_daily_cycle"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
        .filter(c => ["LONDON", "NEW_YORK"].includes(getSessionName(c.t)))
        .map(c => ({ ...c, symbol: "GER40", spreadPoints: 1.5 }));

      return [...nas, ...xau, ...eur, ...ger].sort((a, b) => a.t - b.t);
    }
  },
  {
    name: "Expanded Alpha Basket (+ DAX & EUR Breakers)",
    getSetups: (minConf) => {
      const nas = nasRaw
        .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
        .filter(c => ["breaker_block", "silver_bullet", "turtle_soup"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
        .map(c => ({ ...c, symbol: "NAS100", spreadPoints: 1.0 }));

      const xau = xauRaw
        .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
        .filter(c => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes("turtle_soup"))
        .filter(c => ["LONDON", "NEW_YORK", "ASIA"].includes(getSessionName(c.t)))
        .map(c => ({ ...c, symbol: "XAUUSD", spreadPoints: 0.25 }));

      const eur = eurRaw
        .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
        .filter(c => ["fvg_rejection", "breaker_block"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
        .filter(c => ["LONDON", "NEW_YORK"].includes(getSessionName(c.t)))
        .map(c => ({ ...c, symbol: "EURUSD", spreadPoints: 0.00010 }));

      const ger = gerRaw
        .filter(c => (c.approved === true || (!c.execution?.vetoes?.length && c.execution?.approved !== false)) && (c.candidateLevel?.confluenceScore >= minConf))
        .filter(c => ["breaker_block", "po3_daily_cycle", "turtle_soup"].some(m => (c.candidateLevel?.modelId || c.candidateLevel?.modelName)?.includes(m)))
        .filter(c => ["LONDON", "NEW_YORK"].includes(getSessionName(c.t)))
        .map(c => ({ ...c, symbol: "GER40", spreadPoints: 1.5 }));

      return [...nas, ...xau, ...eur, ...ger].sort((a, b) => a.t - b.t);
    }
  }
];

const exitProfiles = [
  { name: "Prop Lock 2.0R (BE@1.2R)", params: { targetR: 2.0, beTriggerR: 1.2, beLockR: 0.1 } },
  { name: "Prop Lock 2.5R (BE@1.2R)", params: { targetR: 2.5, beTriggerR: 1.2, beLockR: 0.1 } },
  { name: "Prop Lock 2.5R (BE@1.5R)", params: { targetR: 2.5, beTriggerR: 1.5, beLockR: 0.2 } },
  { name: "Milestone 50 (50% @ 2.0R, Runner 3.5R, BE@1.2R)", params: { partialAtR: 2.0, partialPct: 0.5, runnerTargetR: 3.5, beTriggerR: 1.2, beLockR: 0.2 } },
  { name: "Milestone 40 (40% @ 2.5R, Runner 4.5R, BE@1.5R)", params: { partialAtR: 2.5, partialPct: 0.4, runnerTargetR: 4.5, beTriggerR: 1.5, beLockR: 0.3 } },
  { name: "Milestone 50-Aggressive (50% @ 2.5R, Runner 5.0R)", params: { partialAtR: 2.5, partialPct: 0.5, runnerTargetR: 5.0, beTriggerR: 1.5, beLockR: 0.5 } },
];

console.log("=========================================================================================================");
console.log(" 4-ASSET MASTER PORTFOLIO GRID SEARCH (NAS100 + XAUUSD + EURUSD + GER40)");
console.log("=========================================================================================================\n");

const gridResults = [];

for (const basket of ASSET_FILTERS) {
  for (const minConf of [60, 65, 70]) {
    const setups = basket.getSetups(minConf);
    for (const ep of exitProfiles) {
      for (const allowOvernight of [true, false]) {
        const p = { ...ep.params, allowOvernight, maxHoldMinutes: allowOvernight ? 2880 : 1440 };
        const trades = runPortfolio(setups, p, { maxConcurrent: 5, cooldownSec: 1800 });
        const st = computeStats(trades);
        const avgPerYr = (parseFloat(st.netR) / 5.6).toFixed(1);

        gridResults.push({
          basket: basket.name,
          minConf,
          exit: ep.name,
          mode: allowOvernight ? "Mode A (Hold)" : "Mode B (Flat)",
          tradesCount: st.count,
          winRate: st.winRate,
          pf: st.pf,
          netR: st.netR,
          maxDD: st.maxDD,
          avgPerYr: parseFloat(avgPerYr),
          trades,
        });
      }
    }
  }
}

// Sort by Profit Factor descending
gridResults.sort((a, b) => parseFloat(b.pf) - parseFloat(a.pf));

console.log("TOP 15 MASTER PORTFOLIO CONFIGURATIONS (Ranked by Profit Factor):");
console.log("| Basket & Settings | Exit Strategy | Mode | Trades | Win Rate | PF | Net R | Max DD | Avg R/yr |");
console.log("|-------------------|---------------|------|--------|----------|----|-------|--------|----------|");

for (const r of gridResults.slice(0, 15)) {
  const label = `${r.basket.slice(0, 15)} (Conf>=${r.minConf})`.padEnd(25);
  const exitStr = r.exit.slice(0, 28).padEnd(28);
  const modeStr = r.mode.slice(0, 12).padEnd(12);
  console.log(`| ${label} | ${exitStr} | ${modeStr} | ${String(r.tradesCount).padEnd(6)} | ${String(r.winRate + "%").padEnd(8)} | ${String(r.pf).padEnd(4)} | ${String("+" + r.netR + "R").padEnd(7)} | ${String("-" + r.maxDD + "R").padEnd(8)} | ${String("+" + r.avgPerYr + "R/yr").padEnd(10)} |`);
}

// Detailed analysis on #1 Configuration
const best = gridResults[0];
console.log(`\n=================== #1 PREMIER CONFIGURATION IN-DEPTH AUDIT ===================`);
console.log(`Basket: ${best.basket} | Confluence >= ${best.minConf}`);
console.log(`Exit Strategy: ${best.exit} | Mode: ${best.mode}`);
console.log(`Total Trades: ${best.tradesCount} | Win Rate: ${best.winRate}% | Profit Factor: ${best.pf}`);
console.log(`Net Profit: +${best.netR} R | Max Drawdown: -${best.maxDD} R | Annual Avg: +${best.avgPerYr} R/year\n`);

// Yearly consistency of #1
const yearly = {};
for (const t of best.trades) {
  yearly[t.year] = yearly[t.year] || [];
  yearly[t.year].push(t);
}

console.log("Year-by-Year Consistency:");
console.log("| Year | Trades | Win Rate | Profit Factor | Net Return (R) | Max DD (R) |");
console.log("|------|--------|----------|---------------|----------------|------------|");
for (const y of Object.keys(yearly).sort()) {
  const s = computeStats(yearly[y]);
  console.log(`| ${y} | ${String(s.count).padEnd(6)} | ${String(s.winRate + "%").padEnd(8)} | ${String(s.pf).padEnd(13)} | ${String("+" + s.netR + "R").padEnd(14)} | ${String("-" + s.maxDD + "R").padEnd(10)} |`);
}

// Asset breakdown of #1
const byAsset = {};
for (const t of best.trades) {
  byAsset[t.symbol] = byAsset[t.symbol] || [];
  byAsset[t.symbol].push(t);
}

console.log("\nAsset-by-Asset Contribution:");
console.log("| Asset  | Trades | Win Rate | Profit Factor | Net Return (R) | Max DD (R) |");
console.log("|--------|--------|----------|---------------|----------------|------------|");
for (const a of Object.keys(byAsset).sort()) {
  const s = computeStats(byAsset[a]);
  console.log(`| ${a.padEnd(6)} | ${String(s.count).padEnd(6)} | ${String(s.winRate + "%").padEnd(8)} | ${String(s.pf).padEnd(13)} | ${String("+" + s.netR + "R").padEnd(14)} | ${String("-" + s.maxDD + "R").padEnd(10)} |`);
}

// Model breakdown of #1
const byModel = {};
for (const t of best.trades) {
  byModel[t.model] = byModel[t.model] || [];
  byModel[t.model].push(t);
}

console.log("\nModel-by-Model Contribution:");
console.log("| Model                 | Trades | Win Rate | Profit Factor | Net Return (R) |");
console.log("|-----------------------|--------|----------|---------------|----------------|");
for (const m of Object.keys(byModel).sort()) {
  const s = computeStats(byModel[m]);
  console.log(`| ${m.padEnd(21)} | ${String(s.count).padEnd(6)} | ${String(s.winRate + "%").padEnd(8)} | ${String(s.pf).padEnd(13)} | ${String("+" + s.netR + "R").padEnd(14)} |`);
}
