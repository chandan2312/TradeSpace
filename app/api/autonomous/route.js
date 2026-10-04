// API route: /api/autonomous — State and interactive dispatch for Autonomous Brain Trader.

import { NextResponse } from "next/server";
import {
  autonomousCols,
  getConfig,
  setConfig,
  getMetrics,
  ACTIVE_STATES,
  TERMINAL_STATES,
} from "../../../lib/autonomous/store.js";
import {
  runAutonomousScan,
  approveStagedTrade,
  dismissStagedTrade,
  closeActiveTrade,
  startAutonomousLoop,
} from "../../../lib/autonomous/engine.js";
import { getCurrentTimeSlot, getAllTimeSlots } from "../../../lib/autonomous/timeslots.js";
import { ENTRY_MODEL_DEFINITIONS } from "../../../lib/autonomous/models.js";

const g = globalThis;

export async function GET() {
  try {
    startAutonomousLoop();
    const { tradesCol, logsCol } = await autonomousCols();
    const config = await getConfig();
    const metrics = await getMetrics();
    const currentTimeSlot = getCurrentTimeSlot();

    const activeTrades = await tradesCol
      .find({ status: { $in: ACTIVE_STATES } })
      .sort({ createdAt: -1 })
      .toArray();

    const stagedTrades = await tradesCol
      .find({ status: { $in: ["staged", "armed", "confirming"] } })
      .sort({ createdAt: -1 })
      .toArray();

    const recentClosed = await tradesCol
      .find({ status: { $in: TERMINAL_STATES } })
      .sort({ closedAt: -1, createdAt: -1 })
      .limit(30)
      .toArray();

    const logs = await logsCol
      .find({})
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({
      ok: true,
      config,
      metrics,
      activeTrades,
      stagedTrades,
      recentClosed,
      leaderboard: g._tsAutonomousLeaderboard || null,
      currentTimeSlot,
      allTimeSlots: getAllTimeSlots(),
      allEntryModels: ENTRY_MODEL_DEFINITIONS,
      logs,
      isScanning: !!g._tsAutonomousScanning,
    });
  } catch (err) {
    console.error("[GET /api/autonomous error]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === "scan") {
      const res = await runAutonomousScan("manual");
      return NextResponse.json(res);
    }

    if (action === "approve") {
      if (!body.tradeId) return NextResponse.json({ ok: false, error: "Missing tradeId" }, { status: 400 });
      const res = await approveStagedTrade(body.tradeId);
      return NextResponse.json(res);
    }

    if (action === "dismiss") {
      if (!body.tradeId) return NextResponse.json({ ok: false, error: "Missing tradeId" }, { status: 400 });
      const res = await dismissStagedTrade(body.tradeId);
      return NextResponse.json(res);
    }

    if (action === "close") {
      if (!body.tradeId) return NextResponse.json({ ok: false, error: "Missing tradeId" }, { status: 400 });
      const res = await closeActiveTrade(body.tradeId, body.reason || "Manual user close");
      return NextResponse.json(res);
    }

    if (action === "toggle") {
      const cfg = await getConfig();
      const updated = await setConfig({ enabled: !cfg.enabled });
      return NextResponse.json({ ok: true, config: updated });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("[POST /api/autonomous error]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
