import { json } from "@/lib/http";
import { executorCols, getConfig, getStats } from "@/lib/executor/store";
import { armSetup, cancelSetup, flattenSetup } from "@/lib/executor/engine";

export const dynamic = "force-dynamic";

// GET → full state for the /executor page
export async function GET() {
  try {
    const [{ tradesCol }, config, stats] = await Promise.all([executorCols(), getConfig(), getStats()]);
    const trades = await tradesCol.find({}).sort({ createdAt: -1 }).limit(200).toArray();
    return json({ ok: true, config, stats, trades, at: Date.now() });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// POST { action: "arm", setup } | { action: "cancel", id } | { action: "flatten", id }
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "arm") {
      const res = await armSetup(body.setup || {});
      return json(res, res.ok ? 200 : 400);
    }
    if (body.action === "cancel") {
      const res = await cancelSetup(body.id);
      return json(res, res.ok ? 200 : 400);
    }
    if (body.action === "flatten") {
      const res = await flattenSetup(body.id);
      return json(res, res.ok ? 200 : 400);
    }
    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
