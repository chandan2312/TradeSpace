import { getCols, allWatchlists } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ ok: true, watchlists: await allWatchlists() });
}

export async function POST(req) {
  const name = String((await req.json())?.name || "").trim().slice(0, 40);
  if (!name) return json({ ok: false, error: "name required" }, 400);

  const { watchlistsCol } = await getCols();
  await watchlistsCol.insertOne({ name, symbols: [], createdAt: new Date() });
  broadcast({ type: "watchlists_changed" });
  return json({ ok: true, watchlists: await allWatchlists() });
}
