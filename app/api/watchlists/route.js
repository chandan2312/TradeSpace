import { getCols, allWatchlists, invalidateWatchlistsCache } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ ok: true, watchlists: await allWatchlists() });
}

export async function POST(req) {
  const body = await req.json();
  const name = String(body?.name || "").trim().slice(0, 40);
  if (!name) return json({ ok: false, error: "name required" }, 400);

  const rawSymbols = Array.isArray(body?.symbols) ? body.symbols : [];
  const symbols = rawSymbols.map(String).map((s) => s.trim().toUpperCase()).filter(Boolean);

  const { watchlistsCol } = await getCols();
  await watchlistsCol.insertOne({ name, symbols, createdAt: new Date() });

  invalidateWatchlistsCache();
  if (typeof globalThis._tsInvalidateAutonomousRouteCache === "function") {
    try { globalThis._tsInvalidateAutonomousRouteCache(); } catch {}
  }

  broadcast({ type: "watchlists_changed" });
  return json({ ok: true, watchlists: await allWatchlists(true) });
}
