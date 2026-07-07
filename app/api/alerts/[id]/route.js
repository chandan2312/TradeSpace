import { getCols } from "@/lib/mongo";
import { broadcast } from "@/lib/realtime";
import { json, oid } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const body = await req.json();
  const update = {};
  if (Number.isFinite(Number(body?.price))) update.price = Number(body.price);
  if (["cross", "above", "below"].includes(body?.condition)) update.condition = body.condition;
  if (body?.note !== undefined) update.note = String(body.note).slice(0, 200);
  if (body?.status === "active") {
    update.status = "active";
    update.triggeredAt = null;
  }
  if (!Object.keys(update).length) {
    return json({ ok: false, error: "nothing to update" }, 400);
  }

  const { alertsCol } = await getCols();
  await alertsCol.updateOne({ _id }, { $set: update });
  broadcast({ type: "alerts_changed" });
  return json({ ok: true });
}

export async function DELETE(_req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const { alertsCol } = await getCols();
  await alertsCol.deleteOne({ _id });
  broadcast({ type: "alerts_changed" });
  return json({ ok: true });
}
