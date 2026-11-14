import { bridge, symbolsCache, SYMBOLS_TTL_MS } from "@/lib/bridge";
import { json } from "@/lib/http";
import { toCanonicalSymbol } from "@/lib/symbols/mapping";

export const dynamic = "force-dynamic";

const g = globalThis;
if (!g._tsSymbolsBridgeInFlight) g._tsSymbolsBridgeInFlight = null;

export async function GET(req) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") || "";
  const limit = sp.get("limit") || "100";
  const refresh = sp.get("refresh");
  const now = Date.now();
  const stale = now - symbolsCache.at > SYMBOLS_TTL_MS;
  const force = refresh === "1";

  try {
    if (stale || force || !symbolsCache.items.length) {
      if (!g._tsSymbolsBridgeInFlight) {
        g._tsSymbolsBridgeInFlight = bridge("POST", "/symbols", {}).finally(() => {
          g._tsSymbolsBridgeInFlight = null;
        });
      }
      const data = await g._tsSymbolsBridgeInFlight;
      if (data?.ok) {
        symbolsCache.at = Date.now();
        symbolsCache.items = data.symbols || [];
      } else if (!symbolsCache.items.length) {
        return json(data, 502);
      }
    }

    const query = String(q).trim().toLowerCase();
    let items = symbolsCache.items.map((s) => ({
      ...s,
      canonical: toCanonicalSymbol(s.name),
    }));

    if (query) {
      items = items.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.canonical.toLowerCase().includes(query) ||
          (s.description || "").toLowerCase().includes(query)
      );
    }
    const lim = Math.min(Number(limit) || 100, 500);
    return json({
      ok: true,
      total: items.length,
      count: Math.min(items.length, lim),
      symbols: items.slice(0, lim),
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}
