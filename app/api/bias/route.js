import { allWatchlists } from "@/lib/mongo";
import { getFrames } from "@/lib/bias/data";
import { computeSymbolBias, aggregate } from "@/lib/bias/engine";
import { getMarketContext, SMT_PAIRS } from "@/lib/bias/context";
import { getNews } from "@/lib/bias/news";
import { confirmSetups } from "@/lib/bias/group";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

const g = globalThis;
if (!g._tsBiasOut) g._tsBiasOut = new Map();
const CACHE_MS = 60_000;
const MAX_SYMBOLS = 16;

const FULL_MARKET_SYMBOLS = [
  "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD",
  "EURJPY", "GBPJPY", "AUDJPY", "EURGBP", "EURAUD", "GBPAUD",
  "US30", "NAS100", "US500", "GER40", "UK100",
  "XAUUSD", "XAGUSD", "WTI",
  "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"
];

export async function GET(req) {
  try {
    const rawSyms = req.nextUrl.searchParams.get("symbols") || "";
    let symbols = [];
    
    if (rawSyms === "ALL") {
      // full market scan + whatever the user watches (so no watchlist symbol vanishes)
      const lists = await allWatchlists().catch(() => []);
      symbols = [...new Set([...FULL_MARKET_SYMBOLS, ...lists.flatMap((w) => w.symbols || [])])];
    } else {
      symbols = rawSyms.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (!symbols.length) {
        const lists = await allWatchlists().catch(() => []);
        symbols = [...new Set(lists.flatMap((w) => w.symbols || []))];
      }
      symbols = [...new Set(symbols)].slice(0, MAX_SYMBOLS);
    }

    if (!symbols.length) return json({ ok: false, error: "no symbols" }, 400);

    const key = symbols.slice().sort().join(",");
    const hit = g._tsBiasOut.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.body);

    const [news, ctx] = await Promise.all([
      getNews().catch(() => []),
      getMarketContext().catch(() => ({ risk: null })),
    ]);

    const framesMap = {};
    const errors = {};
    
    // We fetch in chunks of 2 to avoid overwhelming the bridge lock if ALL is requested
    const CHUNK_SIZE = 2;
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (sym) => {
        try {
          const frames = await getFrames(sym);
          if (!frames.M15 && !frames.H1) errors[sym] = "no data from bridge";
          else framesMap[sym] = frames;
        } catch (err) {
          errors[sym] = err.message;
        }
      }));
    }

    const have = new Set(Object.keys(framesMap));
    const wanted = new Set();
    for (const sym of have) {
      const base = sym.replace(/[._-].*$/, "").replace(/m$/, "");
      for (const p of SMT_PAIRS[base] || []) if (!have.has(p)) wanted.add(p);
    }
    // group partners/basket are fetched lazily inside confirmSetups (setups only)
    for (const p of [...wanted].slice(0, 6)) {
      try {
        const frames = await getFrames(p);
        if (frames.M15) framesMap[p] = frames;
      } catch { }
    }

    const results = [];
    for (const sym of symbols) {
      if (!framesMap[sym]) continue;
      results.push(computeSymbolBias(sym, framesMap[sym], {
        news,
        risk: ctx.risk,
        partnerFrames: framesMap,
      }));
    }

    await confirmSetups(results, framesMap); // group check BEFORE aggregate (adjusts dampMult)
    const { categories, currencyStrength } = aggregate(results);
    
    const body = {
      ok: true,
      at: Date.now(),
      session: results[0]?.session || null,
      risk: ctx.risk,
      symbols: results,
      categories,
      currencyStrength,
      errors: Object.keys(errors).length ? errors : undefined,
    };
    g._tsBiasOut.set(key, { at: Date.now(), body });
    return json(body);
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}
