// Mongo store and configuration persistence for the Autonomous Brain Trader.

import { getCols, mongo } from "../mongo.js";
import { DEFAULT_COPIER_PROFILES } from "./magicEncoder.js";
import { calculateEffectiveGroupRisk } from "./risk.js";

const g = globalThis;

export const DEFAULT_AUTONOMOUS_CONFIG = {
  enabled: false,              // Master execution switch
  executionMode: "paper",      // "paper" | "copilot" | "auto"
  liveTrading: false,          // Direct MT5 broker execution switch (true: sends live orders to MT5, false: paper simulation)
  horizonMode: "adaptive",     // "adaptive" | "swing" (1D-1H) | "day" (4H-15M) | "scalp" (30M-5M)
  defaultManagementLogic: "milestone_50", // "milestone_50" (50% Milestone + Runner) | "prop_firm_safe" (1.5R–2.5R Bracket)

  // Pair Selection & Scanning
  minConviction: 60,           // Minimum Brain conviction to qualify a pair (50..95) - loosened for downstream copier routing
  minRunwayPct: 15,            // Minimum remaining % runway to target DOL (loosened from 25%)
  maxConcurrentTrades: 10,     // Max active positions open simultaneously (elevated from 3 to allow high-frequency receiver distribution)
  requireSmtConfirm: false,    // Require correlated basket SMT alignment
  avoidExhaustion: true,       // Block pairs with range coverage >= 85% or <= 15%
  scanIntervalMs: 180_000,     // Auto-scan cadence (default 3 min)

  // Level Selection & Entry
  minRR: 1.8,                  // Minimum Risk:Reward ratio to stage/enter (loosened from 2.2)
  confluenceThreshold: 60,     // Level scoring threshold (0..100)
  preferFvgCe: true,           // Prioritize 4H/1H FVG Consequent Encroachment
  preferOte: true,             // Prioritize 62-79% OTE pocket
  preferOb: true,              // Prioritize Institutional Order Blocks

  // Risk Management & Partitioned Multi-Account Execution (Pure R-Measurement)
  riskPerTradePct: 1.0,        // 1.0% risk per trade nominal budget
  accountSize: 50000,          // Base simulated account size in USD
  enforceDollarRiskCaps: false,// Master demo sender: bypass fixed dollar caps & dollar drawdown vetoes (measured in R)
  measureRiskInR: true,        // Measure risk and performance strictly in R multiples (1.0R unit risk)
  maxDailyLossR: null,         // Daily loss circuit breaker in R (null = unconstrained, or e.g. 5.0 for -5R)
  capacityRiskLimit: null,     // Dollar risk capacity limit (disabled when enforceDollarRiskCaps is false)
  maxDailyLossPct: 10.0,       // Legacy Daily loss circuit breaker % (active only when enforceDollarRiskCaps is true)
  partitionedCopierRisk: true, // Partitioned risk evaluation for downstream trade copiers (evaluates per-receiver stream, prevents 2x fake inflation)
  maxSpreadToRisk: 0.25,       // Max acceptable spread-to-stop ratio (loosened from 0.15)
  accountFreshnessMs: 15000,
  brokerPollMs: 5000,
  pendingExpiryMinutes: 60,
  swingStagedExpiryHours: 120, // Swing setups (1D-1H): valid up to 5 trading days
  dayStagedExpiryHours: 24,    // Day trade setups (4H-15M): valid up to 24 hours (full trading day)
  scalpStagedExpiryHours: 6,   // Scalp setups (30M-5M): valid up to 6 hours (active session window)
  entryValidationMs: 15000,
  trailingPollMs: 30000,
  paperSymbolSpecs: {},       // Explicit account-currency contract specs; never guessed
  timestampSemantics: "UTC_INSTANT", // "UTC_INSTANT" | "BROKER_NAIVE"
  brokerTimeZone: "Europe/Athens",
  brokerUtcOffsetMinutes: null,
  useM1Refinement: false,
  breakevenTriggerR: 1.5,      // Move SL to breakeven when trade reaches 1.5R
  trailStopTriggerR: 2.5,      // Activate trailing stop when trade reaches 2.5R
  trailStepR: 0.5,             // Trailing step

  // Repetitive Trade & Duplicate Alert Safeguards
  cooldownMinutes: 15,         // Post-trade / post-invalidation symbol cooldown (mins - loosened from 45)
  lossCooldownMinutes: 15,     // Post-SL/invalidation directional cooldown to prevent whipsaw (mins - loosened from 30)
  dedupFingerprintWindowMinutes: 20, // Suppress identical setup fingerprint within window (mins - loosened from 60)
  alertThrottleMinutes: 15,    // Min time between repeated Telegram alerts for same symbol/setup (mins)
  exhaustedIdeaScope: "day",   // "day" | "none" - Blocks re-entry if trade idea was filled and hit TP or SL today

  // Sessions / Killzones & Time Slots (EET / Broker Server Time Standard)
  enforceSymbolSessions: true, // Institutional symbol session gating (NAS100 NY only, GER40 London & NY, etc.)
  sessionFilters: {
    asia: true,                // 02:00 - 06:00 EET
    london: true,              // 10:00 - 18:00 EET
    newyork: true,             // 16:25 - 20:30 EET
  },
  sessionTimings: {
    asia: { start: "02:00", end: "06:00" },
    london: { start: "10:00", end: "18:00" },
    newyork: { start: "16:25", end: "20:30" },
  },
  allowedTimeSlots: {
    asian_range: true,         // 02:00 - 06:00 EET (Asia Accumulation)
    pre_london_prep: true,     // 08:00 - 10:00 EET (Pre-London Session Setup)
    london_open: true,         // 10:00 - 13:00 EET (London Open Killzone)
    london_lunch: false,       // 13:00 - 15:00 EET (Midday Lull - disabled by default)
    pre_ny_prep: false,        // 15:00 - 16:25 EET (Pre-NY Session Setup - disabled by default)
    ny_open: true,             // 16:25 - 20:30 EET (New York Session / AM Killzone)
    ny_silver_bullet: true,    // 17:00 - 18:00 EET (New York Silver Bullet Window)
    london_close: true,        // 18:00 - 20:00 EET (London Close Killzone / NY Midday)
    ny_pm: true,               // 21:00 - 23:00 EET (New York PM Killzone)
    dead_zone: false,          // 00:00 - 02:00 EET (Daily Rollover / Spread Spikes - blocked)
  },
  // Granular user-configurable session & slot timings (HH:MM in EET standard)
  slotCustomTimings: {
    asian_range: { start: "02:00", end: "06:00" },
    pre_london_prep: { start: "08:00", end: "10:00" },
    london_open: { start: "10:00", end: "13:00" },
    london_lunch: { start: "13:00", end: "15:00" },
    pre_ny_prep: { start: "15:00", end: "16:25" },
    ny_open: { start: "16:25", end: "20:30" },
    ny_silver_bullet: { start: "17:00", end: "18:00" },
    london_close: { start: "18:00", end: "20:30" },
    ny_pm: { start: "21:00", end: "23:00" },
  },
  // Granular per-symbol allowed trading time slots (Array of slot IDs per symbol)
  symbolTimeSlots: {
    NAS100: ["ny_open", "ny_silver_bullet", "london_close", "off_session_lull", "ny_pm"],
    DJ30: ["ny_open", "ny_silver_bullet", "london_close", "off_session_lull", "ny_pm"],
    SP500: ["ny_open", "ny_silver_bullet", "london_close", "off_session_lull", "ny_pm"],
    US30: ["ny_open", "ny_silver_bullet", "london_close", "off_session_lull", "ny_pm"],
    GER40: ["pre_london_prep", "london_open", "london_lunch", "ny_open", "ny_silver_bullet", "london_close", "off_session_lull", "ny_pm"],
    EURUSD: ["pre_london_prep", "london_open", "london_lunch", "ny_open", "ny_silver_bullet", "london_close", "off_session_lull", "ny_pm"],
    XAUUSD: ["asian_range", "pre_london_prep", "london_open", "london_lunch", "ny_open", "ny_silver_bullet", "london_close", "off_session_lull", "ny_pm"],
    BTCUSD: ["asian_range", "pre_london_prep", "london_open", "london_lunch", "ny_open", "ny_silver_bullet", "london_close", "off_session_lull", "ny_pm"],
  },

  // Core Institutional Entry Models (Balanced High-Quality Multi-Model Engine)
  enabledModels: {
    ict_2022: true,            // Core 1: ICT 2022 Mentorship (Displacement + MSS + FVG CE)
    turtle_soup: true,         // Core 2: Turtle Soup Liquidity Raid (External Sweeps & Reversals)
    breaker_block: true,       // Core 3: Breaker Block & Mitigation Retest (Structure Flips & Trapped Vol)
    ote_continuation: true,    // Core 4: OTE Trend Expansion (Trend Continuations & 62-79% Retracements)
    silver_bullet: false,      // Optional: ICT Silver Bullet (60-min window covered by Killzone Confluence)
  },

  // Universe & Pair Controls (defaults to user's canonical Main Watchlist symbols)
  universe: [
    "NAS100", "XAUUSD", "EURUSD", "DJ30", "SP500", "GER40", "BTCUSD",
  ],
  blacklist: [],
  whitelist: [],
  telegram: true,

  // Multi-Account Copier Profiles & Diversification
  copierProfiles: DEFAULT_COPIER_PROFILES,
};

export const RESERVED_STATES = ["armed", "placing", "pending", "confirming", "reconciling", "cancelling", "active", "managing", "closing"];
export const OPEN_STATES = ["staged", ...RESERVED_STATES];
export const ACTIVE_STATES = ["active", "managing", "closing"];
export const TERMINAL_STATES = ["closed_tp", "closed_sl", "closed_be", "invalidated", "cancelled", "expired"];

export async function autonomousCols() {
  await getCols();
  if (!g._tsAutonomousCol) {
    const db = mongo.db(process.env.MONGODB_DB || "TradeSpace");
    const tradesCol = db.collection("autonomous_trades");
    const logsCol = db.collection("autonomous_logs");
    const controlCol = db.collection("autonomous_control");
    // Non-blocking background index initialization avoids 17s Atlas network stalls on startup
    Promise.allSettled([
      tradesCol.createIndex({ status: 1, symbol: 1 }),
      tradesCol.createIndex({ status: 1, closedAt: -1, createdAt: -1 }),
      tradesCol.createIndex({ createdAt: -1 }),
      tradesCol.createIndex({ "operation.requestId": 1 }, { sparse: true }),
      tradesCol.createIndex({ isLive: 1, orderTicket: 1, positionId: 1 }),
      tradesCol.createIndex({ fingerprint: 1, closedAt: -1 }),
      logsCol.createIndex({ createdAt: -1 }),
    ]).catch(() => {});
    g._tsAutonomousCol = { tradesCol, logsCol, controlCol };
  }
  return g._tsAutonomousCol;
}

let cachedConfig = null;
let lastConfigTime = 0;
const CONFIG_CACHE_TTL = 10_000; // 10 seconds

export function invalidateConfigCache() {
  cachedConfig = null;
  lastConfigTime = 0;
}

export async function getConfig(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedConfig && (now - lastConfigTime < CONFIG_CACHE_TTL)) {
    return cachedConfig;
  }
  const { settingsCol } = await getCols();
  const doc = await settingsCol.findOne({ _id: "autonomous_config" });
  const saved = doc?.config || {};
  const cfg = { ...DEFAULT_AUTONOMOUS_CONFIG, ...saved };
  for (const key of ["sessionFilters", "allowedTimeSlots", "enabledModels", "slotCustomTimings", "sessionTimings"]) {
    cfg[key] = { ...DEFAULT_AUTONOMOUS_CONFIG[key], ...saved[key] };
  }
  if (cfg.slotCustomTimings?.london_lunch?.start === "15:00" && cfg.slotCustomTimings?.london_lunch?.end === "16:25") {
    cfg.slotCustomTimings.london_lunch = { start: "13:00", end: "15:00" };
  }
  cfg.symbolTimeSlots = { ...(DEFAULT_AUTONOMOUS_CONFIG.symbolTimeSlots || {}), ...(saved.symbolTimeSlots || {}) };
  cachedConfig = cfg;
  lastConfigTime = now;
  return cfg;
}

export function validateAutonomousConfig(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Configuration must be an object");
  const ranges = {
    riskPerTradePct: [0, 10],
    accountSize: [1, 1e10],
    maxDailyLossPct: [0.01, 100],
    maxDailyLossR: [0.1, 100],
    maxConcurrentTrades: [1, 100],
    minConviction: [1, 100],
    minRunwayPct: [0, 100],
    minRR: [0.1, 50],
    maxSpreadToRisk: [0.01, 1.0],
    cooldownMinutes: [0, 1440],
    lossCooldownMinutes: [0, 1440],
    dedupFingerprintWindowMinutes: [0, 1440],
    alertThrottleMinutes: [0, 1440],
    accountFreshnessMs: [1000, 60000],
    brokerPollMs: [1000, 60000],
    pendingExpiryMinutes: [1, 1440],
    entryValidationMs: [1000, 60000],
    trailingPollMs: [5000, 300000],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) if (patch[key] !== undefined && patch[key] !== null && (typeof patch[key] !== "number" || !Number.isFinite(patch[key]) || patch[key] < min || patch[key] > max || (key === "maxConcurrentTrades" && !Number.isInteger(patch[key])))) throw new Error(`Invalid ${key}`);
  if (patch.capacityRiskLimit !== undefined && patch.capacityRiskLimit !== null && (typeof patch.capacityRiskLimit !== "number" || !Number.isFinite(patch.capacityRiskLimit) || patch.capacityRiskLimit <= 0)) throw new Error("Invalid capacityRiskLimit");
  for (const [key, values] of Object.entries({ executionMode: ["paper", "copilot", "auto"], horizonMode: ["adaptive", "swing", "day", "scalp", "intraday"], defaultManagementLogic: ["milestone_50", "prop_firm_safe"], exhaustedIdeaScope: ["day", "none"], timestampSemantics: ["UTC_INSTANT", "BROKER_NAIVE"] })) if (patch[key] !== undefined && !values.includes(patch[key])) throw new Error(`Invalid ${key}`);
  if (patch.brokerUtcOffsetMinutes != null && (!Number.isFinite(patch.brokerUtcOffsetMinutes) || Math.abs(patch.brokerUtcOffsetMinutes) > 840)) throw new Error("Invalid brokerUtcOffsetMinutes");
  if (patch.brokerTimeZone !== undefined) { if (typeof patch.brokerTimeZone !== "string") throw new Error("Invalid brokerTimeZone"); new Intl.DateTimeFormat("en-US", { timeZone: patch.brokerTimeZone }); }
  if (patch.symbolTimeSlots !== undefined && patch.symbolTimeSlots !== null) {
    if (typeof patch.symbolTimeSlots !== "object" || Array.isArray(patch.symbolTimeSlots)) throw new Error("Invalid symbolTimeSlots: must be an object");
    for (const [sym, slots] of Object.entries(patch.symbolTimeSlots)) {
      if (!Array.isArray(slots) || slots.some((s) => typeof s !== "string")) throw new Error(`Invalid symbolTimeSlots for ${sym}: slots must be an array of strings`);
    }
  }
  if (patch.slotCustomTimings !== undefined && patch.slotCustomTimings !== null) {
    if (typeof patch.slotCustomTimings !== "object" || Array.isArray(patch.slotCustomTimings)) throw new Error("Invalid slotCustomTimings: must be an object");
    for (const [id, t] of Object.entries(patch.slotCustomTimings)) {
      if (!t || typeof t !== "object" || typeof t.start !== "string" || typeof t.end !== "string") {
        throw new Error(`Invalid slotCustomTimings for ${id}: must contain start and end strings`);
      }
    }
  }
  if (patch.sessionTimings !== undefined && patch.sessionTimings !== null) {
    if (typeof patch.sessionTimings !== "object" || Array.isArray(patch.sessionTimings)) throw new Error("Invalid sessionTimings: must be an object");
    for (const [id, t] of Object.entries(patch.sessionTimings)) {
      if (!t || typeof t !== "object" || typeof t.start !== "string" || typeof t.end !== "string") {
        throw new Error(`Invalid sessionTimings for ${id}: must contain start and end strings`);
      }
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (["copierProfiles", "symbolTimeSlots", "slotCustomTimings", "sessionTimings"].includes(key)) continue;
    if (typeof DEFAULT_AUTONOMOUS_CONFIG[key] === "boolean" && typeof value !== "boolean") throw new Error(`Invalid ${key}`);
    if (Array.isArray(DEFAULT_AUTONOMOUS_CONFIG[key]) && (!Array.isArray(value) || value.some((s) => typeof s !== "string"))) throw new Error(`Invalid ${key}`);
    if (["sessionFilters", "allowedTimeSlots", "enabledModels"].includes(key) && (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([k, v]) => !(k in DEFAULT_AUTONOMOUS_CONFIG[key]) || typeof v !== "boolean"))) throw new Error(`Invalid ${key}`);
    if (key === "paperSymbolSpecs" && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("Invalid paperSymbolSpecs");
  }
  return patch;
}

export async function setConfig(patch) {
  validateAutonomousConfig(patch);
  const { settingsCol } = await getCols();
  const clean = {};
  for (const k of Object.keys(DEFAULT_AUTONOMOUS_CONFIG)) {
    if (patch[k] !== undefined) clean[`config.${k}`] = patch[k];
  }
  clean["config.updatedAt"] = new Date();
  await settingsCol.updateOne(
    { _id: "autonomous_config" },
    { $set: clean },
    { upsert: true }
  );
  invalidateConfigCache();
  return getConfig(true);
}

// One atomic account-scoped capacity ledger protects simultaneous arming calls.
export async function reserveTradeCapacity(trade, cfg, riskUsd) {
  const { controlCol } = await autonomousCols();
  const key = "capacity";
  await controlCol.updateOne({ _id: key }, { $setOnInsert: { slots: [] } }, { upsert: true });
  const tradeId = String(trade._id);
  const tradeSymbol = trade.canonicalSymbol || trade.symbol;
  const groupId = trade.groupId || null;
  const { tradesCol } = await autonomousCols();
  // Terminal records can survive a crash between their transition and release.
  const terminal = await tradesCol.find({ status: { $in: TERMINAL_STATES } }, { projection: { _id: 1 } }).toArray();
  if (terminal.length) await controlCol.updateOne({ _id: key }, { $pull: { slots: { tradeId: { $in: terminal.map((t) => String(t._id)) } } } });
  const current = await controlCol.findOne({ _id: key });
  const existingSlots = current?.slots || [];

  if (current?.slots?.some((s) => s.tradeId === tradeId)) {
    const otherSlots = existingSlots.filter((s) => s.tradeId !== tradeId);
    let totalWithUpdatedRisk;
    if (cfg?.partitionedCopierRisk !== false) {
      totalWithUpdatedRisk = calculateEffectiveGroupRisk(otherSlots, { groupId, riskUsd }).totalWithNew;
    } else {
      totalWithUpdatedRisk = otherSlots.reduce((sum, s) => sum + (Number(s.riskUsd) || 0), 0) + riskUsd;
    }
    if (cfg?.enforceDollarRiskCaps === true && Number.isFinite(cfg?.capacityRiskLimit) && totalWithUpdatedRisk > cfg.capacityRiskLimit + 1e-6) return false;
    const result = await controlCol.updateOne({ _id: key, "slots.tradeId": tradeId }, { $set: { "slots.$.riskUsd": riskUsd } });
    return result.matchedCount === 1;
  }

  const isSibling = Boolean(groupId && existingSlots.some((s) => s.groupId === groupId));
  const hasAlienConflict = existingSlots.some((s) => s.symbol === tradeSymbol && (!groupId || s.groupId !== groupId));
  if (hasAlienConflict) return false;

  const distinctGroups = new Set();
  let distinctSetupCount = 0;
  for (const s of existingSlots) {
    if (s.groupId) {
      if (!distinctGroups.has(s.groupId)) {
        distinctGroups.add(s.groupId);
        distinctSetupCount++;
      }
    } else {
      distinctSetupCount++;
    }
  }
  const maxConcurrent = cfg?.maxConcurrentTrades ?? 10;
  if (!isSibling && distinctSetupCount >= maxConcurrent) return false;

  let totalWithNewRisk;
  if (cfg?.partitionedCopierRisk !== false) {
    totalWithNewRisk = calculateEffectiveGroupRisk(existingSlots, { groupId, riskUsd }).totalWithNew;
  } else {
    totalWithNewRisk = existingSlots.reduce((sum, s) => sum + (Number(s.riskUsd) || 0), 0) + riskUsd;
  }
  if (cfg?.enforceDollarRiskCaps === true && Number.isFinite(cfg?.capacityRiskLimit) && totalWithNewRisk > cfg.capacityRiskLimit + 1e-6) return false;

  const newSlot = { tradeId, groupId, symbol: tradeSymbol, riskUsd, at: new Date() };
  const pushRes = await controlCol.updateOne({ _id: key, "slots.tradeId": { $ne: tradeId } }, { $push: { slots: newSlot } });
  return pushRes.modifiedCount === 1;
}
export async function releaseTradeCapacity(tradeId) {
  const { controlCol } = await autonomousCols();
  await controlCol.updateOne({ _id: "capacity" }, { $pull: { slots: { tradeId: String(tradeId) } } });
}
export async function getDailyBaseline(dayKey, equity) {
  const { controlCol } = await autonomousCols();
  const _id = `day:${dayKey}`;
  await controlCol.updateOne({ _id }, { $setOnInsert: { equity, createdAt: new Date() } }, { upsert: true });
  return (await controlCol.findOne({ _id }))?.equity;
}

let logInsertCounter = 0;
export async function logEvent(type, message, details = {}) {
  try {
    const { logsCol } = await autonomousCols();
    const doc = {
      type,
      message,
      details,
      createdAt: new Date(),
    };
    await logsCol.insertOne(doc);
    // Keep logs bounded to last 2,000 entries — run asynchronously and only every 50 inserts
    if (++logInsertCounter % 50 === 0) {
      logsCol.countDocuments().then(async (count) => {
        if (count > 2500) {
          const oldest = await logsCol.find().sort({ createdAt: 1 }).limit(500).toArray();
          if (oldest.length) {
            await logsCol.deleteMany({ _id: { $in: oldest.map((d) => d._id) } });
          }
        }
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[autonomous log error]", err);
  }
}

let cachedMetrics = null;
let lastMetricsTime = 0;
const METRICS_CACHE_TTL = 15_000; // 15 seconds

export function invalidateMetricsCache() {
  cachedMetrics = null;
  lastMetricsTime = 0;
}

export async function getMetrics(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedMetrics && (now - lastMetricsTime < METRICS_CACHE_TTL)) {
    return cachedMetrics;
  }
  const { tradesCol } = await autonomousCols();
  const allClosed = await tradesCol.find(
    { status: { $in: ["closed_tp", "closed_sl", "closed_be"] } },
    { projection: { realizedR: 1, status: 1, targetRR: 1, isBreakeven: 1 } }
  ).toArray();
  const activeCount = await tradesCol.countDocuments({ status: { $in: ACTIVE_STATES } });
  const stagedCount = await tradesCol.countDocuments({ status: { $in: OPEN_STATES.filter((s) => !ACTIVE_STATES.includes(s)) } });

  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let totalR = 0;
  let grossWinR = 0;
  let grossLossR = 0;

  for (const t of allClosed) {
    const r = t.realizedR ?? (t.status === "closed_tp" ? (t.targetRR || 2) : (t.status === "closed_be" ? 0 : -1));
    totalR += r;

    // Check breakeven first: explicit closed_be status or near-zero R (|r| <= 0.05) or BE flag with r near zero
    if (t.status === "closed_be" || (Math.abs(r) <= 0.05) || (t.isBreakeven && r >= -0.1 && r <= 0.25)) {
      breakevens++;
      if (r > 0) grossWinR += r;
      else if (r < 0) grossLossR += Math.abs(r);
    } else if (r > 0.05) {
      wins++;
      grossWinR += r;
    } else {
      losses++;
      grossLossR += Math.abs(r);
    }
  }

  const decidedClosed = wins + losses;
  const totalClosed = wins + losses + breakevens;
  // Win rate calculated on decided trades (wins + losses) so BE does not distort into a losing rate
  const winRate = decidedClosed > 0 ? Math.round((wins / decidedClosed) * 100) : (totalClosed > 0 && wins > 0 ? Math.round((wins / totalClosed) * 100) : 0);
  const beRate = totalClosed > 0 ? Math.round((breakevens / totalClosed) * 100) : 0;
  const profitFactor = grossLossR > 0 ? Math.round((grossWinR / grossLossR) * 100) / 100 : (grossWinR > 0 ? 99 : 0);

  cachedMetrics = {
    totalClosed,
    decidedClosed,
    wins,
    losses,
    breakevens,
    winRate,
    beRate,
    totalR: Math.round(totalR * 100) / 100,
    profitFactor,
    activeCount,
    stagedCount,
  };
  lastMetricsTime = now;
  return cachedMetrics;
}
