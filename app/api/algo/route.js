import { json } from "@/lib/http";
import { algoCols, getConfig, getStats } from "@/lib/algo/store";
import { scanOnce } from "@/lib/algo/engine";

export const dynamic = "force-dynamic";

// GET → full state for the /currency-algo page
export async function GET() {
  try {
    const [{ tradesCol }, config, stats] = await Promise.all([algoCols(), getConfig(), getStats()]);
    const trades = await tradesCol.find({}).sort({ createdAt: -1 }).limit(200).toArray();
    const lastScan = globalThis._tsAlgoLastScan || null;
    return json({ ok: true, config, stats, trades, lastScan, at: Date.now() });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// POST { action: "scan" } → force a scan now (works even while disabled)
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "scan") {
      const res = await scanOnce("manual");
      return json({ ok: true, scan: res });
    }
    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
