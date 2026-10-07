// API route: /api/autonomous — State and interactive dispatch for Autonomous Brain Trader.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import {
  autonomousCols,
  getConfig,
  setConfig,
  getMetrics,
  ACTIVE_STATES,
  OPEN_STATES,
  TERMINAL_STATES,
} from "../../../lib/autonomous/store.js";
import {
  runAutonomousScan,
  approveStagedTrade,
  dismissStagedTrade,
  closeActiveTrade,
  modifyTradeTarget,
  startAutonomousLoop,
} from "../../../lib/autonomous/engine.js";
import { getCurrentTimeSlot, getAllTimeSlots, SYMBOL_SESSION_PROFILES } from "../../../lib/autonomous/timeslots.js";
import { ENTRY_MODEL_DEFINITIONS } from "../../../lib/autonomous/models.js";
import { getMT5Account } from "../../../lib/autonomous/mt5.js";
import { syncMT5HistoryToJournalThrottled } from "../../../lib/journal/store.js";

const g = globalThis;

const CLOSED_TRADES_PROJECTION = {
  brainSnapshot: 0,
  brain: 0,
  levelDetails: 0,
  stagedLevel: 0,
  entryModel: 0,
  copierRouting: 0,
};

let lastBackgroundScanTriggerAt = 0;

export async function GET() {
  try {
    startAutonomousLoop();
    // Non-blocking background sync of MT5 history so page loads instantly
    syncMT5HistoryToJournalThrottled().catch(() => {});

    const { tradesCol, logsCol, controlCol } = await autonomousCols();

    // Fetch independent data sources concurrently (with 2500ms safety timeout on remote broker bridge)
    const [config, metrics, brokerAccountRes, openTrades, recentClosed, logs, persistedScan] = await Promise.all([
      getConfig(),
      getMetrics(),
      Promise.race([
        getMT5Account().catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
      ]),
      tradesCol.find({ status: { $in: OPEN_STATES } }).sort({ createdAt: -1 }).toArray(),
      tradesCol.find({ status: { $in: TERMINAL_STATES } }, { projection: CLOSED_TRADES_PROJECTION }).sort({ closedAt: -1, createdAt: -1 }).limit(50).toArray(),
      logsCol.find({}).sort({ createdAt: -1 }).limit(50).toArray(),
      controlCol.findOne({ _id: "latest_autonomous_scan" }).catch(() => null),
    ]);

    const currentTimeSlot = getCurrentTimeSlot(new Date(), config);

    let brokerAccount = null;
    if (brokerAccountRes?.ok && brokerAccountRes.account) {
      brokerAccount = brokerAccountRes.account;
      const liveEq = Number(brokerAccount.equity ?? brokerAccount.balance);
      if (liveEq > 0 && Math.abs((config.accountSize || 0) - liveEq) > 1) {
        config.accountSize = liveEq;
        setConfig({ accountSize: liveEq }).catch(() => {});
      }
    }

    const activeTrades = openTrades.filter((trade) => ACTIVE_STATES.includes(trade.status));
    const stagedTrades = openTrades.filter((trade) => ["staged", "armed", "confirming"].includes(trade.status));
    // Surface every nonterminal execution/reconciliation state without reproducing engine transitions.
    const executionTrades = openTrades.filter((trade) => !activeTrades.includes(trade) && !stagedTrades.includes(trade));

    // Hydrate leaderboard from memory or persisted scan from previous cycle
    if (!g._tsAutonomousLeaderboard && persistedScan?.leaderboard) {
      g._tsAutonomousLeaderboard = persistedScan.leaderboard;
    }
    const leaderboard = g._tsAutonomousLeaderboard || null;

    // Check if scan is stale beyond the configured cycle period
    const scannedAtMs = leaderboard?.scannedAt ? new Date(leaderboard.scannedAt).getTime() : 0;
    const scanIntervalMs = Number(config?.scanIntervalMs || 180000);
    const isScanStale = !scannedAtMs || (Date.now() - scannedAtMs > scanIntervalMs);

    // If scan is stale and engine is not already scanning, trigger background scan without blocking page load (throttled to max 1 attempt per 60s)
    const now = Date.now();
    if (isScanStale && !g._tsAutonomousScanning && config?.enabled && (now - lastBackgroundScanTriggerAt > 60000)) {
      lastBackgroundScanTriggerAt = now;
      runAutonomousScan("interval").catch(() => {});
    }

    const events = [...openTrades, ...recentClosed].flatMap((trade) =>
      (Array.isArray(trade.events) ? trade.events : []).map((event, index, timeline) => ({
        ...event,
        tradeId: trade._id,
        symbol: trade.symbol,
        vetoes: event.vetoes || (index === timeline.length - 1 ? trade.vetoes : undefined),
      }))
    ).sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt)).slice(0, 80);

    return NextResponse.json({
      ok: true,
      config,
      metrics,
      brokerAccount,
      activeTrades,
      stagedTrades,
      openTrades,
      executionTrades,
      recentClosed,
      leaderboard,
      currentTimeSlot,
      allTimeSlots: getAllTimeSlots(config),
      allSymbolProfiles: SYMBOL_SESSION_PROFILES,
      allEntryModels: ENTRY_MODEL_DEFINITIONS,
      logs,
      events,
      executionDiagnostics: {
        openStates: OPEN_STATES,
        pendingCount: executionTrades.length,
        brokerStates: [...new Set(openTrades.map((trade) => trade.brokerStatus).filter(Boolean))],
        operations: openTrades.filter((trade) => trade.operation).map((trade) => ({
          tradeId: trade._id,
          symbol: trade.symbol,
          status: trade.status,
          brokerStatus: trade.brokerStatus,
          operation: trade.operation,
        })),
      },
      generatedAt: new Date().toISOString(),
      isScanning: !!g._tsAutonomousScanning,
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      },
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
      const res = await closeActiveTrade(body.tradeId, body.reason || "Manual user close", Boolean(body.closeSiblings));
      return NextResponse.json(res);
    }

    if (action === "modify_target" || action === "update_rr") {
      if (!body.tradeId) return NextResponse.json({ ok: false, error: "Missing tradeId" }, { status: 400 });
      const res = await modifyTradeTarget(body.tradeId, {
        targetRR: body.targetRR,
        tpPrice: body.tpPrice,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "toggle") {
      const cfg = await getConfig();
      const updated = await setConfig({ enabled: !cfg.enabled });
      return NextResponse.json({ ok: true, config: updated });
    }

    if (action === "toggleLive") {
      const cfg = await getConfig();
      const nextLive = !cfg.liveTrading;
      const updated = await setConfig({
        liveTrading: nextLive,
        ...(nextLive && cfg.executionMode === "paper" ? { executionMode: "copilot" } : {}),
      });
      return NextResponse.json({ ok: true, config: updated });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("[POST /api/autonomous error]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
