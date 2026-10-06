import { getJournalTrades, calculateJournalKpis, updateJournalTrade } from "@/lib/journal/store";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const model = searchParams.get("model"); // "milestone_50", "prop_firm_safe", "all"
    const horizon = searchParams.get("horizon"); // "swing", "day", "scalp"
    const outcome = searchParams.get("outcome"); // "WIN", "LOSS", "BREAKEVEN", "OPEN"
    const symbol = searchParams.get("symbol");

    const query = {};
    if (symbol && symbol !== "ALL") {
      query.symbol = symbol.toUpperCase();
    }
    if (model && model !== "all") {
      query.managementLogic = model;
    }

    const allTrades = await getJournalTrades(query);

    // Apply any memory filters
    let filtered = allTrades;
    if (horizon && horizon !== "ALL") {
      filtered = filtered.filter((t) => t.horizon.toLowerCase().includes(horizon.toLowerCase()));
    }
    if (outcome && outcome !== "ALL") {
      filtered = filtered.filter((t) => t.outcome === outcome);
    }

    const kpis = calculateJournalKpis(filtered);

    return json({
      ok: true,
      trades: filtered,
      kpis,
      totalCount: filtered.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[GET /api/journal error]", err);
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const tradeId = body.tradeId || body.id;
    if (!tradeId) {
      return json({ ok: false, error: "Missing tradeId" }, 400);
    }

    const res = await updateJournalTrade(tradeId, {
      notes: body.notes,
      tags: body.tags,
      imageUrl: body.imageUrl || body.screenshotUrl,
      rating: body.rating,
    });

    return json({ ok: true, tradeId, updated: res.ok });
  } catch (err) {
    console.error("[POST /api/journal error]", err);
    return json({ ok: false, error: err.message }, 500);
  }
}
