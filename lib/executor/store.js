// Mongo store for the Executor: user-placed setups, config, stats.
//
// The Executor is independent of the currency algo. It does NOT find trades —
// it EXECUTES setups the user draws on a chart (an rrtool: entry/stop/target),
// running the full context stack to decide HOW to enter (direct / candle /
// structural) and managing the position through to close.

import { getCols, mongo } from "../mongo.js";

const g = globalThis;

export const DEFAULT_CONFIG = {
  liveEnabled: false,      // GLOBAL master switch — even a live:true setup stays paper until this is on
  telegram: true,

  // --- entry-mode thresholds (context score 0..100) ---
  directMin: 70,           // score ≥ this → direct fill on entry touch
  confirmMin: 45,          // confirmMin..directMin → candle confirmation; below → structural
  approachMult: 1.5,       // begin validating when price within N × zone-height of entry
  executorTtlHours: 48,    // pre-fill setups expire after this (armed too long, never approached)

  // --- position sizing (risk-% with fixed-lot fallback) ---
  riskPct: 1,              // % of accountEquity risked per trade (0 → use lotSize)
  accountEquity: 0,        // account equity for sizing; 0 → fall back to fixed lotSize
  lotSize: 0.01,           // fixed-lot fallback + minimum
  maxLot: 5,               // hard cap on computed volume
  lotStep: 0.01,           // broker volume step for rounding

  // --- management ---
  beAtR: 1,                // move SL to breakeven once trade reaches this R (0 → off)
  trailMode: "off",        // "off" | "structure" (trail behind latest M15 swing)

  // --- auto-adjust ("auto-adjustable mode") ---
  autoAdjust: true,        // let the executor judge ranges/levels and nudge SL/TP
  maxSlWidenMult: 1.5,     // SL may only widen up to this × the drawn risk (never silently tightened)

  // --- context-stack check weights (assessContext normalizes to 0..100) ---
  wStructure: 22,          // H4/H1/M15 structure alignment
  wBias: 16,               // symbol's own bias score
  wStrength: 16,           // currency strength edge (fx/metals; redistributed otherwise)
  wCorrelation: 10,        // correlated pairs not diverging (fx)
  wLiquidity: 14,          // pool ahead / fuel sweep / EQ builds
  wConfluence: 14,         // FVG+inducement / IFVG / QML+OB+FVG around the zone
  wRetracement: 8,         // retracement type at the entry
};

export async function executorCols() {
  await getCols(); // ensures the client is connected + settingsCol exists
  if (!g._tsExecCol) {
    const db = mongo.db(process.env.MONGODB_DB || "TradeSpace");
    const tradesCol = db.collection("executor_trades");
    await tradesCol.createIndex({ status: 1, symbol: 1 });
    await tradesCol.createIndex({ createdAt: -1 });
    await tradesCol.createIndex({ drawingId: 1 });
    g._tsExecCol = { tradesCol };
  }
  return g._tsExecCol;
}

export async function getConfig() {
  const { settingsCol } = await getCols();
  const doc = await settingsCol.findOne({ _id: "executor_config" });
  return { ...DEFAULT_CONFIG, ...(doc?.config || {}) };
}

export async function setConfig(patch) {
  const { settingsCol } = await getCols();
  // whitelist keys so junk can't land in config
  const clean = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    if (patch[k] !== undefined) clean[`config.${k}`] = patch[k];
  }
  if (Object.keys(clean).length) {
    await settingsCol.updateOne({ _id: "executor_config" }, { $set: clean }, { upsert: true });
  }
  return getConfig();
}

// closed = won | lost; open pipeline = armed | validating | awaiting_entry | filled | managing
export async function getStats() {
  const { tradesCol } = await executorCols();
  const closed = await tradesCol.find({ status: { $in: ["won", "lost"] } }).toArray();
  const wins = closed.filter((t) => t.status === "won");
  const totalR = closed.reduce((s, t) => s + (t.resultR || 0), 0);
  const bySymbol = {};
  for (const t of closed) {
    const b = (bySymbol[t.symbol] = bySymbol[t.symbol] || { n: 0, r: 0, wins: 0 });
    b.n++; b.r += t.resultR || 0; if (t.status === "won") b.wins++;
  }
  return {
    closed: closed.length,
    wins: wins.length,
    losses: closed.length - wins.length,
    winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : 0,
    totalR: Math.round(totalR * 100) / 100,
    avgR: closed.length ? Math.round((totalR / closed.length) * 100) / 100 : 0,
    bySymbol,
  };
}

export const OPEN_STATES = ["armed", "validating", "awaiting_entry", "filled", "managing"];
export const CLOSED_STATES = ["won", "lost", "expired", "invalidated", "cancelled"];
export const isClosed = (s) => CLOSED_STATES.includes(s);
