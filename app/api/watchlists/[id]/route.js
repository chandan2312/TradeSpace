import { getCols, allWatchlists, invalidateWatchlistsCache } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json, oid } from "@/lib/http";
import { runAutonomousScan } from "@/lib/autonomous/engine";

export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const name = String((await req.json())?.name || "").trim().slice(0, 40);
  if (!name) return json({ ok: false, error: "name required" }, 400);

  const { watchlistsCol } = await getCols();
  await watchlistsCol.updateOne({ _id }, { $set: { name } });

  invalidateWatchlistsCache();
  if (typeof globalThis._tsInvalidateAutonomousRouteCache === "function") {
    try { globalThis._tsInvalidateAutonomousRouteCache(); } catch {}
  }

  broadcast({ type: "watchlists_changed" });
  broadcast({ type: "autonomous_changed" });

  runAutonomousScan("watchlist_updated").catch((err) => {
    console.warn("[watchlist updated scan error]", err?.message || err);
  });

  return json({ ok: true, watchlists: await allWatchlists(true) });
}

export async function DELETE(_req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const { watchlistsCol } = await getCols();
  await watchlistsCol.deleteOne({ _id });

  invalidateWatchlistsCache();
  if (typeof globalThis._tsInvalidateAutonomousRouteCache === "function") {
    try { globalThis._tsInvalidateAutonomousRouteCache(); } catch {}
  }

  broadcast({ type: "watchlists_changed" });
  broadcast({ type: "autonomous_changed" });

  runAutonomousScan("watchlist_deleted").catch((err) => {
    console.warn("[watchlist deleted scan error]", err?.message || err);
  });

  return json({ ok: true, watchlists: await allWatchlists(true) });
}
