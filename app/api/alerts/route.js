import { getCols } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json } from "@/lib/http";
import { toCanonicalSymbol } from "@/lib/symbols/mapping";
import { getSymbolAliases } from "@/lib/watchlistAliases";
import { invalidateAlertsCache } from "@/lib/alert-engine";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const rawSymbol = req.nextUrl.searchParams.get("symbol");
  const { alertsCol } = await getCols();
  let filter = {};
  if (rawSymbol) {
    const canon = toCanonicalSymbol(rawSymbol);
    const aliases = getSymbolAliases(rawSymbol);
    filter = { symbol: { $in: Array.from(new Set([rawSymbol, rawSymbol.toUpperCase(), canon, ...aliases])) } };
  }
  const alerts = await alertsCol.find(filter).sort({ createdAt: -1 }).toArray();
  return json({ ok: true, alerts });
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
