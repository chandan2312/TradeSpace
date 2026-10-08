import { bridge, ratesCache, RATES_TTL_MS } from "@/lib/bridge";
import { json } from "@/lib/http";
import { normalizeCandles } from "@/lib/candleNormalization";

export const dynamic = "force-dynamic";

const TF_NORMALIZE = {
  "1M": "M1", "5M": "M5", "15M": "M15", "30M": "M30", "1H": "H1", "4H": "H4", "1D": "D1",
  "M1": "M1", "M5": "M5", "M15": "M15", "M30": "M30", "H1": "H1", "H4": "H4", "D1": "D1",
};

export async function GET(req) {
  const sp = req.nextUrl.searchParams;
  const symbol = sp.get("symbol");
  const rawTf = String(sp.get("tf") || "M5").toUpperCase();
  const tf = TF_NORMALIZE[rawTf] || rawTf;
  const count = sp.get("count") || 600;
  const offset = sp.get("offset") || 0;
  if (!symbol) return json({ ok: false, error: "symbol required" }, 400);

  const sym = String(symbol).toUpperCase();
  const n = Math.min(Number(count) || 600, 5000);
  const off = Math.max(0, Number(offset) || 0);
  
  // Cache keys must include offset now
  const key = `${sym}:${tf}:${n}:${off}`;

  const cached = ratesCache.get(key);
  if (cached && Date.now() - cached.at < RATES_TTL_MS) return json(cached.data);

  try {
    const data = await bridge("POST", "/rates", { sym, timeframe: tf, count: n, offset: off }, { timeoutMs: 30_000 });
    if (data.ok && Array.isArray(data.bars)) {
      data.bars = normalizeCandles(data.bars, tf);
      ratesCache.set(key, { at: Date.now(), data });
    }
    return json(data);
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}
