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
  M1: 10_000,
  M5: 25_000,
  M15: 60_000,
  M30: 90_000,
  H1: 180_000,
  H4: 300_000,
  D1: 600_000,
};

const inFlightRequests = new Map();

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
  const cached = ratesCache.get(key) || ratesCache.get(brokerKey);
  const effectiveTtl = TF_RATES_TTL_MS[tf] || RATES_TTL_MS || 25_000;
  if (!force && cached && Date.now() - cached.at < effectiveTtl) return json(cached.data);

  const flightKey = `${brokerSym}:${tf}:${n}:${off}`;
  if (!force && inFlightRequests.has(flightKey)) {
    try {
      const flightData = await inFlightRequests.get(flightKey);
      if (flightData?.ok && Array.isArray(flightData.bars)) {
        return json(flightData);
      }
    } catch (_) {}
  }

  try {
    const fetchPromise = (async () => {
      let d = await bridge("POST", "/rates", { sym: brokerSym, timeframe: tf, count: n, offset: off }, { timeoutMs: 5_000 });
      if (!d?.ok && !d?.circuitOpen) {
        await new Promise((r) => setTimeout(r, 350));
        d = await bridge("POST", "/rates", { sym: brokerSym, timeframe: tf, count: n, offset: off }, { timeoutMs: 5_000 });
      }
      return d;
    })();

    inFlightRequests.set(flightKey, fetchPromise);
    let data;
    try {
      data = await fetchPromise;
    } finally {
      inFlightRequests.delete(flightKey);
    }

    if (data.ok && Array.isArray(data.bars)) {
      data.bars = data.bars.map((b) => ({
        ...b,
        t: brokerTimestampToUtcMs(b.t, { brokerTimeZone: "Europe/Athens" }),
      }));
      data.bars = normalizeCandles(data.bars, tf);
      data.timestampSemantics = "UTC_INSTANT";
      data.symbol = canonicalSym;
      data.brokerSymbol = brokerSym;
      ratesCache.set(key, { at: Date.now(), data });
      if (brokerKey !== key) ratesCache.set(brokerKey, { at: Date.now(), data });
      return json(data);
    }
    // Bridge error / offline:
    // If cached bars exist and are reasonably recent (< 2 min old), serve them cleanly!
    // Live WebSocket ticks keep the active candle updating; avoids false stale alerts.
    if (cached?.data?.bars?.length) {
      const cacheAge = Date.now() - cached.at;
      if (cacheAge < 120_000) {
        return json(cached.data);
      }
      return json({ ...cached.data, stale: true, offline: true, error: data?.message || "Bridge unreachable" });
    }
    return json(data);
  } catch (err) {
    if (cached?.data?.bars?.length) {
      const cacheAge = Date.now() - cached.at;
      if (cacheAge < 120_000) {
        return json(cached.data);
      }
      return json({ ...cached.data, stale: true, offline: true, error: err.message });
    }
    return json({ ok: false, error: err.message }, 502);
  }
}
