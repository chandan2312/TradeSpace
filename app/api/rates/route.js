import { bridge, ratesCache, RATES_TTL_MS } from "@/lib/bridge";
import { json } from "@/lib/http";
import { normalizeCandles } from "@/lib/candleNormalization";
import { toCanonicalSymbol, toBrokerSymbol } from "@/lib/symbols/mapping";
import { brokerTimestampToUtcMs } from "@/lib/time";

export const dynamic = "force-dynamic";

const TF_NORMALIZE = {
  "1M": "M1", "5M": "M5", "15M": "M15", "30M": "M30", "1H": "H1", "4H": "H4", "1D": "D1",
  "M1": "M1", "M5": "M5", "M15": "M15", "M30": "M30", "H1": "H1", "H4": "H4", "D1": "D1",
};

const TF_RATES_TTL_MS = {
  M1: 15_000,
  M5: 60_000,
  M15: 120_000,
  M30: 180_000,
  H1: 300_000,
  H4: 600_000,
  D1: 900_000,
};

const inFlightRequests = new Map();

function getBiasBarsCache(symbol, brokerSym, tf) {
  const closedCache = globalThis._tsClosedBiasBars;
  if (!closedCache || !closedCache.size) return null;
  const prefix1 = `${symbol}:${tf}:`;
  const prefix2 = `${brokerSym}:${tf}:`;
  for (const [k, val] of closedCache.entries()) {
    if ((k.startsWith(prefix1) || k.startsWith(prefix2)) && val?.bars?.length && (Date.now() - val.at < 300_000)) {
      const bars = val.bars.map((b) => ({
        t: b.time * 1000,
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
        tick_volume: b.v,
      }));
      return {
        at: val.at,
        data: {
          ok: true,
          bars,
          timestampSemantics: "UTC_INSTANT",
          symbol,
          brokerSymbol: brokerSym,
        },
      };
    }
  }
  return null;
}

async function fetchAndCache(brokerSym, canonicalSym, tf, n, off, key, brokerKey) {
  let d = await bridge("POST", "/rates", { sym: brokerSym, timeframe: tf, count: n, offset: off }, { timeoutMs: 5_000 });
  if (!d?.ok && !d?.circuitOpen) {
    await new Promise((r) => setTimeout(r, 350));
    d = await bridge("POST", "/rates", { sym: brokerSym, timeframe: tf, count: n, offset: off }, { timeoutMs: 5_000 });
  }
  if (d?.ok && Array.isArray(d.bars)) {
    d.bars = d.bars.map((b) => ({
      ...b,
      t: brokerTimestampToUtcMs(b.t, { brokerTimeZone: "Europe/Athens" }),
    }));
    d.bars = normalizeCandles(d.bars, tf);
    d.timestampSemantics = "UTC_INSTANT";
    d.symbol = canonicalSym;
    d.brokerSymbol = brokerSym;
    ratesCache.set(key, { at: Date.now(), data: d });
    if (brokerKey !== key) ratesCache.set(brokerKey, { at: Date.now(), data: d });
    return d;
  }
  return d;
}

export async function GET(req) {
  const sp = req.nextUrl.searchParams;
  const rawSymbol = sp.get("symbol");
  const rawTf = String(sp.get("tf") || "M5").toUpperCase();
  const tf = TF_NORMALIZE[rawTf] || rawTf;
  const count = sp.get("count") || 600;
  const offset = sp.get("offset") || 0;
  if (!rawSymbol) return json({ ok: false, error: "symbol required" }, 400);

  const canonicalSym = toCanonicalSymbol(rawSymbol);
  const brokerSym = toBrokerSymbol(canonicalSym);
  const n = Math.min(Number(count) || 600, 5000);
  const off = Math.max(0, Number(offset) || 0);

  // Cache keys use canonical symbol for universal consistency
  const key = `${canonicalSym}:${tf}:${n}:${off}`;
  const brokerKey = `${brokerSym}:${tf}:${n}:${off}`;

  const force = sp.get("refresh") === "1" || sp.get("force") === "1";
  let cached = ratesCache.get(key) || ratesCache.get(brokerKey);

  // If no direct ratesCache entry, check if the scanner already loaded this symbol and timeframe in bias cache
  if (!cached) {
    const biasCached = getBiasBarsCache(canonicalSym, brokerSym, tf);
    if (biasCached) {
      cached = biasCached;
      ratesCache.set(key, cached);
      if (brokerKey !== key) ratesCache.set(brokerKey, cached);
    }
  }

  const effectiveTtl = TF_RATES_TTL_MS[tf] || RATES_TTL_MS || 60_000;
  const flightKey = `${brokerSym}:${tf}:${n}:${off}`;

  // Stale-While-Revalidate:
  // If cache exists and is fresh: return immediately!
  // If cache exists and is < 5 min old (and not forced): return immediately and refresh in background!
  if (!force && cached?.data?.bars?.length) {
    const age = Date.now() - cached.at;
    if (age < effectiveTtl) {
      return json(cached.data);
    }
    if (age < 300_000) {
      if (!inFlightRequests.has(flightKey)) {
        const bg = fetchAndCache(brokerSym, canonicalSym, tf, n, off, key, brokerKey)
          .catch(() => null)
          .finally(() => inFlightRequests.delete(flightKey));
        inFlightRequests.set(flightKey, bg);
      }
      return json(cached.data);
    }
  }

  if (!force && inFlightRequests.has(flightKey)) {
    try {
      const flightData = await inFlightRequests.get(flightKey);
      if (flightData?.ok && Array.isArray(flightData.bars)) {
        return json(flightData);
      }
    } catch (_) {}
  }

  try {
    const fetchPromise = fetchAndCache(brokerSym, canonicalSym, tf, n, off, key, brokerKey);
    inFlightRequests.set(flightKey, fetchPromise);
    let data;
    try {
      data = await fetchPromise;
    } finally {
      inFlightRequests.delete(flightKey);
    }

    if (data?.ok && Array.isArray(data.bars)) {
      return json(data);
    }

    // Bridge error / offline:
    // If cached bars exist (< 5 min old), serve them cleanly
    if (cached?.data?.bars?.length) {
      const cacheAge = Date.now() - cached.at;
      if (cacheAge < 300_000) {
        return json(cached.data);
      }
      return json({ ...cached.data, stale: true, offline: true, error: data?.message || "Bridge unreachable" });
    }
    return json(data);
  } catch (err) {
    if (cached?.data?.bars?.length) {
      const cacheAge = Date.now() - cached.at;
      if (cacheAge < 300_000) {
        return json(cached.data);
      }
      return json({ ...cached.data, stale: true, offline: true, error: err.message });
    }
    return json({ ok: false, error: err.message }, 502);
  }
}
