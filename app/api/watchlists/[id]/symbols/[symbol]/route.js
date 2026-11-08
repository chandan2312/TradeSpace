import { getCols, allWatchlists, invalidateWatchlistsCache } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json, oid } from "@/lib/http";
import { toCanonicalSymbol } from "@/lib/symbols/mapping";
import { getSymbolAliases } from "@/lib/watchlistAliases";
import { runAutonomousScan } from "@/lib/autonomous/engine";

export const dynamic = "force-dynamic";

export async function DELETE(_req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const rawSymbol = String(params.symbol || "").trim();
  const canon = toCanonicalSymbol(rawSymbol);
  const aliases = getSymbolAliases(rawSymbol);
  const targets = Array.from(new Set([rawSymbol, rawSymbol.toUpperCase(), canon, ...aliases]));

  const { watchlistsCol } = await getCols();
  await watchlistsCol.updateOne(
    { _id },
    { $pull: { symbols: { $in: targets } } }
  );

  invalidateWatchlistsCache();
  if (typeof globalThis._tsInvalidateAutonomousRouteCache === "function") {
    try { globalThis._tsInvalidateAutonomousRouteCache(); } catch {}
  }

  broadcast({ type: "watchlists_changed" });
  broadcast({ type: "autonomous_changed" });

  runAutonomousScan("watchlist_symbol_removed").catch((err) => {
    console.warn("[watchlist symbol removed scan error]", err?.message || err);
  });

  return json({ ok: true, watchlists: await allWatchlists(true) });
}
