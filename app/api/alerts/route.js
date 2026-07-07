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
  const { symbol, price, condition = "cross", note = "" } = await req.json();
  if (!symbol || !Number.isFinite(Number(price))) {
    return json({ ok: false, error: "symbol and numeric price required" }, 400);
  }
  if (!["cross", "above", "below"].includes(condition)) {
    return json({ ok: false, error: "condition must be cross|above|below" }, 400);
  }

  const { alertsCol } = await getCols();
  const alert = {
    symbol: String(symbol).toUpperCase(),
    price: Number(price),
    condition,
    note: String(note).slice(0, 200),
    status: "active",
    createdAt: new Date(),
    triggeredAt: null,
  };
  const { insertedId } = await alertsCol.insertOne(alert);
  alert._id = insertedId;
  broadcast({ type: "alerts_changed" });
  return json({ ok: true, alert });
}
