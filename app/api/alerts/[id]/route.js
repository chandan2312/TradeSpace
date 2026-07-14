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
  if (body?.chainId !== undefined) update.chainId = body.chainId;
  if (Number.isFinite(Number(body?.chainOrder))) update.chainOrder = Number(body.chainOrder);
  const { alertsCol } = await getCols();

  if (body?.status === "active" || body?.status === "pending_chain") {
    update.status = body.status;
    update.triggeredAt = null;

    // Smart Renewal: auto-flip the condition based on the current live price (only if active)
    if (update.status === "active") {
      const alert = await alertsCol.findOne({ _id });
      if (alert) {
        // Use the newly passed price if updating price and renewing together, else use existing
        const targetPrice = update.price !== undefined ? update.price : alert.price;
        const currentLivePrice = globalThis._tsLastPrice?.get(alert.symbol);
        
        if (currentLivePrice) {
          // If price is currently above the line, the only valid alert is waiting for it to go below (and vice versa)
          if (currentLivePrice >= targetPrice) {
            update.condition = "below";
          } else {
            update.condition = "above";
          }
        }
      }
    }
  }

  if (!Object.keys(update).length) {
    return json({ ok: false, error: "nothing to update" }, 400);
  }

  // Insert-Shifting Logic for joining chains
  if (update.chainId && update.chainOrder) {
    const target = await alertsCol.findOne({ _id });
    if (target) {
      await alertsCol.updateMany(
        { symbol: target.symbol, chainId: update.chainId, chainOrder: { $gte: update.chainOrder } },
        { $inc: { chainOrder: 1 } }
      );
    }
  }

  await alertsCol.updateOne({ _id }, { $set: update });
  broadcast({ type: "alerts_changed" });
  return json({ ok: true });
}

export async function DELETE(req, { params }) {
  const _id = oid(params.id);
  if (!_id) return json({ ok: false, error: "invalid id" }, 400);
  const deleteChain = req.nextUrl.searchParams.get("deleteChain") === "true";
  
  const { alertsCol } = await getCols();

  const target = await alertsCol.findOne({ _id });
  if (!target) return json({ ok: false, error: "not found" }, 404);

  if (!target.chainId) {
    await alertsCol.deleteOne({ _id });
  } else {
    if (deleteChain) {
       await alertsCol.deleteMany({ symbol: target.symbol, chainId: target.chainId });
    } else {
       await alertsCol.deleteOne({ _id });
       await alertsCol.updateMany(
         { symbol: target.symbol, chainId: target.chainId, chainOrder: { $gt: target.chainOrder } },
         { $inc: { chainOrder: -1 } }
       );
       
       if (target.status === "active") {
          await alertsCol.updateOne(
            { symbol: target.symbol, chainId: target.chainId, chainOrder: target.chainOrder, status: "pending_chain" },
            { $set: { status: "active" } }
          );
       }
    }
  }

  broadcast({ type: "alerts_changed" });
  return json({ ok: true });
}
