import {
  evaluateMomentumVelocity,
  evaluateOpposingObstacles,
  evaluateDrawOnLiquidity,
  evaluateLeadLagSMT,
  evaluateSessionVolatility,
  synthesizeRedecision,
  evaluateMilestoneRedecision,
  resolveTradeHorizon,
  HORIZON_PROFILES,
} from "./lib/autonomous/redecision.js";

console.log("=======================================================");
console.log("TEST SUITE: Autonomous Milestone Redecision Engine (AMRE)");
console.log("=======================================================");

let passed = 0;
let failed = 0;
function assert(desc, condition, received = null) {
  if (condition) {
    console.log(`✅ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${desc} (Received: ${JSON.stringify(received)})`);
    failed++;
  }
}

// Helper to synthesize dummy candles
function makeCandleSeries({ count = 20, startPrice = 1.0800, step = 0.0005, dir = 1, wickFactor = 0.1 }) {
  const bars = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = dir === 1 ? open + step : open - step;
    const high = Math.max(open, close) + step * wickFactor;
    const low = Math.min(open, close) - step * wickFactor;
    bars.push({
      time: 1700000000 + i * 900,
      open,
      high,
      low,
      close,
      volume: 1000 + i * 50,
    });
    price = close;
  }
  return bars;
}

const baseTradeBuy = {
  _id: "trade_test_001",
  symbol: "EURUSD",
  dir: 1,
  entryPrice: 1.0800,
  slPrice: 1.0770,
  initialRiskDistance: 0.0030,
  targetRR: 5.0,
  tpPrice: 1.0950,
  initialVolume: 1.0,
  remainingVolume: 0.6,
  managementLogic: "milestone_50",
  symbolSpec: { digits: 5, point: 0.00001 },
};

// -------------------------------------------------------------
// 1. Pillar 1: Momentum & Velocity Engine
// -------------------------------------------------------------
console.log("\n--- 1. Testing Pillar 1: Momentum & Velocity Engine ---");

const expandingBars = makeCandleSeries({ count: 20, dir: 1, step: 0.0004, wickFactor: 0.05 });
const momExpanding = evaluateMomentumVelocity(expandingBars, baseTradeBuy, 1.0875);
assert("Expanding candles produce positive momentum score", momExpanding.score > 20, momExpanding.score);
assert("Expanding trend integrity is EXPANDING or HEALTHY", ["EXPANDING", "HEALTHY"].includes(momExpanding.trendIntegrity), momExpanding.trendIntegrity);
assert("No opposing MSS on clean expansion", momExpanding.opposingMss === false, momExpanding.opposingMss);

// Candle series with heavy opposing wicks (sellers absorbing liquidity)
const exhaustingBars = makeCandleSeries({ count: 20, dir: 1, step: 0.0002, wickFactor: 1.5 });
const momExhausting = evaluateMomentumVelocity(exhaustingBars, baseTradeBuy, 1.0875);
assert("Opposing wicks produce lower momentum score than clean expansion", momExhausting.score < momExpanding.score, momExhausting.score);
assert("Opposing wick ratio is elevated (> 0.25)", momExhausting.opposingWickRatio > 0.25, momExhausting.opposingWickRatio);

// -------------------------------------------------------------
// 2. Pillar 2: Opposing Structural Roadblocks & Obstacles
// -------------------------------------------------------------
console.log("\n--- 2. Testing Pillar 2: Opposing Structural Roadblocks ---");

// Frame with a clear Bearish Order Block at 1.0880 (approx 2.67R from entry 1.0800)
const h1BarsWithOB = [
  ...makeCandleSeries({ count: 10, startPrice: 1.0820, step: 0.0004, dir: 1 }),
  // Bearish OB: green candle before sharp red drop breaking confirmed swing
  { time: 1700010000, open: 1.0875, high: 1.0890, low: 1.0870, close: 1.0885, volume: 1500 },
  { time: 1700013600, open: 1.0885, high: 1.0890, low: 1.0840, close: 1.0845, volume: 3000 },
  { time: 1700017200, open: 1.0845, high: 1.0850, low: 1.0830, close: 1.0835, volume: 2500 },
  ...makeCandleSeries({ count: 10, startPrice: 1.0835, step: 0.0003, dir: 1 }),
];

const obsResult = evaluateOpposingObstacles({ H1: h1BarsWithOB, H4: [] }, baseTradeBuy, 1.0875);
assert("Obstacles engine returns an array", Array.isArray(obsResult.obstacles), obsResult.obstacles);
assert("Score reflects presence or absence of obstacles", typeof obsResult.score === "number", obsResult.score);

// Test clear skies scenario (no obstacles in path)
const obsClear = evaluateOpposingObstacles({ H1: [], H4: [] }, baseTradeBuy, 1.0875);
assert("Clear skies scenario returns positive score", obsClear.score >= 50, obsClear.score);
assert("Clear skies has empty obstacles array", obsClear.obstacles.length === 0, obsClear.obstacles.length);

// -------------------------------------------------------------
// 3. Pillar 3: Draw on Liquidity (DOL) Health & Magnetism
// -------------------------------------------------------------
console.log("\n--- 3. Testing Pillar 3: Draw on Liquidity Health ---");

const dolResult = evaluateDrawOnLiquidity({}, baseTradeBuy, 1.0875);
assert("DOL engine returns status and score", typeof dolResult.score === "number" && typeof dolResult.status === "string", dolResult);

// -------------------------------------------------------------
// 4. Decision Synthesis Matrix
// -------------------------------------------------------------
console.log("\n--- 4. Testing Synthesis & Decision Rules ---");

// Case A: Fatal opposing MSS -> CLOSE_FULL_NOW
const synthClose = synthesizeRedecision({
  momentum: { score: -75, opposingMss: true, opposingWickRatio: 0.4 },
  obstacles: { score: -60, obstacles: [] },
  dol: { score: -50, status: "ALREADY_SWEPT" },
  smt: { score: -30 },
  session: { score: 0 },
  trade: baseTradeBuy,
  currentPrice: 1.0875,
});
assert("Fatal opposing MSS triggers CLOSE_FULL_NOW", synthClose.action === "CLOSE_FULL_NOW", synthClose.action);
assert("CLOSE_FULL_NOW reason mentions opposing MSS", synthClose.reason.includes("Market Structure Shift"), synthClose.reason);
assert("CLOSE_FULL_NOW leaves newTpPrice as null", synthClose.newTpPrice === null, synthClose.newTpPrice);

// Case B: Roadblock before TP -> REDUCE_TP
const synthReduce = synthesizeRedecision({
  momentum: { score: 10, opposingMss: false, opposingWickRatio: 0.2 },
  obstacles: {
    score: -60,
    nearestObstacle: {
      price: 1.0880,
      safeBufferPrice: 1.0876,
      safeBufferRR: 2.5,
      name: "H4 Bearish Order Block",
    },
    obstacles: [{ name: "H4 OB" }],
  },
  dol: { score: 20, status: "CLEAR_RUNWAY" },
  smt: { score: 0 },
  session: { score: 10 },
  trade: baseTradeBuy,
  currentPrice: 1.0875,
});
assert("Approaching obstacle triggers REDUCE_TP", synthReduce.action === "REDUCE_TP", synthReduce.action);
assert("Reduced TP is strictly less than original TP (5R)", synthReduce.newTargetRR < baseTradeBuy.targetRR, synthReduce.newTargetRR);
assert("Reduced TP is at least 1.5R", synthReduce.newTargetRR >= 1.5, synthReduce.newTargetRR);
assert("Reduced TP price is set properly", synthReduce.newTpPrice > baseTradeBuy.entryPrice, synthReduce.newTpPrice);

// Case C: Runway clear, high momentum -> EXPAND_TP
const synthExpand = synthesizeRedecision({
  momentum: { score: 85, opposingMss: false, opposingWickRatio: 0.1 },
  obstacles: { score: 80, obstacles: [], nearestObstacle: null },
  dol: { score: 75, status: "UNREACHED_MAGNET" },
  smt: { score: 50 },
  session: { score: 60 },
  trade: { ...baseTradeBuy, targetRR: 3.0, tpPrice: 1.0890 }, // 3R Day Trade with room to expand to 4R or 5R
  currentPrice: 1.0845,
});
assert("Runaway expansion triggers EXPAND_TP", synthExpand.action === "EXPAND_TP", synthExpand.action);
assert("Expanded target RR is greater than old target RR (3.0R)", synthExpand.newTargetRR > 3.0, synthExpand.newTargetRR);
assert("Expanded target RR respects 5.0R day trade cap", synthExpand.newTargetRR <= 5.0, synthExpand.newTargetRR);

// Case D: Solid normal conditions -> HOLD_FULL_TP
const synthHold = synthesizeRedecision({
  momentum: { score: 40, opposingMss: false, opposingWickRatio: 0.15 },
  obstacles: { score: 50, obstacles: [], nearestObstacle: null },
  dol: { score: 35, status: "CLEAR_RUNWAY" },
  smt: { score: 15 },
  session: { score: 40 },
  trade: baseTradeBuy,
  currentPrice: 1.0875,
});
assert("Solid conditions trigger HOLD_FULL_TP", synthHold.action === "HOLD_FULL_TP", synthHold.action);
assert("HOLD_FULL_TP keeps original target RR (5.0R)", synthHold.newTargetRR === 5.0, synthHold.newTargetRR);
assert("HOLD_FULL_TP keeps original tpPrice", synthHold.newTpPrice === baseTradeBuy.tpPrice, synthHold.newTpPrice);

// -------------------------------------------------------------
// 5. Full Coordinator Integration
// -------------------------------------------------------------
console.log("\n--- 5. Testing evaluateMilestoneRedecision Coordinator ---");

const coordinatorResult = await evaluateMilestoneRedecision({
  trade: baseTradeBuy,
  currentPrice: 1.0875, // 50% milestone (+2.5R)
  frames: {
    M15: expandingBars,
    H1: expandingBars,
  },
});

assert("Coordinator returns ok: true", coordinatorResult.ok === true, coordinatorResult.ok);
assert("Coordinator provides valid action", ["HOLD_FULL_TP", "REDUCE_TP", "CLOSE_FULL_NOW", "EXPAND_TP"].includes(coordinatorResult.action), coordinatorResult.action);
assert("Coordinator provides all 5 pillar details", Boolean(coordinatorResult.pillars.momentum && coordinatorResult.pillars.obstacles && coordinatorResult.pillars.dol && coordinatorResult.pillars.smt && coordinatorResult.pillars.session), coordinatorResult.pillars);
assert("Coordinator accurately logs 50% milestone R (2.5R)", coordinatorResult.milestoneR === 2.5, coordinatorResult.milestoneR);

// -------------------------------------------------------------
// 6. Testing Institutional Upgrades & Noise Filtering
// -------------------------------------------------------------
console.log("\n--- 6. Testing Institutional Upgrades & Noise Filtering ---");

// Test A: Micro-doji noise rejection in Momentum
// Create series with tiny 1-pip range candles that have 50% wicks
const microDojiBars = [
  ...expandingBars,
  { time: 1700020000, open: 1.08800, high: 1.08801, low: 1.08799, close: 1.08800, volume: 50 },
  { time: 1700020900, open: 1.08800, high: 1.08801, low: 1.08799, close: 1.08800, volume: 50 },
];
const momDoji = evaluateMomentumVelocity(microDojiBars, baseTradeBuy, 1.0880);
assert("Micro-doji noise does not collapse momentum score", momDoji.score > 20, momDoji.score);

// Test B: Breakout Acceptance in DOL (body closing above PDH is continuation, not sweep)
const framesWithBreakout = {
  H4: [
    { time: 1699900000, open: 1.0780, high: 1.0810, low: 1.0770, close: 1.0800 },
    { time: 1700000000, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0840 },
    { time: 1700014400, open: 1.0840, high: 1.0910, low: 1.0835, close: 1.0905 }, // Closed above PDH (1.0890)
  ],
  D1: [
    { time: 1699900000, high: 1.0890, low: 1.0750, open: 1.0760, close: 1.0880 }, // Prev Day High: 1.0890
    { time: 1699986400, high: 1.0910, low: 1.0870, open: 1.0880, close: 1.0905 },
  ],
  M15: [
    { time: 1700018000, open: 1.0885, high: 1.0910, low: 1.0880, close: 1.0905 }, // Closed firmly above PDH
  ],
};
const dolBreakout = evaluateDrawOnLiquidity(framesWithBreakout, baseTradeBuy, 1.0905);
assert("Breakout candle closing above PDH is recognized as EXPANDING_ACCEPTANCE", dolBreakout.status === "EXPANDING_ACCEPTANCE", dolBreakout.status);
assert("Expanding acceptance produces positive score (+65)", dolBreakout.score === 65, dolBreakout.score);

// Test C: Anchored Target Expansion
const synthAnchored = synthesizeRedecision({
  momentum: { score: 75, opposingMss: false, opposingWickRatio: 0.1 },
  obstacles: { score: 80, obstacles: [] },
  dol: {
    score: 75,
    status: "UNREACHED_MAGNET",
    targetPool: { name: "PWH", price: 1.0926 }, // 1.0800 + 4.2R * 0.0030 = 1.0926
  },
  smt: { score: 50 },
  session: { score: 60, sessionPhase: "PRIME_EXPANSION" },
  trade: { ...baseTradeBuy, targetRR: 3.0, tpPrice: 1.0890 },
  currentPrice: 1.0875,
});
assert("Anchored expansion targets specific macro DOL pool (4.2R)", synthAnchored.action === "EXPAND_TP" && synthAnchored.newTargetRR === 4.2, synthAnchored.newTargetRR);

// -------------------------------------------------------------
// 7. Testing Horizon-Adaptive Specialization (Swing vs Day vs Scalp)
// -------------------------------------------------------------
console.log("\n--- 7. Testing Horizon-Adaptive Specialization (Swing vs Day vs Scalp) ---");

// 7.1 Horizon Resolution
const profileSwing = resolveTradeHorizon({ horizon: "swing" });
assert("Resolves Swing profile from horizon string", profileSwing.id === "swing" && profileSwing.horizonCode === 1, profileSwing);

const profileScalp = resolveTradeHorizon({ scenario: { id: "scalp", horizonCode: 3 } });
assert("Resolves Scalp profile from scenario", profileScalp.id === "scalp" && profileScalp.horizonCode === 3, profileScalp);

const profileDay = resolveTradeHorizon({ horizonCode: 2 });
assert("Resolves Day profile from horizonCode", profileDay.id === "day" && profileDay.horizonCode === 2, profileDay);

const profileDefault = resolveTradeHorizon({});
assert("Defaults to Day profile when unspecified", profileDefault.id === "day" && profileDefault.horizonCode === 2, profileDefault);

// 7.2 Swing Horizon Specialization
console.log("\n  [Testing Swing Specialization]");
const tradeSwing = {
  ...baseTradeBuy,
  _id: "trade_swing_001",
  horizon: "swing",
  horizonCode: 1,
  targetRR: 6.0,
  tpPrice: 1.0980,
};

// Swing in Asian/dead zone session is neutral (0), NOT penalized with -50
const offHoursDate = new Date("2026-10-07T22:00:00Z"); // 22:00 UTC = Asian consolidation / dead zone
const swingSession = evaluateSessionVolatility(tradeSwing, {}, profileSwing, offHoursDate);
assert("Swing trade is neutral (0) during Asian/dead zone sessions", swingSession.score === 0 && swingSession.sessionPhase === "SWING_HOLD_NEUTRAL", swingSession);

// Swing ignores micro 1.5R obstacles (requires >= 2.0R)
const microObsForSwing = [
  ...makeCandleSeries({ count: 10, startPrice: 1.0820, step: 0.0004, dir: 1 }),
  // Obstacle located at 1.6R from entry
  { time: 1700010000, open: 1.0845, high: 1.0850, low: 1.0844, close: 1.0848, volume: 1500 },
  { time: 1700013600, open: 1.0848, high: 1.0850, low: 1.0820, close: 1.0825, volume: 3000 },
  ...makeCandleSeries({ count: 10, startPrice: 1.0825, step: 0.0003, dir: 1 }),
];
const swingObsResult = evaluateOpposingObstacles({ H1: microObsForSwing }, tradeSwing, 1.0845, profileSwing);
assert("Swing trade ignores micro obstacles below 2.0R safe buffer", swingObsResult.obstacles.length === 0, swingObsResult.obstacles);

// Swing expansion allows target beyond 5.0R up to 10.0R
const synthSwingExpand = synthesizeRedecision({
  momentum: { score: 80, opposingMss: false, opposingWickRatio: 0.1 },
  obstacles: { score: 75, obstacles: [] },
  dol: { score: 80, status: "UNREACHED_MAGNET", targetPool: { price: 1.1040 } },
  smt: { score: 40 },
  session: { score: 20 },
  trade: tradeSwing, // current targetRR: 6.0R
  currentPrice: 1.0890,
  horizonConfig: profileSwing,
});
assert("Swing trade can expand target beyond 5.0R (got > 6.0R)", synthSwingExpand.action === "EXPAND_TP" && synthSwingExpand.newTargetRR > 6.0, synthSwingExpand.newTargetRR);
assert("Swing reason includes [SWG] tag", synthSwingExpand.reason.includes("[SWG]"), synthSwingExpand.reason);

// 7.3 Scalp Horizon Specialization
console.log("\n  [Testing Scalp Specialization]");
const tradeScalp = {
  ...baseTradeBuy,
  _id: "trade_scalp_001",
  horizon: "scalp",
  horizonCode: 3,
  targetRR: 1.8,
  tpPrice: 1.0854,
};

// Scalp in dead zone is heavily penalized (-70)
const scalpDeadZone = evaluateSessionVolatility(tradeScalp, {}, profileScalp, offHoursDate);
assert("Scalp trade in off-hours/dead zone is severely penalized (-70)", scalpDeadZone.score <= -60, scalpDeadZone.score);

// Scalp in dead zone triggers CLOSE_FULL_NOW
const synthScalpDeadZoneExit = synthesizeRedecision({
  momentum: { score: 10, opposingMss: false, opposingWickRatio: 0.2 },
  obstacles: { score: 20, obstacles: [] },
  dol: { score: 20, status: "CLEAR_RUNWAY" },
  smt: { score: 0 },
  session: { score: -70, sessionPhase: "DEAD_ZONE_PROHIBITIVE" },
  trade: tradeScalp,
  currentPrice: 1.0827,
  horizonConfig: profileScalp,
});
assert("Scalp trade aborts and closes full when session enters dead zone", synthScalpDeadZoneExit.action === "CLOSE_FULL_NOW", synthScalpDeadZoneExit.action);
assert("Scalp exit reason includes [SCP] tag", synthScalpDeadZoneExit.reason.includes("[SCP]"), synthScalpDeadZoneExit.reason);

// Scalp expansion is strictly capped at 2.5R maximum
const synthScalpExpand = synthesizeRedecision({
  momentum: { score: 90, opposingMss: false, opposingWickRatio: 0.05 },
  obstacles: { score: 85, obstacles: [] },
  dol: { score: 85, status: "UNREACHED_MAGNET", targetPool: { price: 1.0950 } }, // 5.0R macro level ahead
  smt: { score: 50 },
  session: { score: 70, sessionPhase: "PRIME_KILLZONE" },
  trade: tradeScalp,
  currentPrice: 1.0827,
  horizonConfig: profileScalp,
});
assert("Scalp trade expansion is capped strictly at 2.5R maximum", synthScalpExpand.action === "EXPAND_TP" && synthScalpExpand.newTargetRR <= 2.5, synthScalpExpand.newTargetRR);

// 7.4 Coordinator Multi-Horizon Integration
console.log("\n  [Testing Coordinator Multi-Horizon Integration]");
const coordSwing = await evaluateMilestoneRedecision({
  trade: tradeSwing,
  currentPrice: 1.0890,
  frames: {
    H4: expandingBars,
    H1: expandingBars,
    M15: expandingBars,
  },
});
assert("Coordinator recognizes Swing trade horizon", coordSwing.horizon === "swing" && coordSwing.horizonTag === "SWG", coordSwing.horizon);
assert("Coordinator logs Swing milestone (+3.0R for 6.0R trade)", coordSwing.milestoneR === 3.0, coordSwing.milestoneR);

const coordScalp = await evaluateMilestoneRedecision({
  trade: tradeScalp,
  currentPrice: 1.0827,
  frames: {
    M15: expandingBars,
    M5: expandingBars,
    M1: expandingBars,
  },
});
assert("Coordinator recognizes Scalp trade horizon", coordScalp.horizon === "scalp" && coordScalp.horizonTag === "SCP", coordScalp.horizon);
assert("Coordinator logs Scalp milestone (+0.9R for 1.8R trade)", coordScalp.milestoneR === 0.9, coordScalp.milestoneR);

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=======================================================");

if (failed > 0) {
  process.exit(1);
}
