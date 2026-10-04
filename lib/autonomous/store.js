// Mongo store and configuration persistence for the Autonomous Brain Trader.

import { getCols, mongo } from "../mongo.js";

const g = globalThis;

export const DEFAULT_AUTONOMOUS_CONFIG = {
  enabled: false,              // Master execution switch
  executionMode: "paper",      // "paper" | "copilot" | "auto"
  liveTrading: false,          // Direct MT5 broker execution switch (true: sends live orders to MT5, false: paper simulation)
  horizonMode: "adaptive",     // "adaptive" | "intraday" | "swing"

  // Pair Selection & Scanning
  minConviction: 70,           // Minimum Brain conviction to qualify a pair (50..95)
  minRunwayPct: 25,            // Minimum remaining % runway to target DOL (e.g. 25%)
  maxConcurrentTrades: 3,      // Max active positions open simultaneously
  requireSmtConfirm: false,    // Require correlated basket SMT alignment
  avoidExhaustion: true,       // Block pairs with range coverage >= 85% or <= 15%
  scanIntervalMs: 180_000,     // Auto-scan cadence (default 3 min)

  // Level Selection & Entry
  minRR: 2.2,                  // Minimum Risk:Reward ratio to stage/enter
  confluenceThreshold: 60,     // Level scoring threshold (0..100)
  preferFvgCe: true,           // Prioritize 4H/1H FVG Consequent Encroachment
  preferOte: true,             // Prioritize 62-79% OTE pocket
  preferOb: true,              // Prioritize Institutional Order Blocks

  // Risk Management
  riskPerTradePct: 1.0,        // 1.0% risk per trade
  accountSize: 50000,          // Base simulated account size in USD
  maxDailyLossPct: 3.0,        // Daily loss circuit breaker %
  breakevenTriggerR: 1.5,      // Move SL to breakeven when trade reaches 1.5R
  trailStopTriggerR: 2.5,      // Activate trailing stop when trade reaches 2.5R
  trailStepR: 0.5,             // Trailing step

  // Sessions / Killzones & Time Slots (EET / Broker Server Time Standard)
  enforceSymbolSessions: true, // Institutional symbol session gating (NAS100 NY only, GER40 London only, etc.)
  sessionFilters: {
    asia: true,                // 02:00 - 08:00 EET
    london: true,              // 10:00 - 18:00 EET
    newyork: true,             // 15:00 - 23:00 EET
  },
  allowedTimeSlots: {
    asian_range: true,         // 02:00 - 08:00 EET (Asia Accumulation)
    london_open: true,         // 10:00 - 13:00 EET (London Open Killzone)
    london_lunch: false,       // 13:00 - 15:00 EET (Midday Lull - disabled by default)
    ny_open: true,             // 15:00 - 18:00 EET (New York AM Killzone)
    ny_silver_bullet: true,    // 17:00 - 18:00 EET (New York Silver Bullet Window)
    london_close: true,        // 18:00 - 20:00 EET (London Close Killzone)
    ny_pm: true,               // 21:00 - 23:00 EET (New York PM Killzone)
    dead_zone: false,          // 00:00 - 02:00 EET (Daily Rollover / Spread Spikes - blocked)
  },

  // 5 Core Institutional Entry Models
  enabledModels: {
    ict_2022: true,            // Model 1: ICT 2022 Mentorship (Sweep + MSS + FVG CE)
    turtle_soup: true,         // Model 2: Turtle Soup (External Raid & Fast Reclaim)
    breaker_block: true,       // Model 3: Breaker Block & Mitigation Retest
    ote_continuation: true,    // Model 4: OTE Trend Continuation (62-79% Fibonacci)
    silver_bullet: true,       // Model 5: ICT Silver Bullet (60-min window FVG)
  },

  // Universe & Pair Controls (defaults to user's canonical Main Watchlist symbols)
  universe: [
    "NAS100", "XAUUSD", "EURUSD", "DJ30", "SP500", "GER40", "BTCUSD",
  ],
  blacklist: [],
  whitelist: [],
  telegram: true,
};

export const OPEN_STATES = ["staged", "armed", "confirming", "active", "managing"];
export const ACTIVE_STATES = ["active", "managing"];
export const TERMINAL_STATES = ["closed_tp", "closed_sl", "invalidated", "cancelled", "expired"];

export async function autonomousCols() {
  await getCols();
  if (!g._tsAutonomousCol) {
    const db = mongo.db(process.env.MONGODB_DB || "TradeSpace");
    const tradesCol = db.collection("autonomous_trades");
    const logsCol = db.collection("autonomous_logs");
    await tradesCol.createIndex({ status: 1, symbol: 1 });
    await tradesCol.createIndex({ createdAt: -1 });
    await logsCol.createIndex({ createdAt: -1 });
    g._tsAutonomousCol = { tradesCol, logsCol };
  }
  return g._tsAutonomousCol;
}

export async function getConfig() {
  const { settingsCol } = await getCols();
  const doc = await settingsCol.findOne({ _id: "autonomous_config" });
  return { ...DEFAULT_AUTONOMOUS_CONFIG, ...(doc?.config || {}) };
}

export async function setConfig(patch) {
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
  return getConfig();
}

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
    // Keep logs bounded to last 2,000 entries
    const count = await logsCol.countDocuments();
    if (count > 2500) {
      const oldest = await logsCol.find().sort({ createdAt: 1 }).limit(500).toArray();
      if (oldest.length) {
        await logsCol.deleteMany({ _id: { $in: oldest.map((d) => d._id) } });
      }
    }
  } catch (err) {
    console.error("[autonomous log error]", err);
  }
}

export async function getMetrics() {
  const { tradesCol } = await autonomousCols();
  const allClosed = await tradesCol.find({ status: { $in: ["closed_tp", "closed_sl"] } }).toArray();
  const activeCount = await tradesCol.countDocuments({ status: { $in: ACTIVE_STATES } });
  const stagedCount = await tradesCol.countDocuments({ status: { $in: ["staged", "armed", "confirming"] } });

  let wins = 0;
  let losses = 0;
  let totalR = 0;
  let grossWinR = 0;
  let grossLossR = 0;

  for (const t of allClosed) {
    const r = t.realizedR ?? (t.status === "closed_tp" ? (t.targetRR || 2) : -1);
    totalR += r;
    if (r > 0) {
      wins++;
      grossWinR += r;
    } else {
      losses++;
      grossLossR += Math.abs(r);
    }
  }

  const totalClosed = wins + losses;
  const winRate = totalClosed > 0 ? Math.round((wins / totalClosed) * 100) : 0;
  const profitFactor = grossLossR > 0 ? Math.round((grossWinR / grossLossR) * 100) / 100 : (grossWinR > 0 ? 99 : 0);

  return {
    totalClosed,
    wins,
    losses,
    winRate,
    totalR: Math.round(totalR * 100) / 100,
    profitFactor,
    activeCount,
    stagedCount,
  };
}
