import { getCols } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json } from "@/lib/http";
import { toCanonicalSymbol } from "@/lib/symbols/mapping";
import { getSymbolAliases } from "@/lib/watchlistAliases";
import { getTradingDayStartSec } from "@/lib/time";

export const dynamic = "force-dynamic";
export const dynamicParams = true;
export const revalidate = 0;
export const fetchCache = "force-no-store";

const g = globalThis;
if (!(g._tsAlertsRouteInFlight instanceof Map)) g._tsAlertsRouteInFlight = new Map();
if (!(g._tsAlertsRouteCache instanceof Map)) g._tsAlertsRouteCache = new Map();
let lastPruneAlertsAt = 0;

function invalidateAlertsCache() {
  if (g._tsAlertsRouteCache instanceof Map) g._tsAlertsRouteCache.clear();
  g._tsAlertsCache = null;
  g._tsAlertsAt = 0;
}

async function pruneStaleTriggeredAlerts() {
  try {
    const { alertsCol } = await getCols();
    const todayStartSec = getTradingDayStartSec(new Date());
    const todayStartDate = new Date(todayStartSec * 1000);

    const cleanupRes = await alertsCol.deleteMany({
      status: "triggered",
      $or: [
        { triggeredAt: { $lt: todayStartDate } },
        { triggeredAt: null, createdAt: { $lt: todayStartDate } }
      ]
    });

    if (cleanupRes.deletedCount > 0) {
      invalidateAlertsCache();
      broadcast({ type: "alerts_changed" });
    }
    return cleanupRes.deletedCount || 0;
  } catch {
    return 0;
  }
}

export async function GET(req) {
  const rawSymbol = req.nextUrl.searchParams.get("symbol");
  const now = Date.now();

  // Periodic cleanup: purge stale triggered alerts once every 10m (never on every GET)
  if (now - lastPruneAlertsAt > 600_000) {
    lastPruneAlertsAt = now;
    pruneStaleTriggeredAlerts().catch(() => {});
  }

  const cacheKey = rawSymbol ? `sym:${rawSymbol}` : "all";
  if (!(g._tsAlertsRouteCache instanceof Map)) g._tsAlertsRouteCache = new Map();
  if (!(g._tsAlertsRouteInFlight instanceof Map)) g._tsAlertsRouteInFlight = new Map();

  const cached = g._tsAlertsRouteCache.get(cacheKey);
  if (cached && now - cached.at < 2000) {
    return json({ ok: true, alerts: cached.alerts });
  }

  if (g._tsAlertsRouteInFlight.has(cacheKey)) {
    try {
      const alerts = await g._tsAlertsRouteInFlight.get(cacheKey);
      return json({ ok: true, alerts });
    } catch {}
  }

  const queryPromise = (async () => {
    try {
      const { alertsCol } = await getCols();
      const todayStartSec = getTradingDayStartSec(new Date());
      const todayStartDate = new Date(todayStartSec * 1000);

      const staleTriggeredFilter = {
        $nor: [
          { status: "triggered", triggeredAt: { $lt: todayStartDate } },
          { status: "triggered", triggeredAt: null, createdAt: { $lt: todayStartDate } }
        ]
      };

      let filter = staleTriggeredFilter;
      if (rawSymbol) {
        const canon = toCanonicalSymbol(rawSymbol);
        const aliases = getSymbolAliases(rawSymbol);
        filter = {
          $and: [
            staleTriggeredFilter,
            { symbol: { $in: Array.from(new Set([rawSymbol, rawSymbol.toUpperCase(), canon, ...aliases])) } }
          ]
        };
      }
      const alerts = await alertsCol.find(filter).sort({ createdAt: -1 }).toArray();
      g._tsAlertsRouteCache.set(cacheKey, { at: Date.now(), alerts });
      return alerts;
    } finally {
      g._tsAlertsRouteInFlight.delete(cacheKey);
    }
  })();

  g._tsAlertsRouteInFlight.set(cacheKey, queryPromise);
  try {
    const alerts = await queryPromise;
    return json({ ok: true, alerts });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function POST(req) {
  const body = await req.json();
  const { symbol, note = "" } = body;
  
  if (!symbol) {
    return json({ ok: false, error: "symbol required" }, 400);
  }

  if (!Number.isFinite(Number(body.price)) || !["cross", "above", "below"].includes(body.condition)) {
    return json({ ok: false, error: "valid price and condition required" }, 400);
  }

  const { alertsCol } = await getCols();
  const canonicalSym = toCanonicalSymbol(symbol);
  const currentPrice = Number(body.currentPrice || body.initialPrice) || (globalThis._tsLastPrice?.get(canonicalSym) ?? globalThis._tsLastPrice?.get(symbol) ?? null);
  const alert = {
    symbol: canonicalSym,
    price: Number(body.price),
    condition: body.condition,
    initialPrice: Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : null,
    rating: body.rating || null,
    note: String(note).slice(0, 200),
    chainId: body.chainId || null,
    chainOrder: Number.isFinite(Number(body.chainOrder)) ? Number(body.chainOrder) : 0,
    status: body.status === "pending_chain" ? "pending_chain" : "active",
    createdAt: new Date(),
    triggeredAt: null,
  };

  const { insertedId } = await alertsCol.insertOne(alert);
  alert._id = insertedId;
  invalidateAlertsCache();
  broadcast({ type: "alerts_changed" });
  return json({ ok: true, alert });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const rawSymbol = searchParams.get("symbol");
  const filter = searchParams.get("filter") || "all";
  if (!rawSymbol) return json({ ok: false, error: "symbol required" }, 400);

  const canon = toCanonicalSymbol(rawSymbol);
  const aliases = getSymbolAliases(rawSymbol);
  const { alertsCol } = await getCols();
  const query = { symbol: { $in: Array.from(new Set([rawSymbol, rawSymbol.toUpperCase(), canon, ...aliases])) } };
  if (filter === "star") {
    query.rating = { $ne: null };
  } else if (filter === "normal") {
    query.$or = [{ rating: null }, { rating: { $exists: false } }];
  }
  await alertsCol.deleteMany(query);
  invalidateAlertsCache();
  broadcast({ type: "alerts_changed" });
  return json({ ok: true });
}
