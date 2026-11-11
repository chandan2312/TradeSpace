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

async function fetchAndCache(brokerSym, canonicalSym, tf, n, off, key, brokerKey) {
  let d = await bridge("POST", "/rates", { sym: brokerSym, timeframe: tf, count: n, offset: off }, { timeoutMs: 6_000 });
  if (!d?.ok && !d?.circuitOpen) {
    await new Promise((r) => setTimeout(r, 350));
    d = await bridge("POST", "/rates", { sym: brokerSym, timeframe: tf, count: n, offset: off }, { timeoutMs: 6_000 });
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
  const count = sp.get("count") || 500;
  const offset = sp.get("offset") || 0;
  if (!rawSymbol) return json({ ok: false, error: "symbol required" }, 400);

  const canonicalSym = toCanonicalSymbol(rawSymbol);
  const brokerSym = toBrokerSymbol(canonicalSym);
  const n = Math.min(Number(count) || 500, 5000);
  const off = Math.max(0, Number(offset) || 0);

  // Cache keys: For live current candles (off === 0), use unified ':live' key shared with the engine!
  // For historical pagination (off > 0), use dedicated ':history:off:n' key!
  const key = off === 0 ? `${canonicalSym}:${tf}:live` : `${canonicalSym}:${tf}:history:${off}:${n}`;
  const brokerKey = off === 0 ? `${brokerSym}:${tf}:live` : `${brokerSym}:${tf}:history:${off}:${n}`;

  const force = sp.get("refresh") === "1" || sp.get("force") === "1";
  const cached = ratesCache.get(key) || ratesCache.get(brokerKey);
  const effectiveTtl = off > 0 ? 3600_000 : (TF_RATES_TTL_MS[tf] || RATES_TTL_MS || 60_000);
  const flightKey = `${brokerSym}:${tf}:${n}:${off}`;

  // Stale-While-Revalidate:
  // For historical pagination (off > 0): past history never changes, serve cached immediately
  // For live candles (off === 0): serve cached if reasonably complete, and refresh in background if stale
  if (!force && cached?.data?.bars?.length) {
    const age = Date.now() - cached.at;
    const isSufficientCount = off > 0 || cached.data.bars.length >= Math.min(n, 500);

    if (isSufficientCount) {
      const responseData =
        cached.data.bars.length > n && off === 0
          ? { ...cached.data, count: n, bars: cached.data.bars.slice(-n) }
          : cached.data;

      if (age < effectiveTtl) {
        return json(responseData);
      }
      if (age < 300_000) {
        if (!inFlightRequests.has(flightKey)) {
          const bg = fetchAndCache(brokerSym, canonicalSym, tf, n, off, key, brokerKey)
            .catch(() => null)
            .finally(() => inFlightRequests.delete(flightKey));
          inFlightRequests.set(flightKey, bg);
        }
        return json(responseData);
      }
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
    // If cached bars exist, serve them cleanly
    if (cached?.data?.bars?.length) {
      const cacheAge = Date.now() - cached.at;
      if (cacheAge < 300_000 || off > 0) {
        return json(cached.data);
      }
      return json({ ...cached.data, stale: true, offline: true, error: data?.message || "Bridge unreachable" });
    }
    return json(data);
  } catch (err) {
    if (cached?.data?.bars?.length) {
      const cacheAge = Date.now() - cached.at;
      if (cacheAge < 300_000 || off > 0) {
        return json(cached.data);
      }
      return json({ ...cached.data, stale: true, offline: true, error: err.message });
    }
    return json({ ok: false, error: err.message }, 502);
  }
}
