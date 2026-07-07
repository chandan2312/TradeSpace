import { getCols, allWatchlists } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json, oid } from "@/lib/http";

export const dynamic = "force-dynamic";

// Body: { symbols: ["EURUSD", ...] } — full desired order, applied atomically.
export async function POST(req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const body = await req.json();
  const symbols = Array.isArray(body?.symbols)
    ? body.symbols.map((s) => String(s).toUpperCase()).slice(0, 500)
    : null;
  if (!symbols) return json({ ok: false, error: "symbols array required" }, 400);

  const { watchlistsCol } = await getCols();
  await watchlistsCol.updateOne({ _id }, { $set: { symbols } });
  broadcast({ type: "watchlists_changed" });
  return json({ ok: true, watchlists: await allWatchlists() });
}
