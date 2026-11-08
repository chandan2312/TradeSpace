import { getCols, allWatchlists, invalidateWatchlistsCache } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json, oid } from "@/lib/http";
import { toCanonicalSymbol } from "@/lib/symbols/mapping";
import { runAutonomousScan } from "@/lib/autonomous/engine";

export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const rawSymbol = String((await req.json())?.symbol || "").trim();
  if (!rawSymbol) return json({ ok: false, error: "symbol required" }, 400);

  const canonicalSymbol = toCanonicalSymbol(rawSymbol);

  const { watchlistsCol } = await getCols();
  await watchlistsCol.updateOne({ _id }, { $addToSet: { symbols: canonicalSymbol } });

  invalidateWatchlistsCache();
  if (typeof globalThis._tsInvalidateAutonomousRouteCache === "function") {
    try { globalThis._tsInvalidateAutonomousRouteCache(); } catch {}
  }

  broadcast({ type: "watchlists_changed" });
  broadcast({ type: "autonomous_changed" });

  // Trigger non-blocking autonomous scan sweep for newly added symbol
  runAutonomousScan("watchlist_symbol_added").catch((err) => {
    console.warn("[watchlist symbol added scan error]", err?.message || err);
  });

  return json({ ok: true, watchlists: await allWatchlists(true) });
}
