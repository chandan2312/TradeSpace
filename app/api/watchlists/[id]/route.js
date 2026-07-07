import { getCols, allWatchlists } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json, oid } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const name = String((await req.json())?.name || "").trim().slice(0, 40);
  if (!name) return json({ ok: false, error: "name required" }, 400);

  const { watchlistsCol } = await getCols();
  await watchlistsCol.updateOne({ _id }, { $set: { name } });
  broadcast({ type: "watchlists_changed" });
  return json({ ok: true, watchlists: await allWatchlists() });
}

export async function DELETE(_req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const { watchlistsCol } = await getCols();
  await watchlistsCol.deleteOne({ _id });
  broadcast({ type: "watchlists_changed" });
  return json({ ok: true, watchlists: await allWatchlists() });
}
