import { getCols, allWatchlists, invalidateWatchlistsCache } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json, oid } from "@/lib/http";
import { toCanonicalSymbol } from "@/lib/symbols/mapping";

export const dynamic = "force-dynamic";

// Body: { symbols: ["EURUSD", ...] } — full desired order, applied atomically.
export async function POST(req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const body = await req.json();
  const symbols = Array.isArray(body?.symbols)
    ? body.symbols.map((s) => toCanonicalSymbol(String(s))).slice(0, 500)
    : null;
  if (!symbols) return json({ ok: false, error: "symbols array required" }, 400);

  const { watchlistsCol } = await getCols();
  await watchlistsCol.updateOne({ _id }, { $set: { symbols } });

  invalidateWatchlistsCache();
  if (typeof globalThis._tsInvalidateAutonomousRouteCache === "function") {
    try { globalThis._tsInvalidateAutonomousRouteCache(); } catch {}
  }

  broadcast({ type: "watchlists_changed" });
  broadcast({ type: "autonomous_changed" });

  return json({ ok: true, watchlists: await allWatchlists(true) });
}
