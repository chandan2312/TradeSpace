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

function simulateExecution(c, feed, params) {
  const {
    spreadPoints = 0,
    targetR = 2.0,
    beTriggerR = 1.2,
    beLockR = 0.1,
    maxPendingBars = 180,
    maxHoldMinutes = 1440,
    allowOvernight = false,
    intradayCutoffUtcMin = 1260,
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
        finalR = (bar.close - fillPrice) * d / riskDist;
        exitReason = "intraday_close";
        return { filled: true, fillTime, exitTime, finalR, exitReason, candidate: c };
      }
    }

    const hitSL = d === 1 ? bar.low <= currentSL + spreadPoints : bar.high >= currentSL - spreadPoints;
    if (hitSL) {
      exitTime = bar.t;
      finalR = isBE ? beLockR : -1.0;
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

    const hitTarget = d === 1 ? bar.high >= targetPrice : bar.low <= targetPrice;
    if (hitTarget) {
      exitTime = bar.t;
      finalR = targetR;
      exitReason = "target_exit";
      return { filled: true, fillTime, exitTime, finalR, exitReason, candidate: c };
    }
  }

  const lastBar = feed.getBar(idx - 1);
  const px = lastBar ? lastBar.close : fillPrice;
  finalR = (px - fillPrice) * d / riskDist;
  return { filled: true, fillTime, exitTime: lastBar?.t || fillTime, finalR, exitReason: "timeout", candidate: c };
}

function runPortfolioAudit() {
  const minConf = 70;

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

  const candidates = [...nas, ...xau, ...eur, ...ger].sort((a, b) => a.t - b.t);

  const activePositions = [];
  const lastEntryTimeBySymbol = {};
  const executed = [];

  const simParams = { targetR: 2.0, beTriggerR: 1.2, beLockR: 0.1, allowOvernight: false };

  for (const c of candidates) {
    const curTime = c.t;

    for (let i = activePositions.length - 1; i >= 0; i--) {
      if (activePositions[i].exitTime <= curTime) activePositions.splice(i, 1);
    }

    if (activePositions.length >= 5) continue;

    const lastEntry = lastEntryTimeBySymbol[c.symbol] || 0;
    if (curTime - lastEntry < 1800) continue;

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

  // Monthly breakdown
  const monthly = {};
  for (const t of executed) {
    monthly[t.month] = monthly[t.month] || [];
    monthly[t.month].push(t);
  }

  console.log("===============================================================================");
  console.log(" 4-ASSET MASTER PORTFOLIO MONTHLY CONSISTENCY AUDIT (2021 - 2026)");
  console.log("===============================================================================\n");

  const monthKeys = Object.keys(monthly).sort();
  let winMonths = 0;
  let lossMonths = 0;
  let beMonths = 0;

  console.log("| Month   | Trades | Win Rate | Profit Factor | Net Return (R) | Max DD (R) |");
  console.log("|---------|--------|----------|---------------|----------------|------------|");

  for (const m of monthKeys) {
    const s = computeStats(monthly[m]);
    const net = parseFloat(s.netR);
    if (net > 0.1) winMonths++;
    else if (net < -0.1) lossMonths++;
    else beMonths++;

    console.log(`| ${m} | ${String(s.count).padEnd(6)} | ${String(s.winRate + "%").padEnd(8)} | ${String(s.pf).padEnd(13)} | ${String((net >= 0 ? "+" : "") + s.netR + "R").padEnd(14)} | ${String("-" + s.maxDD + "R").padEnd(10)} |`);
  }

  const winMonthPct = ((winMonths / monthKeys.length) * 100).toFixed(1);
  console.log("===============================================================================");
  console.log(`Total Active Trading Months: ${monthKeys.length}`);
  console.log(`Profitable Months: ${winMonths} (${winMonthPct}%) | Losing Months: ${lossMonths} | Flat Months: ${beMonths}`);
  console.log("===============================================================================\n");
}

runPortfolioAudit();
