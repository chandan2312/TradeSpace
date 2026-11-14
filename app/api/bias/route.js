import { allWatchlists } from "@/lib/mongo";
import { getFrames } from "@/lib/bias/data";
import { computeSymbolBias, aggregate } from "@/lib/bias/engine";
import { getMarketContext, SMT_PAIRS } from "@/lib/bias/context";
import { getNews } from "@/lib/bias/news";
import { confirmSetups } from "@/lib/bias/group";
import { json } from "@/lib/http";
import { toCanonicalSymbol } from "@/lib/symbols/mapping";
import { getConfig } from "@/lib/autonomous/store";
import { isTradingPermittedNow } from "@/lib/autonomous/timeslots";

export const dynamic = "force-dynamic";

const g = globalThis;
if (!g._tsBiasOut) g._tsBiasOut = new Map();
if (!g._tsBiasInFlight) g._tsBiasInFlight = new Map();
const CACHE_MS = 60_000;
const MAX_SYMBOLS = 24;

const FULL_MARKET_SYMBOLS = [
  "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
  "EURJPY", "GBPJPY", "AUDJPY", "EURGBP", "EURAUD", "GBPAUD",
  "DJ30", "NAS100", "SP500", "GER40", "UK100",
  "XAUUSD", "XAGUSD", "USOIL",
  "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"
];

async function executeBiasCalculation(symbols, rawSyms, key) {
  const cfg = await getConfig().catch(() => ({}));
  const bypassSessionFilter = cfg.enforceSymbolSessions === false || cfg.forceAllSymbols === true;
  const now = Date.now();

  // Session gating: identify in-session symbols and their SMT correlation partners
  const inSessionSymbols = new Set();
  const sessionChecks = new Map();

  for (const sym of symbols) {
    if (bypassSessionFilter) {
      inSessionSymbols.add(sym);
      continue;
    }
    const check = isTradingPermittedNow(new Date(now), cfg, sym);
    sessionChecks.set(sym, check);
    if (check.permitted) {
      inSessionSymbols.add(sym);
    }
  }

  const correlatedPartnersNeeded = new Set();
  for (const inSessionSym of inSessionSymbols) {
    for (const p of SMT_PAIRS[inSessionSym] || []) {
      correlatedPartnersNeeded.add(toCanonicalSymbol(p));
    }
  }

  // Active symbols to fetch and calculate: ONLY in-session symbols and their required SMT partners
  const activeSymbols = new Set([
    ...inSessionSymbols,
    ...[...correlatedPartnersNeeded].filter(s => symbols.includes(s)),
  ]);

  const [news, ctx] = await Promise.all([
    getNews().catch(() => []),
    getMarketContext().catch(() => ({ risk: null })),
  ]);

  const framesMap = {};
  const errors = {};
  const activeList = Array.from(activeSymbols);

  // Fetch frames in paced sequential chunks of 2 with 60ms pause
  const CHUNK_SIZE = 2;
  for (let i = 0; i < activeList.length; i += CHUNK_SIZE) {
    const chunk = activeList.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(async (sym) => {
      try {
        const frames = await getFrames(sym);
        if (!frames.M15 && !frames.H1 && !frames.H4) errors[sym] = "no data from bridge";
        else framesMap[sym] = frames;
      } catch (err) {
        errors[sym] = err.message;
      }
    }));
    if (i + CHUNK_SIZE < activeList.length) {
      await new Promise(r => setTimeout(r, 60));
    }
  }

  const have = new Set(Object.keys(framesMap));
  const wanted = new Set();
  for (const sym of have) {
    const base = sym.replace(/[._-].*$/, "").replace(/m$/, "");
    for (const p of SMT_PAIRS[base] || []) if (!have.has(p)) wanted.add(p);
  }
  for (const p of [...wanted].slice(0, 4)) {
    try {
      const frames = await getFrames(p);
      if (frames.M15) framesMap[p] = frames;
    } catch { }
  }

  const results = [];
  for (const sym of symbols) {
    if (activeSymbols.has(sym)) {
      if (!framesMap[sym]) continue;
      results.push(computeSymbolBias(sym, framesMap[sym], {
        news,
        risk: ctx.risk,
        partnerFrames: framesMap,
      }));
    } else {
      // Out of session symbol: clean lightweight off-session entry (0 MT5 data requests, 0 heavy math)
      const check = sessionChecks.get(sym) || isTradingPermittedNow(new Date(now), cfg, sym);
      results.push({
        symbol: sym,
        canonical: sym,
        score: 0,
        verdict: "OFF_SESSION",
        phase: "off_session",
        action: "STAND_ASIDE",
        isOffSession: true,
        session: check.slot?.name || "Off-Session",
        reason: check.reason || "Outside active trading hours.",
        drives: [],
        dampeners: [{ tag: "OFF_SESSION", text: check.reason || "Outside active hours" }],
        pillars: { htf: 0, intraday: 0, liquidity: 0, context: 0 },
      });
    }
  }

  await confirmSetups(results.filter(r => !r.isOffSession), framesMap).catch(() => {});
  const { categories, currencyStrength } = aggregate(results);
  
  const body = {
    ok: true,
    at: Date.now(),
    session: results.find(r => !r.isOffSession)?.session || null,
    risk: ctx.risk,
    symbols: results,
    categories,
    currencyStrength,
    errors: Object.keys(errors).length ? errors : undefined,
  };

  g._tsBiasOut.set(key, { at: Date.now(), body });
  if (rawSyms === "ALL" || symbols.length >= FULL_MARKET_SYMBOLS.length) {
    g._tsSharedBiasCache = { at: Date.now(), data: body };
  } else if (g._tsSharedBiasCache?.data?.symbols) {
    // Non-destructive merge of newly calculated symbols into existing shared cache
    const existingSyms = new Map(g._tsSharedBiasCache.data.symbols.map(s => [s.symbol || s.canonical, s]));
    results.forEach(r => existingSyms.set(r.symbol || r.canonical, r));
    g._tsSharedBiasCache.data.symbols = Array.from(existingSyms.values());
  }

  return body;
}

export async function GET(req) {
  try {
    const isForce = req.nextUrl.searchParams.get("force") === "1" || req.nextUrl.searchParams.get("refresh") === "1";
    const rawSyms = req.nextUrl.searchParams.get("symbols") || "";

    // Fast-path: If unified lifecycle bias cache exists and is fresh (< 15m), return instantly in 0ms!
    const sharedCache = g._tsSharedBiasCache;
    if (sharedCache?.data && !isForce && (Date.now() - (sharedCache.at || 0) < 15 * 60_000)) {
      if (rawSyms === "ALL" || !rawSyms) {
        return json(sharedCache.data);
      }
      const requested = new Set(rawSyms.split(",").map(s => toCanonicalSymbol(s.trim())).filter(Boolean));
      const filteredSymbols = sharedCache.data.symbols.filter(s => requested.has(s.symbol || s.canonical));
      // Fast return if all requested symbols are present in sharedCache!
      if (filteredSymbols.length >= requested.size && requested.size > 0) {
        return json({
          ...sharedCache.data,
          symbols: filteredSymbols,
        });
      }
    }

    let symbols = [];
    if (rawSyms === "ALL") {
      const lists = await allWatchlists().catch(() => []);
      symbols = [...new Set([...FULL_MARKET_SYMBOLS, ...lists.flatMap((w) => w.symbols || [])])];
    } else {
      symbols = rawSyms.split(",").map((s) => toCanonicalSymbol(s.trim())).filter(Boolean);
      if (!symbols.length) {
        const lists = await allWatchlists().catch(() => []);
        symbols = [...new Set(lists.flatMap((w) => w.symbols || []))];
      }
      symbols = [...new Set(symbols)].slice(0, MAX_SYMBOLS);
    }

    if (!symbols.length) return json({ ok: false, error: "no symbols" }, 400);

    const key = symbols.slice().sort().join(",");
    const hit = g._tsBiasOut.get(key);
    if (!isForce && hit && Date.now() - hit.at < CACHE_MS) return json(hit.body);

    if (!isForce && g._tsBiasInFlight.has(key)) {
      const inFlightBody = await g._tsBiasInFlight.get(key);
      return json(inFlightBody);
    }

    const calcPromise = executeBiasCalculation(symbols, rawSyms, key);
    g._tsBiasInFlight.set(key, calcPromise);
    try {
      const body = await calcPromise;
      return json(body);
    } finally {
      g._tsBiasInFlight.delete(key);
    }
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}
