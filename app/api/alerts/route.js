import { getCols } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const { alertsCol } = await getCols();
  const filter = symbol ? { symbol: String(symbol).toUpperCase() } : {};
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
  const alert = {
    symbol: String(symbol).toUpperCase(),
    price: Number(body.price),
    condition: body.condition,
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
  broadcast({ type: "alerts_changed" });
  return json({ ok: true, alert });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  const filter = searchParams.get("filter") || "all";
  if (!symbol) return json({ ok: false, error: "symbol required" }, 400);

  const { alertsCol } = await getCols();
  const query = { symbol: String(symbol).toUpperCase() };
  if (filter === "star") {
    query.rating = { $ne: null };
  } else if (filter === "normal") {
    query.$or = [{ rating: null }, { rating: { $exists: false } }];
  }
  await alertsCol.deleteMany(query);
  broadcast({ type: "alerts_changed" });
  return json({ ok: true });
}
