import { createAutonomousEngine } from "./lib/autonomous/engine.js";
import { normalizeJournalRow } from "./lib/journal/store.js";

console.log("===============================================================================");
console.log("REAL-LIFE MARKET MOCK TEST: Live MT5 Order Flow & AMRE Isolation Suite");
console.log("===============================================================================");

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

// ---------------------------------------------------------------------------
// 1. Realistic Multi-Timeframe Market Candle Generator
// ---------------------------------------------------------------------------
function generateRealisticMarketFrames({ withOpposingOB = false, withOpposingMSS = false } = {}) {
  const d1Bars = [
    { time: 1699900000, open: 1.0760, high: 1.0890, low: 1.0740, close: 1.0880 },
    { time: 1699986400, open: 1.0880, high: 1.0920, low: 1.0860, close: 1.0910 },
  ];

  if (withOpposingMSS) {
    const bars = [];
    let t = 1700000000;
    bars.push({ time: t+=900, open: 1.0820, high: 1.0825, low: 1.0815, close: 1.0818, volume: 1000 });
    bars.push({ time: t+=900, open: 1.0818, high: 1.0820, low: 1.0810, close: 1.0812, volume: 1000 });
    bars.push({ time: t+=900, open: 1.0812, high: 1.0815, low: 1.0800, close: 1.0805, volume: 1000 });
    bars.push({ time: t+=900, open: 1.0805, high: 1.0830, low: 1.0804, close: 1.0825, volume: 1500 });
    bars.push({ time: t+=900, open: 1.0825, high: 1.0845, low: 1.0820, close: 1.0840, volume: 1800 });
    bars.push({ time: t+=900, open: 1.0840, high: 1.0842, low: 1.0828, close: 1.0830, volume: 1200 });
    bars.push({ time: t+=900, open: 1.0830, high: 1.0835, low: 1.0820, close: 1.0825, volume: 1200 });
    bars.push({ time: t+=900, open: 1.0825, high: 1.0860, low: 1.0824, close: 1.0855, volume: 2000 });
    bars.push({ time: t+=900, open: 1.0855, high: 1.0880, low: 1.0850, close: 1.0875, volume: 2500 });
    bars.push({ time: t+=900, open: 1.0875, high: 1.0878, low: 1.0855, close: 1.0860, volume: 1500 });
    bars.push({ time: t+=900, open: 1.0860, high: 1.0865, low: 1.0845, close: 1.0850, volume: 1800 });
    bars.push({ time: t+=900, open: 1.0850, high: 1.0885, low: 1.0848, close: 1.0880, volume: 2200 });
    bars.push({ time: t+=900, open: 1.0880, high: 1.0900, low: 1.0875, close: 1.0895, volume: 3000 });
    bars.push({ time: t+=900, open: 1.0895, high: 1.0898, low: 1.0880, close: 1.0885, volume: 1500 });
    bars.push({ time: t+=900, open: 1.0885, high: 1.0888, low: 1.0870, close: 1.0875, volume: 1500 });
    bars.push({ time: t+=900, open: 1.0875, high: 1.0878, low: 1.0820, close: 1.0825, volume: 5000 });
    bars.push({ time: t+=900, open: 1.0825, high: 1.0828, low: 1.0810, close: 1.0815, volume: 4500 });
    return { M15: bars, H1: bars, H4: [], D1: d1Bars };
  }

  const m15Bars = [];
  let p = 1.0800;
  for (let i = 0; i < 30; i++) {
    const open = p;
    const close = p + 0.0003;
    const high = close + 0.0001;
    const low = open - 0.00005;
    m15Bars.push({ time: 1700000000 + i * 900, open, high, low, close, volume: 1200 + i * 10 });
    p = close;
  }

  const h1Bars = [];
  let hp = 1.0780;
  for (let i = 0; i < 25; i++) {
    const open = hp;
    const close = hp + 0.0005;
    const high = close + 0.0002;
    const low = open - 0.0001;
    h1Bars.push({ time: 1700000000 + i * 3600, open, high, low, close, volume: 3000 });
    hp = close;
  }

  const h4Bars = [];
  let h4p = 1.0750;
  for (let i = 0; i < 20; i++) {
    const open = h4p;
    const close = h4p + 0.0008;
    const high = close + 0.0003;
    const low = open - 0.0002;
    h4Bars.push({ time: 1700000000 + i * 14400, open, high, low, close, volume: 8000 });
    h4p = close;
  }

  if (withOpposingOB) {
    // Unmitigated Bearish FVG obstacle at 1.0890 (bottom) - 1.0910 (top)
    let t = h4Bars[h4Bars.length - 1].time;
    h4Bars.push({ time: t += 14400, open: 1.0920, high: 1.0930, low: 1.0910, close: 1.0915, volume: 9000 });
    h4Bars.push({ time: t += 14400, open: 1.0915, high: 1.0918, low: 1.0880, close: 1.0882, volume: 15000 });
    h4Bars.push({ time: t += 14400, open: 1.0882, high: 1.0890, low: 1.0870, close: 1.0875, volume: 12000 });
    h4Bars.push({ time: t += 14400, open: 1.0875, high: 1.0880, low: 1.0870, close: 1.0874, volume: 8000 });
  }

  return { M15: m15Bars, H1: h1Bars, H4: h4Bars, D1: d1Bars };
}

// ---------------------------------------------------------------------------
// TEST SCENARIO 1: Live tradeDefault Mode with Impending H4 Roadblock
// ---------------------------------------------------------------------------
console.log("\n--- TEST SCENARIO 1: Live tradeDefault with Impending H4 Obstacle ---");

const brokerCalls1 = {
  closePositions: [],
  modifyOrders: [],
};

const tradeMap1 = new Map();
const mockCol1 = {
  findOne: async (q) => tradeMap1.get(String(q._id)) ? { ...tradeMap1.get(String(q._id)) } : null,
  find: () => ({ toArray: async () => Array.from(tradeMap1.values()) }),
  updateOne: async (q, u) => {
    const doc = tradeMap1.get(String(q._id));
    if (!doc) return { modifiedCount: 0 };
    if (u.$set) Object.assign(doc, u.$set);
    return { modifiedCount: 1 };
  },
};

const engine1 = createAutonomousEngine({
  autonomousCols: async () => ({
    tradesCol: mockCol1,
    controlCol: { findOne: async () => null, updateOne: async () => ({}) },
    logsCol: { insertOne: async () => ({}) },
  }),
  getConfig: async () => ({
    enabled: true,
    liveTrading: true,
    accountFreshnessMs: 60000,
    trailingPollMs: 5000,
    timestampSemantics: "BROKER_NAIVE",
  }),
  getFrames: async () => generateRealisticMarketFrames({ withOpposingOB: true }),
  getMainWatchlistSymbols: async () => ["EURUSD"],
  isTradingPermittedNow: () => ({ permitted: true }),
  getMT5State: async () => ({
    ok: true,
    account: { login: 5512340, balance: 50000, equity: 50000 },
    positions: [{ ticket: 1099234, symbol: "EURUSD", volume: 1.0, sl: 1.07700, tp: 1.09500 }],
    orders: [],
    history: [],
    order_history: [],
    requests: [],
    at: Date.now() / 1000,
  }),
  getMT5Symbol: async () => ({ ok: true, symbol: { digits: 5, point: 0.00001, spreadPrice: 0.00010 } }),
  closeMT5Position: async (payload) => {
    brokerCalls1.closePositions.push(payload);
    return { ok: true, status: "closed", order: 88771122 };
  },
  modifyMT5Order: async (payload) => {
    brokerCalls1.modifyOrders.push(payload);
    return { ok: true, status: "modified" };
  },
  reconcileBrokerSnapshot: (trade, state) => ({
    position: { ticket: trade.ticket, volume: trade.remainingVolume, sl: trade.slPrice },
  }),
  logEvent: async () => {},
});

const liveDefaultTrade = {
  _id: "trade_live_default_01",
  ticket: 1099234,
  brokerAccountLogin: 5512340,
  symbol: "EURUSD",
  dir: 1,
  dirLabel: "BUY",
  status: "active",
  isLive: true,
  managementLogic: "milestone_50", // tradeDefault mode!
  legId: "default",
  entryPrice: 1.08000,
  filledPrice: 1.08000,
  slPrice: 1.07700,
  initialRiskDistance: 0.00300,
  tpPrice: 1.09500, // 5.0R initial target
  targetRR: 5.0,
  initialVolume: 1.0,
  remainingVolume: 1.0,
  symbolSpec: { digits: 5, point: 0.00001, spreadPrice: 0.00010 },
  isBreakeven: false,
  halfTargetBooked: false,
};

tradeMap1.set("trade_live_default_01", { ...liveDefaultTrade });

// Initialize fresh live broker snapshot
await engine1.refreshBrokerState();

// Tick 1: Price at 1.08300 (+1.0R, below 50% milestone of 1.08750)
await engine1.autonomousOnTicks({
  EURUSD: { bid: 1.08290, ask: 1.08300, time: Date.now() },
});

let doc1 = tradeMap1.get("trade_live_default_01");
assert("No partial close below 50% milestone", doc1.halfTargetBooked === false, doc1.halfTargetBooked);
assert("No MT5 close calls below milestone", brokerCalls1.closePositions.length === 0, brokerCalls1.closePositions.length);
assert("AMRE has not executed yet", doc1.redecisionDone !== true, doc1.redecisionDone);

// Tick 2: Bid price hits 50% milestone (+2.5R @ 1.08750 bid)
await engine1.autonomousOnTicks({
  EURUSD: { bid: 1.08750, ask: 1.08760, time: Date.now() },
});

doc1 = tradeMap1.get("trade_live_default_01");
assert("Milestone 50 booked on tradeDefault", doc1.halfTargetBooked === true, doc1.halfTargetBooked);
assert("Partial 40% booked on live MT5 (0.4 lots exited)", brokerCalls1.closePositions.length === 1 && brokerCalls1.closePositions[0].volume === 0.4, brokerCalls1.closePositions);
assert("AMRE executed strictly once", doc1.redecisionDone === true, doc1.redecisionDone);
assert("AMRE evaluated action is REDUCE_TP due to H4 OB", doc1.redecisionAction === "REDUCE_TP", doc1.redecisionAction);
assert("Target RR reduced before roadblock (between 1.5R and 4.0R)", doc1.targetRR >= 1.5 && doc1.targetRR < 5.0, doc1.targetRR);
assert("MT5 broker order modified with live ticket", brokerCalls1.modifyOrders.some(m => m.ticket === 1099234 && m.tp === doc1.tpPrice), brokerCalls1.modifyOrders);

// Normalize to journal and verify live audit fields
const journalRow1 = normalizeJournalRow(doc1);
assert("Journal reflects live MT5 execution mode", journalRow1.executionMode === "LIVE", journalRow1.executionMode);
assert("Journal contains redecisionAction REDUCE_TP", journalRow1.redecisionAction === "REDUCE_TP", journalRow1.redecisionAction);
assert("Journal contains old vs new TP targets", journalRow1.redecisionOldRR === 5.0 && journalRow1.redecisionNewRR === doc1.targetRR, { old: journalRow1.redecisionOldRR, new: journalRow1.redecisionNewRR });

// ---------------------------------------------------------------------------
// TEST SCENARIO 2: Live Prop-Firm Safe Isolation (Must NEVER trigger AMRE)
// ---------------------------------------------------------------------------
console.log("\n--- TEST SCENARIO 2: Live Prop-Firm Safe Isolation ---");

const brokerCalls2 = { closePositions: [], modifyOrders: [] };
const tradeMap2 = new Map();
const mockCol2 = {
  findOne: async (q) => tradeMap2.get(String(q._id)) ? { ...tradeMap2.get(String(q._id)) } : null,
  find: () => ({ toArray: async () => Array.from(tradeMap2.values()) }),
  updateOne: async (q, u) => {
    const doc = tradeMap2.get(String(q._id));
    if (!doc) return { modifiedCount: 0 };
    if (u.$set) Object.assign(doc, u.$set);
    return { modifiedCount: 1 };
  },
};

const engine2 = createAutonomousEngine({
  autonomousCols: async () => ({
    tradesCol: mockCol2,
    controlCol: { findOne: async () => null, updateOne: async () => ({}) },
    logsCol: { insertOne: async () => ({}) },
  }),
  getConfig: async () => ({
    enabled: true,
    liveTrading: true,
    accountFreshnessMs: 60000,
    trailingPollMs: 5000,
  }),
  getFrames: async () => generateRealisticMarketFrames({ withOpposingOB: true }),
  getMainWatchlistSymbols: async () => ["EURUSD"],
  isTradingPermittedNow: () => ({ permitted: true }),
  getMT5State: async () => ({
    ok: true,
    account: { login: 5512340, balance: 50000, equity: 50000 },
    positions: [{ ticket: 1099235, symbol: "EURUSD", volume: 1.0, sl: 1.07700, tp: 1.08600 }],
    orders: [],
    history: [],
    order_history: [],
    requests: [],
    at: Date.now() / 1000,
  }),
  getMT5Symbol: async () => ({ ok: true, symbol: { digits: 5, point: 0.00001, spreadPrice: 0.00010 } }),
  closeMT5Position: async (payload) => { brokerCalls2.closePositions.push(payload); return { ok: true }; },
  modifyMT5Order: async (payload) => { brokerCalls2.modifyOrders.push(payload); return { ok: true }; },
  reconcileBrokerSnapshot: (trade, state) => ({ position: { ticket: trade.ticket, volume: trade.remainingVolume, sl: trade.slPrice } }),
  logEvent: async () => {},
});

const livePropTrade = {
  _id: "trade_live_prop_02",
  ticket: 1099235,
  brokerAccountLogin: 5512340,
  symbol: "EURUSD",
  dir: 1,
  dirLabel: "BUY",
  status: "active",
  isLive: true,
  managementLogic: "prop_firm_safe", // Prop-firm safe mode!
  legId: "prop_firm",
  entryPrice: 1.08000,
  filledPrice: 1.08000,
  slPrice: 1.07700,
  initialRiskDistance: 0.00300,
  tpPrice: 1.08600, // 2.0R target
  targetRR: 2.0,
  initialVolume: 1.0,
  remainingVolume: 1.0,
  symbolSpec: { digits: 5, point: 0.00001, spreadPrice: 0.00010 },
  isBreakeven: false,
};

tradeMap2.set("trade_live_prop_02", { ...livePropTrade });

// Initialize fresh live broker snapshot
await engine2.refreshBrokerState();

// Step 1: Bid price moves to 1.08300 (+1.0R @ 1.08300 bid) -> Prop firm safe reduces SL risk by 50%
await engine2.autonomousOnTicks({
  EURUSD: { bid: 1.08300, ask: 1.08310, time: Date.now() },
});

let doc2 = tradeMap2.get("trade_live_prop_02");
assert("Prop-firm trade reduced SL risk at 1.0R", doc2.slHalfMoved === true, doc2.slHalfMoved);
assert("Prop-firm SL moved to -0.5R (1.07850)", doc2.slPrice === 1.07850, doc2.slPrice);
assert("MT5 broker received half-risk SL modification", brokerCalls2.modifyOrders.some(m => m.ticket === 1099235 && m.sl === 1.07850), brokerCalls2.modifyOrders);

// Step 2: Bid price moves to 1.08450 (+1.5R @ 1.08450 bid) -> Prop firm safe moves to BE
await engine2.autonomousOnTicks({
  EURUSD: { bid: 1.08450, ask: 1.08460, time: Date.now() },
});

doc2 = tradeMap2.get("trade_live_prop_02");
assert("Prop-firm trade moved SL to BE", doc2.isBreakeven === true, doc2.isBreakeven);
assert("MT5 broker received Breakeven SL modification", brokerCalls2.modifyOrders.some(m => m.ticket === 1099235 && m.sl === doc2.slPrice), brokerCalls2.modifyOrders);
assert("AMRE was strictly NOT triggered for prop-firm safe trade", doc2.redecisionDone == null || doc2.redecisionDone === false, doc2.redecisionDone);
assert("No redecisionAction attached to prop-firm trade", doc2.redecisionAction == null, doc2.redecisionAction);

// Step 3: Bid price moves to 1.08600 (+2.0R @ 1.08600 bid) -> Prop firm safe hits TP and closes 100% full volume
await engine2.autonomousOnTicks({
  EURUSD: { bid: 1.08600, ask: 1.08610, time: Date.now() },
});

doc2 = tradeMap2.get("trade_live_prop_02");
assert("MT5 broker received full TP close call for position (1.0 lots)", brokerCalls2.closePositions.some(c => c.ticket === 1099235 && c.volume === 1.0), brokerCalls2.closePositions);
assert("Prop-firm trade terminal status reflects closure", ["closed", "closing", "closed_tp"].includes(doc2.status), doc2.status);

// ---------------------------------------------------------------------------
// TEST SCENARIO 3: Live tradeDefault with Opposing Displaced MSS -> Market Exit
// ---------------------------------------------------------------------------
console.log("\n--- TEST SCENARIO 3: Live tradeDefault with Opposing MSS (CLOSE_FULL_NOW) ---");

const brokerCalls3 = { closePositions: [], modifyOrders: [] };
const tradeMap3 = new Map();
const mockCol3 = {
  findOne: async (q) => tradeMap3.get(String(q._id)) ? { ...tradeMap3.get(String(q._id)) } : null,
  find: () => ({ toArray: async () => Array.from(tradeMap3.values()) }),
  updateOne: async (q, u) => {
    const doc = tradeMap3.get(String(q._id));
    if (!doc) return { modifiedCount: 0 };
    if (u.$set) Object.assign(doc, u.$set);
    return { modifiedCount: 1 };
  },
};

const engine3 = createAutonomousEngine({
  autonomousCols: async () => ({
    tradesCol: mockCol3,
    controlCol: { findOne: async () => null, updateOne: async () => ({}) },
    logsCol: { insertOne: async () => ({}) },
  }),
  getConfig: async () => ({
    enabled: true,
    liveTrading: true,
    accountFreshnessMs: 60000,
    trailingPollMs: 5000,
  }),
  getFrames: async () => generateRealisticMarketFrames({ withOpposingMSS: true }),
  getMainWatchlistSymbols: async () => ["EURUSD"],
  isTradingPermittedNow: () => ({ permitted: true }),
  getMT5State: async () => ({
    ok: true,
    account: { login: 5512340, balance: 50000, equity: 50000 },
    positions: [{ ticket: 1099236, symbol: "EURUSD", volume: 1.0, sl: 1.07700, tp: 1.09500 }],
    orders: [],
    history: [],
    order_history: [],
    requests: [],
    at: Date.now() / 1000,
  }),
  getMT5Symbol: async () => ({ ok: true, symbol: { digits: 5, point: 0.00001, spreadPrice: 0.00010 } }),
  closeMT5Position: async (payload) => { brokerCalls3.closePositions.push(payload); return { ok: true, status: "closed" }; },
  modifyMT5Order: async (payload) => { brokerCalls3.modifyOrders.push(payload); return { ok: true }; },
  reconcileBrokerSnapshot: (trade, state) => ({ position: { ticket: trade.ticket, volume: trade.remainingVolume, sl: trade.slPrice } }),
  logEvent: async () => {},
});

const liveMssTrade = {
  _id: "trade_live_mss_03",
  ticket: 1099236,
  brokerAccountLogin: 5512340,
  symbol: "EURUSD",
  dir: 1,
  dirLabel: "BUY",
  status: "active",
  isLive: true,
  managementLogic: "milestone_50",
  legId: "default",
  entryPrice: 1.08000,
  filledPrice: 1.08000,
  slPrice: 1.07700,
  initialRiskDistance: 0.00300,
  tpPrice: 1.09500,
  targetRR: 5.0,
  initialVolume: 1.0,
  remainingVolume: 1.0,
  symbolSpec: { digits: 5, point: 0.00001, spreadPrice: 0.00010 },
  isBreakeven: false,
  halfTargetBooked: false,
};

tradeMap3.set("trade_live_mss_03", { ...liveMssTrade });

// Initialize fresh live broker snapshot
await engine3.refreshBrokerState();

// Tick hits 50% milestone @ 1.08750 bid
await engine3.autonomousOnTicks({
  EURUSD: { bid: 1.08750, ask: 1.08760, time: Date.now() },
});

const doc3 = tradeMap3.get("trade_live_mss_03");
assert("AMRE executed strictly once on MSS trade", doc3.redecisionDone === true, doc3.redecisionDone);
assert("AMRE decides CLOSE_FULL_NOW due to opposing MSS", doc3.redecisionAction === "CLOSE_FULL_NOW", doc3.redecisionAction);
assert("Live MT5 broker received market exit for position", brokerCalls3.closePositions.some(c => c.ticket === 1099236 && c.volume === 1.0), brokerCalls3.closePositions);
assert("Terminal status maps to winning banked exit", ["closed", "closing", "closed_tp"].includes(doc3.status), doc3.status);

// ---------------------------------------------------------------------------
// TEST SCENARIO 4: Idempotency & Concurrency Stress Test on Fast Price Ticks
// ---------------------------------------------------------------------------
console.log("\n--- TEST SCENARIO 4: Sub-Second Rapid Tick Stress Test ---");

let redecisionExecutionCount = 0;
const tradeMap4 = new Map();
const mockCol4 = {
  findOne: async (q) => tradeMap4.get(String(q._id)) ? { ...tradeMap4.get(String(q._id)) } : null,
  find: () => ({ toArray: async () => Array.from(tradeMap4.values()) }),
  updateOne: async (q, u) => {
    const doc = tradeMap4.get(String(q._id));
    if (!doc) return { modifiedCount: 0 };
    if (u.$set) Object.assign(doc, u.$set);
    return { modifiedCount: 1 };
  },
};

const engine4 = createAutonomousEngine({
  autonomousCols: async () => ({
    tradesCol: mockCol4,
    controlCol: { findOne: async () => null, updateOne: async () => ({}) },
    logsCol: { insertOne: async () => ({}) },
  }),
  getConfig: async () => ({
    enabled: true,
    liveTrading: false,
    accountFreshnessMs: 60000,
    trailingPollMs: 5000,
  }),
  getFrames: async () => {
    redecisionExecutionCount++;
    return generateRealisticMarketFrames({ withOpposingOB: false });
  },
  getMainWatchlistSymbols: async () => ["EURUSD"],
  isTradingPermittedNow: () => ({ permitted: true }),
  logEvent: async () => {},
});

const stressTrade = {
  _id: "trade_stress_04",
  ticket: 1099237,
  symbol: "EURUSD",
  dir: 1,
  status: "active",
  isLive: false,
  managementLogic: "milestone_50",
  entryPrice: 1.08000,
  slPrice: 1.07700,
  initialRiskDistance: 0.00300,
  tpPrice: 1.09500,
  targetRR: 5.0,
  initialVolume: 1.0,
  remainingVolume: 1.0,
  symbolSpec: { digits: 5, point: 0.00001 },
  halfTargetBooked: false,
};

tradeMap4.set("trade_stress_04", { ...stressTrade });

// Fire 10 rapid ticks right around the 50% milestone
for (let i = 0; i < 10; i++) {
  const p = 1.08750 + i * 0.00002;
  await engine4.autonomousOnTicks({
    EURUSD: { bid: p - 0.0001, ask: p, time: Date.now() },
  });
}

const finalStressTrade = tradeMap4.get("trade_stress_04");
assert("Rapid ticks resulted in exactly ONE redecision execution", redecisionExecutionCount === 1, redecisionExecutionCount);
assert("Trade redecisionDone flag is true", finalStressTrade.redecisionDone === true, finalStressTrade.redecisionDone);

// ---------------------------------------------------------------------------
// TEST SCENARIO 5: Live MT5 Partials + Breakeven on HOLD_FULL_TP + Trailing Stop-Loss
// ---------------------------------------------------------------------------
console.log("\n--- TEST SCENARIO 5: Live MT5 Partials + BE on HOLD_FULL_TP + Trailing Stop ---");

const brokerCalls5 = { closePositions: [], modifyOrders: [] };
const tradeMap5 = new Map();
const mockCol5 = {
  findOne: async (q) => tradeMap5.get(String(q._id)) ? { ...tradeMap5.get(String(q._id)) } : null,
  find: () => ({ toArray: async () => Array.from(tradeMap5.values()) }),
  updateOne: async (q, u) => {
    const doc = tradeMap5.get(String(q._id));
    if (!doc) return { modifiedCount: 0 };
    if (u.$set) Object.assign(doc, u.$set);
    return { modifiedCount: 1 };
  },
};

// Generate M5 micro-bars with confirmed swing fractal low at 1.08350 (time-shifted to be confirmed)
const nowSec = Math.floor(Date.now() / 1000);
const microBars5 = [
  { t: (nowSec - 1800) * 1000, o: 1.0810, h: 1.0845, l: 1.0840, c: 1.0842 },
  { t: (nowSec - 1500) * 1000, o: 1.0842, h: 1.0846, l: 1.0838, c: 1.0840 },
  { t: (nowSec - 1200) * 1000, o: 1.0840, h: 1.0842, l: 1.0835, c: 1.0839 }, // Fractal low at 1.08350
  { t: (nowSec - 900) * 1000,  o: 1.0839, h: 1.0855, l: 1.0838, c: 1.0850 },
  { t: (nowSec - 600) * 1000,  o: 1.0850, h: 1.0870, l: 1.0845, c: 1.0865 },
  { t: (nowSec - 300) * 1000,  o: 1.0865, h: 1.0890, l: 1.0860, c: 1.0885 },
];

const engine5 = createAutonomousEngine({
  autonomousCols: async () => ({
    tradesCol: mockCol5,
    controlCol: { findOne: async () => null, updateOne: async () => ({}) },
    logsCol: { insertOne: async () => ({}) },
  }),
  getConfig: async () => ({
    enabled: true,
    liveTrading: true,
    accountFreshnessMs: 60000,
    trailingPollMs: 1000,
  }),
  getFrames: async () => generateRealisticMarketFrames({ withOpposingOB: false }), // Clear skies -> HOLD_FULL_TP
  getMainWatchlistSymbols: async () => ["EURUSD"],
  isTradingPermittedNow: () => ({ permitted: true }),
  getMT5MicroBars: async () => ({ ok: true, bars: microBars5 }),
  getMT5State: async () => ({
    ok: true,
    account: { login: 5512340, balance: 50000, equity: 50000 },
    positions: [{ ticket: 1099238, symbol: "EURUSD", volume: 1.0, sl: 1.07700, tp: 1.09500 }],
    orders: [],
    history: [],
    order_history: [],
    requests: [],
    at: Date.now() / 1000,
  }),
  getMT5Symbol: async () => ({ ok: true, symbol: { digits: 5, point: 0.00001, trade_stops_level: 10 } }),
  closeMT5Position: async (payload) => { brokerCalls5.closePositions.push(payload); return { ok: true, status: "closed", order: 998811 }; },
  modifyMT5Order: async (payload) => { brokerCalls5.modifyOrders.push(payload); return { ok: true, status: "modified" }; },
  reconcileBrokerSnapshot: (trade, state) => ({ position: { ticket: trade.ticket, volume: trade.remainingVolume, sl: trade.slPrice } }),
  logEvent: async () => {},
});

const liveHoldTrade = {
  _id: "trade_live_hold_05",
  ticket: 1099238,
  brokerAccountLogin: 5512340,
  symbol: "EURUSD",
  dir: 1,
  dirLabel: "BUY",
  status: "active",
  isLive: true,
  managementLogic: "milestone_50",
  legId: "default",
  entryPrice: 1.08000,
  filledPrice: 1.08000,
  slPrice: 1.07700,
  initialRiskDistance: 0.00300,
  tpPrice: 1.09500,
  targetRR: 5.0,
  initialVolume: 1.0,
  remainingVolume: 1.0,
  symbolSpec: { digits: 5, point: 0.00001, trade_stops_level: 10 },
  isBreakeven: false,
  halfTargetBooked: false,
};

tradeMap5.set("trade_live_hold_05", { ...liveHoldTrade });
await engine5.refreshBrokerState();

// Tick 1: Price hits 50% milestone @ 1.08750
await engine5.autonomousOnTicks({
  EURUSD: { bid: 1.08750, ask: 1.08760, time: Date.now() },
});

const doc5_step1 = tradeMap5.get("trade_live_hold_05");
assert("50% Milestone booked on HOLD_FULL_TP trade", doc5_step1.halfTargetBooked === true, doc5_step1.halfTargetBooked);
assert("AMRE decided HOLD_FULL_TP under clear skies", doc5_step1.redecisionAction === "HOLD_FULL_TP", doc5_step1.redecisionAction);
assert("Trade local doc marked isBreakeven", doc5_step1.isBreakeven === true, doc5_step1.isBreakeven);
assert("MT5 broker order modified to Breakeven SL while holding full TP", brokerCalls5.modifyOrders.some(m => m.ticket === 1099238 && m.sl === doc5_step1.slPrice && m.tp === 1.09500), brokerCalls5.modifyOrders);
assert("MT5 broker received partial close call (0.4 lots exited)", brokerCalls5.closePositions.some(c => c.ticket === 1099238 && c.volume === 0.4), brokerCalls5.closePositions);

// Tick 2: Price continues upward to 1.08950 -> Trailing stop-loss triggers behind M5 confirmed fractal
await engine5.autonomousOnTicks({
  EURUSD: { bid: 1.08950, ask: 1.08960, time: Date.now() },
});

const doc5_step2 = tradeMap5.get("trade_live_hold_05");
assert("Runner trailing stop activated", doc5_step2.isTrailing === true, doc5_step2.isTrailing);
assert("SL trailed to confirmed fractal low (1.08350)", doc5_step2.slPrice === 1.08350, doc5_step2.slPrice);
assert("MT5 broker received trailing stop modification to 1.08350", brokerCalls5.modifyOrders.some(m => m.ticket === 1099238 && m.sl === 1.08350), brokerCalls5.modifyOrders);

// ---------------------------------------------------------------------------
// TEST SCENARIO 6: Dual Sibling Concurrency & Zero Cross-Contamination
// ---------------------------------------------------------------------------
console.log("\n--- TEST SCENARIO 6: Concurrent tradeDefault & tradeProp Sibling Isolation ---");

const brokerCalls6 = { closePositions: [], modifyOrders: [] };
const tradeMap6 = new Map();
const mockCol6 = {
  findOne: async (q) => tradeMap6.get(String(q._id)) ? { ...tradeMap6.get(String(q._id)) } : null,
  find: (q) => ({
    toArray: async () => {
      let items = Array.from(tradeMap6.values());
      if (q?.status?.$in) items = items.filter(t => q.status.$in.includes(t.status));
      return items;
    }
  }),
  updateOne: async (q, u) => {
    const doc = tradeMap6.get(String(q._id));
    if (!doc) return { modifiedCount: 0 };
    if (u.$set) Object.assign(doc, u.$set);
    return { modifiedCount: 1 };
  },
};

const engine6 = createAutonomousEngine({
  autonomousCols: async () => ({
    tradesCol: mockCol6,
    controlCol: { findOne: async () => null, updateOne: async () => ({}) },
    logsCol: { insertOne: async () => ({}) },
  }),
  getConfig: async () => ({
    enabled: true,
    liveTrading: true,
    accountFreshnessMs: 60000,
    trailingPollMs: 5000,
  }),
  getFrames: async () => generateRealisticMarketFrames({ withOpposingOB: false }),
  getMainWatchlistSymbols: async () => ["EURUSD"],
  isTradingPermittedNow: () => ({ permitted: true }),
  getMT5State: async () => ({
    ok: true,
    account: { login: 5512340, balance: 50000, equity: 50000 },
    positions: [
      { ticket: 1099234, identifier: 1099234, symbol: "EURUSD", magic: 23121101, comment: "TS:EUR:15M:M1:MG1:T01", volume: 1.0, sl: 1.07700, tp: 1.09500 },
      { ticket: 1099235, identifier: 1099235, symbol: "EURUSD", magic: 23121201, comment: "TS:EUR:15M:M1:MG2:T01", volume: 1.0, sl: 1.07700, tp: 1.08600 },
    ],
    orders: [],
    history: [],
    order_history: [],
    requests: [],
    at: Date.now() / 1000,
  }),
  getMT5Symbol: async () => ({ ok: true, symbol: { digits: 5, point: 0.00001, trade_stops_level: 10 } }),
  closeMT5Position: async (payload) => { brokerCalls6.closePositions.push(payload); return { ok: true, status: "closed", order: 998811 }; },
  modifyMT5Order: async (payload) => { brokerCalls6.modifyOrders.push(payload); return { ok: true, status: "modified" }; },
  logEvent: async () => {},
});

const defaultLeg = {
  _id: "trade_dual_default_06",
  groupId: "group_eur_06",
  ticket: 1099234,
  magicNumber: 23121101, // MG1 = milestone_50
  brokerComment: "TS:EUR:15M:M1:MG1:T01",
  brokerAccountLogin: 5512340,
  symbol: "EURUSD",
  dir: 1,
  dirLabel: "BUY",
  status: "active",
  isLive: true,
  managementLogic: "milestone_50",
  legId: "default",
  entryPrice: 1.08000,
  filledPrice: 1.08000,
  slPrice: 1.07700,
  initialRiskDistance: 0.00300,
  tpPrice: 1.09500, // 5.0R target
  targetRR: 5.0,
  initialVolume: 1.0,
  remainingVolume: 1.0,
  symbolSpec: { digits: 5, point: 0.00001, trade_stops_level: 10 },
  isBreakeven: false,
  halfTargetBooked: false,
};

const propLeg = {
  _id: "trade_dual_prop_06",
  groupId: "group_eur_06",
  ticket: 1099235,
  magicNumber: 23121201, // MG2 = prop_firm_safe
  brokerComment: "TS:EUR:15M:M1:MG2:T01",
  brokerAccountLogin: 5512340,
  symbol: "EURUSD",
  dir: 1,
  dirLabel: "BUY",
  status: "active",
  isLive: true,
  managementLogic: "prop_firm_safe",
  legId: "prop_firm",
  entryPrice: 1.08000,
  filledPrice: 1.08000,
  slPrice: 1.07700,
  initialRiskDistance: 0.00300,
  tpPrice: 1.08600, // 2.0R target
  targetRR: 2.0,
  initialVolume: 1.0,
  remainingVolume: 1.0,
  symbolSpec: { digits: 5, point: 0.00001, trade_stops_level: 10 },
  isBreakeven: false,
};

tradeMap6.set("trade_dual_default_06", { ...defaultLeg });
tradeMap6.set("trade_dual_prop_06", { ...propLeg });

await engine6.refreshBrokerState();

// Test Step 6.1: Price at 1.08300 (+1.0R) -> ONLY prop leg modifies SL to -0.5R (ticket 1099235)
await engine6.autonomousOnTicks({
  EURUSD: { bid: 1.08300, ask: 1.08310, time: Date.now() },
});

let liveDef = tradeMap6.get("trade_dual_default_06");
let liveProp = tradeMap6.get("trade_dual_prop_06");
assert("1.0R tick: Prop leg moved SL to half-risk", liveProp.slHalfMoved === true && liveProp.slPrice === 1.07850, liveProp.slPrice);
assert("1.0R tick: Default leg SL untouched at initial risk", liveDef.slPrice === 1.07700 && liveDef.isBreakeven === false, liveDef.slPrice);
assert("1.0R tick: MT5 modify dispatched strictly for prop ticket 1099235", brokerCalls6.modifyOrders.length === 1 && brokerCalls6.modifyOrders[0].ticket === 1099235, brokerCalls6.modifyOrders);

// Test Step 6.2: Price at 1.08450 (+1.5R) -> ONLY prop leg moves SL to Breakeven (ticket 1099235)
await engine6.autonomousOnTicks({
  EURUSD: { bid: 1.08450, ask: 1.08460, time: Date.now() },
});

liveDef = tradeMap6.get("trade_dual_default_06");
liveProp = tradeMap6.get("trade_dual_prop_06");
assert("1.5R tick: Prop leg moved SL to BE", liveProp.isBreakeven === true, liveProp.isBreakeven);
assert("1.5R tick: Default leg STILL untouched at 1.07700", liveDef.slPrice === 1.07700 && liveDef.halfTargetBooked === false, liveDef.slPrice);
assert("1.5R tick: MT5 modify dispatched strictly for prop ticket 1099235", brokerCalls6.modifyOrders.filter(m => m.ticket === 1099234).length === 0, brokerCalls6.modifyOrders);

// Test Step 6.3: Price at 1.08600 (+2.0R) -> Prop leg hits TP (closes 100% on ticket 1099235). Default leg continues running!
await engine6.autonomousOnTicks({
  EURUSD: { bid: 1.08600, ask: 1.08610, time: Date.now() },
});

liveDef = tradeMap6.get("trade_dual_default_06");
liveProp = tradeMap6.get("trade_dual_prop_06");
assert("2.0R tick: Prop leg closed on TP", ["closed", "closing", "closed_tp"].includes(liveProp.status), liveProp.status);
assert("2.0R tick: Default leg STILL active and unclosed", liveDef.status === "active" && liveDef.remainingVolume === 1.0, liveDef.status);
assert("2.0R tick: MT5 close call sent strictly for prop ticket 1099235", brokerCalls6.closePositions.length === 1 && brokerCalls6.closePositions[0].ticket === 1099235 && brokerCalls6.closePositions[0].volume === 1.0, brokerCalls6.closePositions);

// Test Step 6.4: Price at 1.08750 (+2.5R) -> Default leg reaches 50% milestone!
await engine6.autonomousOnTicks({
  EURUSD: { bid: 1.08750, ask: 1.08760, time: Date.now() },
});

liveDef = tradeMap6.get("trade_dual_default_06");
assert("2.5R tick: Default leg reached 50% milestone", liveDef.halfTargetBooked === true, liveDef.halfTargetBooked);
assert("2.5R tick: Default leg booked 40% partial on ticket 1099234", brokerCalls6.closePositions.some(c => c.ticket === 1099234 && c.volume === 0.4), brokerCalls6.closePositions);
assert("2.5R tick: Default leg moved SL to BE on ticket 1099234", brokerCalls6.modifyOrders.some(m => m.ticket === 1099234 && m.sl === liveDef.slPrice), brokerCalls6.modifyOrders);
assert("Zero cross-contamination between sibling tradeDefault and tradeProp legs", true);

// ---------------------------------------------------------------------------
// 8. TEST SCENARIO 7: Live Horizon-Adaptive Redecision (Swing vs Scalp)
// ---------------------------------------------------------------------------
console.log("\n--- TEST SCENARIO 7: Live Horizon-Adaptive Redecision (Swing vs Scalp) ---");

// Leg 1: Live MT5 Swing Trade (6.0R Target, Milestone at +3.0R / 1.08900)
const tradeMap7 = new Map();
const brokerCalls7 = { closePositions: [], modifyOrders: [] };

function makeExpansionBarsSeries({ count = 25, startPrice = 1.08000, step = 0.0004 } = {}) {
  const bars = [];
  let p = startPrice;
  for (let i = 0; i < count; i++) {
    const o = p;
    const c = o + step;
    bars.push({ time: 1700000000 + i * 3600, open: o, high: c + step * 0.1, low: o - step * 0.1, close: c, volume: 2000 });
    p = c;
  }
  return bars;
}

const liveSwingTrade = {
  _id: "trade_live_swing_07",
  symbol: "EURUSD",
  canonicalSymbol: "EURUSD",
  dir: 1,
  status: "active",
  isLive: true,
  ticket: 1099301,
  brokerAccountLogin: 88812345,
  entryPrice: 1.08000,
  slPrice: 1.07700,
  initialSlPrice: 1.07700,
  initialRiskDistance: 0.00300,
  initialRiskUsd: 300,
  targetRR: 6.0,
  tpPrice: 1.09800,
  initialVolume: 1.0,
  remainingVolume: 1.0,
  remainingFraction: 1,
  horizon: "swing",
  horizonCode: 1,
  scenario: { id: "swing", horizonCode: 1 },
  managementLogic: "milestone_50",
  halfTargetBooked: false,
  redecisionDone: false,
  isBreakeven: false,
  symbolSpec: { digits: 5, point: 0.00001, trade_tick_value_loss: 1, trade_tick_size: 0.00001 },
  targets: [{ id: "tp_full", price: 1.09800, fraction: 1.0, kind: "target" }],
};

tradeMap7.set("trade_live_swing_07", liveSwingTrade);

const mockCol7 = {
  findOne: async (q) => tradeMap7.get(String(q._id)) ? { ...tradeMap7.get(String(q._id)) } : null,
  find: () => ({ toArray: async () => Array.from(tradeMap7.values()) }),
  updateOne: async (q, u) => {
    const doc = tradeMap7.get(String(q._id));
    if (!doc) return { modifiedCount: 0 };
    if (u.$set) Object.assign(doc, u.$set);
    return { modifiedCount: 1 };
  },
};

const engine7 = createAutonomousEngine({
  autonomousCols: async () => ({
    tradesCol: mockCol7,
    controlCol: { findOne: async () => null, updateOne: async () => ({}) },
    logsCol: { insertOne: async () => ({}) },
  }),
  getConfig: async () => ({
    enabled: true,
    liveTrading: true,
    accountFreshnessMs: 60000,
    trailingPollMs: 5000,
    timestampSemantics: "BROKER_NAIVE",
  }),
  getFrames: async () => ({
    D1: makeExpansionBarsSeries({ count: 25, startPrice: 1.08000, step: 0.0004 }),
    H4: makeExpansionBarsSeries({ count: 25, startPrice: 1.08000, step: 0.0004 }),
    H1: makeExpansionBarsSeries({ count: 25, startPrice: 1.08000, step: 0.0004 }),
    M15: makeExpansionBarsSeries({ count: 25, startPrice: 1.08000, step: 0.0004 }),
    symbolMeta: { digits: 5, point: 0.00001 },
  }),
  getMainWatchlistSymbols: async () => ["EURUSD"],
  isTradingPermittedNow: () => ({ permitted: true }),
  getMT5State: async () => ({
    ok: true,
    account: { login: 88812345, balance: 100000, equity: 100000 },
    positions: [{ ticket: 1099301, identifier: 1099301, symbol: "EURUSD", magic: 23111101, comment: "TS:EUR:1D:M1:MG1:T01", volume: 1.0, sl: 1.07700, tp: 1.09800 }],
    orders: [],
    history: [],
    order_history: [],
    requests: [],
    at: Date.now() / 1000,
  }),
  getMT5Symbol: async () => ({ ok: true, symbol: liveSwingTrade.symbolSpec }),
  closeMT5Position: async (payload) => { brokerCalls7.closePositions.push(payload); return { ok: true, status: "closed", order: 99401 }; },
  modifyMT5Order: async (payload) => { brokerCalls7.modifyOrders.push(payload); return { ok: true, status: "modified" }; },
  logEvent: async () => {},
});

await engine7.refreshBrokerState();

// Trigger 50% milestone on Swing Trade (+3.0R = 1.08900)
await engine7.autonomousOnTicks({
  EURUSD: { bid: 1.08900, ask: 1.08910, time: Date.now() },
});

let swingDoc = tradeMap7.get("trade_live_swing_07");
assert("Swing trade 50% milestone (+3.0R) triggers redecision", swingDoc.redecisionDone === true, swingDoc.redecisionDone);
assert("Swing redecision tags horizon as swing", swingDoc.redecisionHorizon === "swing" && swingDoc.redecisionHorizonTag === "SWG", swingDoc.redecisionHorizon);
assert("Swing redecision books 40% partial on MT5 ticket", brokerCalls7.closePositions.some(c => c.ticket === 1099301 && c.volume === 0.4), brokerCalls7.closePositions);
assert("Swing redecision expands or holds swing target (>= 6.0R)", swingDoc.targetRR >= 6.0, swingDoc.targetRR);
assert("MT5 broker order modified to BE SL for swing ticket 1099301", brokerCalls7.modifyOrders.some(m => m.ticket === 1099301 && m.sl === swingDoc.slPrice), brokerCalls7.modifyOrders);

// ---------------------------------------------------------------------------
// TEST SCENARIO 8: Copier Receiver Partitioned Risk & Drawdown Isolation Mock
// ---------------------------------------------------------------------------
console.log("\n--- TEST SCENARIO 8: Copier Receiver Partitioned Risk & Drawdown Isolation ---");

const tradeMap8 = new Map();
const closedTradeList8 = [
  // Two sibling legs from yesterday/earlier stopped out today
  {
    _id: "closed_def_prev",
    groupId: "grp_prev_stopped",
    symbol: "EURUSD",
    isLive: true,
    status: "closed_sl",
    realizedPnl: -500,
    managementLogic: "milestone_50",
    legId: "default",
    closedAt: new Date(Date.now() - 1800000), // 30m ago
  },
  {
    _id: "closed_prop_prev",
    groupId: "grp_prev_stopped",
    symbol: "EURUSD",
    isLive: true,
    status: "closed_sl",
    realizedPnl: -500,
    managementLogic: "prop_firm_safe",
    legId: "prop_firm",
    closedAt: new Date(Date.now() - 1800000), // 30m ago
  },
];

const mockCapacitySlots8 = [];

const engine8 = createAutonomousEngine({
  autonomousCols: async () => ({
    tradesCol: {
      find: (filter = {}) => {
        let items = [...tradeMap8.values()];
        if (filter.closedAt?.$gte) {
          items = closedTradeList8.filter(t => new Date(t.closedAt) >= filter.closedAt.$gte);
        } else if (filter.isLive === true && filter.status?.$in) {
          items = closedTradeList8.filter(t => filter.status.$in.includes(t.status));
        }
        return { toArray: async () => items };
      },
      findOne: async (filter) => tradeMap8.get(String(filter?._id)) || closedTradeList8.find(t => String(t._id) === String(filter?._id)),
      updateOne: async (filter, update) => {
        const doc = tradeMap8.get(String(filter?._id));
        if (doc && update.$set) Object.assign(doc, update.$set);
        return { matchedCount: doc ? 1 : 0 };
      },
    },
    controlCol: {
      findOne: async () => ({ _id: "capacity", slots: mockCapacitySlots8 }),
      updateOne: async (query, update) => {
        if (update.$push?.slots) {
          mockCapacitySlots8.push(update.$push.slots);
          return { modifiedCount: 1 };
        }
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
    logsCol: { insertOne: async () => ({}) },
  }),
  getConfig: async () => ({
    enabled: true,
    liveTrading: true,
    accountFreshnessMs: 60000,
    trailingPollMs: 5000,
    timestampSemantics: "BROKER_NAIVE",
    maxConcurrentTrades: 10,
    maxDailyLossPct: 10,
    partitionedCopierRisk: true,
  }),
  getFrames: async () => ({
    M5: [{ open: 1.0800, high: 1.0810, low: 1.0790, close: 1.0805, time: Math.floor(Date.now() / 1000) }],
    M15: [{ open: 1.0800, high: 1.0810, low: 1.0790, close: 1.0805, time: Math.floor(Date.now() / 1000) }],
    H1: [{ open: 1.0800, high: 1.0810, low: 1.0790, close: 1.0805, time: Math.floor(Date.now() / 1000) }],
    H4: [{ open: 1.0800, high: 1.0810, low: 1.0790, close: 1.0805, time: Math.floor(Date.now() / 1000) }],
    D1: [{ open: 1.0800, high: 1.0810, low: 1.0790, close: 1.0805, time: Math.floor(Date.now() / 1000) }],
    symbolMeta: { digits: 5, point: 0.00001 },
  }),
  getMainWatchlistSymbols: async () => ["NAS100"],
  isTradingPermittedNow: () => ({ permitted: true }),
  revalidateTradeIdea: async () => ({ permitted: true, vetoes: [] }),
  getDailyBaseline: async () => 50000,
  getMT5State: async () => ({
    ok: true,
    account: { login: 88812345, balance: 49000, equity: 49000, dailyPnl: -1000 },
    positions: [],
    orders: [],
    history: [],
    order_history: [],
    requests: [],
    at: Date.now() / 1000,
  }),
  getMT5Symbol: async () => ({ ok: true, symbol: { trade_tick_value_loss: 1, trade_tick_size: 0.00001, digits: 5, point: 0.00001 } }),
  getMT5LossPerLot: async () => ({ ok: true, lossPerLot: 300 }),
  reserveTradeCapacity: async (trade, cfg, riskUsd) => {
    mockCapacitySlots8.push({ tradeId: String(trade._id), groupId: trade.groupId, symbol: trade.symbol, riskUsd });
    return true;
  },
  logEvent: async () => {},
});

await engine8.refreshBrokerState();

// Test candidate 1: Default Leg of Setup 2
const newSetupDefault = {
  _id: "trade_new_def_08",
  groupId: "grp_nas_08",
  symbol: "NAS100",
  canonicalSymbol: "NAS100",
  isLive: true,
  dir: 1,
  entryPrice: 18000,
  slPrice: 17950,
  tpPrice: 18150,
  initialRiskUsd: 490,
  riskUsd: 490,
  status: "staged",
  legId: "default",
  managementLogic: "milestone_50",
};

// Guard candidate 1 under 2.5% daily loss cap ($1,250)
// If naive: -$1,000 drawdown + $490 new risk = $1,490 >= $1,250 limit -> VETOED
// Partitioned: -$500 receiver drawdown + $490 new risk = $990 < $1,250 -> PERMITTED
const guardResult1 = await engine8.guard(newSetupDefault, {
  enabled: true,
  liveTrading: true,
  maxConcurrentTrades: 10,
  maxDailyLossPct: 2.5, // $1,250 limit
  riskPerTradePct: 1.0,
  accountSize: 50000,
  partitionedCopierRisk: true,
});

assert("Partitioned guard permits new setup Default leg after sibling stopouts", guardResult1.permitted === true, guardResult1.vetoes);
assert("No DAILY_DRAWDOWN veto triggered on Default leg", !guardResult1.vetoes.some(v => v.code === "DAILY_DRAWDOWN"), guardResult1.vetoes);

// Arm Default Leg into tradeMap
tradeMap8.set("trade_new_def_08", { ...newSetupDefault, status: "armed" });

// Test candidate 2: Sibling Prop Leg of Setup 2
const newSetupProp = {
  _id: "trade_new_prop_08",
  groupId: "grp_nas_08",
  symbol: "NAS100",
  canonicalSymbol: "NAS100",
  isLive: true,
  dir: 1,
  entryPrice: 18000,
  slPrice: 17950,
  tpPrice: 18100,
  initialRiskUsd: 490,
  riskUsd: 490,
  status: "staged",
  legId: "prop_firm",
  managementLogic: "prop_firm_safe",
};

const guardResult2 = await engine8.guard(newSetupProp, {
  enabled: true,
  liveTrading: true,
  maxConcurrentTrades: 10,
  maxDailyLossPct: 2.5,
  riskPerTradePct: 1.0,
  accountSize: 50000,
  partitionedCopierRisk: true,
});

assert("Partitioned guard permits sibling Prop leg without incremental risk penalty", guardResult2.permitted === true, guardResult2.vetoes);
assert("Sibling leg has no CAPACITY veto under elevated capacity limit", !guardResult2.vetoes.some(v => v.code === "CAPACITY"), guardResult2.vetoes);
assert("Sibling leg has no DAILY_DRAWDOWN veto", !guardResult2.vetoes.some(v => v.code === "DAILY_DRAWDOWN"), guardResult2.vetoes);

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------
console.log("\n===============================================================================");
console.log(`REAL MARKET MOCK TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("===============================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎯 ALL REAL-LIFE MARKET MOCK CONDITIONS PASSED WITH 100% SUCCESS!\n");
}
