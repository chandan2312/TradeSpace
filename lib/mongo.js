import { MongoClient } from "mongodb";

// HMR-safe + cross-module singleton. Next bundles API routes separately from the
// custom server's Node ESM, but they share one process, so globalThis is the
// correct place for a single MongoClient (and its ready promise).
const g = globalThis;

if (!g._tsMongo) {
  g._tsMongo = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/Tradespace");
  g._tsReady = null;
  g._tsCols = null;
}

export const mongo = g._tsMongo;

// Idempotent: first caller wins, everyone else awaits the same promise.
export async function getCols() {
  if (!g._tsReady) {
    g._tsReady = (async () => {
      await g._tsMongo.connect();
      const db = g._tsMongo.db(process.env.MONGODB_DB || "Tradespace");
      const alertsCol = db.collection("alerts");
      const watchlistsCol = db.collection("watchlists");
      const layoutsCol = db.collection("layouts");
      const settingsCol = db.collection("settings");
      const flagsCol = db.collection("flags");
      await alertsCol.createIndex({ symbol: 1, status: 1 });
      await watchlistsCol.createIndex({ symbol: 1 });
      // seed a default watchlist on a fresh DB (or migrate the legacy single-list)
      if ((await watchlistsCol.countDocuments()) === 0) {
        const legacy = await db.collection("watchlist").find({}).toArray();
        const symbols = legacy.map((w) => w.symbol).filter(Boolean);
        await watchlistsCol.insertOne({
          name: "Main",
          symbols: symbols.length ? symbols : ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"],
          createdAt: new Date(),
        });
        console.log(`[mongo] seeded Main watchlist (${symbols.length ? "migrated legacy" : "defaults"})`);
      }
      g._tsCols = { alertsCol, watchlistsCol, layoutsCol, settingsCol, flagsCol };
      console.log("[mongo] connected; collections ready");
    })().catch((err) => {
      g._tsReady = null; // allow a retry on the next call
      throw err;
    });
  }
  await g._tsReady;
  return g._tsCols;
}

import { toCanonicalSymbol } from "./symbols/mapping.js";

let cachedWatchlists = null;
let lastWatchlistsFetch = 0;
let inFlightWatchlistsPromise = null;

export function invalidateWatchlistsCache() {
  cachedWatchlists = null;
  lastWatchlistsFetch = 0;
  inFlightWatchlistsPromise = null;
}

export async function allWatchlists(forceRefresh = false) {
  const now = Date.now();
  if (forceRefresh) {
    cachedWatchlists = null;
    lastWatchlistsFetch = 0;
  }
  if (!forceRefresh && cachedWatchlists && now - lastWatchlistsFetch < 5000) {
    return cachedWatchlists;
  }
  if (!forceRefresh && inFlightWatchlistsPromise) {
    return inFlightWatchlistsPromise;
  }

  inFlightWatchlistsPromise = (async () => {
    try {
      const { watchlistsCol } = await getCols();
      const rawLists = await watchlistsCol.find({}).sort({ createdAt: 1 }).toArray();
      cachedWatchlists = rawLists.map((list) => {
        if (Array.isArray(list.symbols)) {
          const canonicalSet = new Set();
          let hasNonCanonical = false;
          for (const s of list.symbols) {
            const c = toCanonicalSymbol(s);
            canonicalSet.add(c);
            if (c !== s) hasNonCanonical = true;
          }
          const cleanSymbols = Array.from(canonicalSet);
          if (hasNonCanonical) {
            watchlistsCol.updateOne({ _id: list._id }, { $set: { symbols: cleanSymbols } }).catch(() => {});
          }
          return { ...list, symbols: cleanSymbols };
        }
        return list;
      });
      lastWatchlistsFetch = Date.now();
      return cachedWatchlists;
    } finally {
      inFlightWatchlistsPromise = null;
    }
  })();

  return inFlightWatchlistsPromise;
}
