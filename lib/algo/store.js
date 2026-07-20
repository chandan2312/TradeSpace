// Mongo store for the algo: trades collection, config, stats.

import { getCols, mongo } from "../mongo.js";

const g = globalThis;

export const DEFAULT_CONFIG = {
  enabled: false,          // master switch — start OFF, user arms it from the UI
  minStrong: 15,           // currency |score| threshold
  minEdge: 30,             // strong-weak divergence minimum
  minScore: 60,            // setup confluence threshold
  minRR: 2,                // minimum risk:reward
  approachMult: 1.5,       // "approaching" when within N × zone-height of entry
  trackMult: 3,            // setup beyond N × zone-height → "tracking" (too fat to fill now)
  ttlHours: 12,            // watching/approaching/confirmed candidates expire after this
  trackHours: 72,          // tracking (fat) setups persist — until fully rejected by the algo
  maxConcurrent: 3,        // max simultaneous filled positions
  maxConfirmFails: 3,      // soft confirm fails allowed before terminal reject
  reconfirmCooldownMin: 15,// wait after a soft confirm fail before re-approaching
  scanMs: 180_000,         // scanner cadence
  telegram: true,
  // ICT confluence + retracement (additive scoring — see lib/algo/confluence.js,
  // lib/algo/retracement.js). Toggles + per-signal weights, all API-settable.
  confluence: true,
  retrace: true,
  fvgInducementW: 10,      // FVG + ungrabbed inducement between price and zone
  ifvgW: 12,               // inverted-FVG continuation zone on our side
  qmlObFvgW: 18,           // QML reversal + OB + FVG stacked (heaviest)
  liqBuildW: 10,           // shallow retrace coiling equal highs/lows
  oteW: 8,                 // 62–79% OTE continuation pocket
  weakW: -3,               // <62% premature retrace
  deepW: -4,               // >79% extended retrace
  reversalW: -14,          // broke impulse origin (also hard confirm reject)
};

export async function algoCols() {
  await getCols(); // ensures the client is connected + settingsCol exists
  if (!g._tsAlgoCol) {
    const db = mongo.db(process.env.MONGODB_DB || "TradeSpace");
    const tradesCol = db.collection("algo_trades");
    await tradesCol.createIndex({ status: 1, symbol: 1 });
    await tradesCol.createIndex({ createdAt: -1 });
    g._tsAlgoCol = { tradesCol };
  }
  return g._tsAlgoCol;
}

export async function getConfig() {
  const { settingsCol } = await getCols();
  const doc = await settingsCol.findOne({ _id: "algo_config" });
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
    await settingsCol.updateOne({ _id: "algo_config" }, { $set: clean }, { upsert: true });
  }
  return getConfig();
}

// closed = won | lost; open pipeline = watching | approaching | confirmed | filled
export async function getStats() {
  const { tradesCol } = await algoCols();
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
