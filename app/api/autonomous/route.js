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
  pollBroker,
  startAutonomousLoop,
} from "../../../lib/autonomous/engine.js";
import { getCurrentTimeSlot, getAllTimeSlots, SYMBOL_SESSION_PROFILES, isTradingPermittedNow, getSymbolSessionProfile } from "../../../lib/autonomous/timeslots.js";
import { ENTRY_MODEL_DEFINITIONS } from "../../../lib/autonomous/models.js";
import { getMT5Account } from "../../../lib/autonomous/mt5.js";
import { syncMT5HistoryToJournalThrottled, isTradeSpaceTrade, JOURNAL_START_BROKER_SEC } from "../../../lib/journal/store.js";
import { getMainWatchlistSymbols, canonOf } from "../../../lib/autonomous/watchlist.js";
import { allWatchlists } from "../../../lib/mongo.js";

const g = globalThis;

const CLOSED_TRADES_PROJECTION = {
  brainSnapshot: 0,
  brain: 0,
  copierRouting: 0,
};

let lastBackgroundScanTriggerAt = 0;
let cachedResponsePayload = null;
let cachedResponseAt = 0;
let inFlightGetPromise = null;
const CACHE_TTL_MS = 2500; // 2.5s response cache deduplicates rapid client hits

export function invalidateAutonomousRouteCache() {
  cachedResponsePayload = null;
  cachedResponseAt = 0;
}
g._tsInvalidateAutonomousRouteCache = invalidateAutonomousRouteCache;

export async function GET() {
  const now = Date.now();
  if (cachedResponsePayload && (now - cachedResponseAt < CACHE_TTL_MS)) {
    return NextResponse.json(cachedResponsePayload, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Autonomous-Cache": "HIT",
      },
    });
  }

  if (inFlightGetPromise) {
    try {
      const coalesced = await inFlightGetPromise;
      return NextResponse.json(coalesced, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0",
          "X-Autonomous-Cache": "COALESCED",
        },
      });
    } catch (_) {}
  }

  inFlightGetPromise = (async () => {
    try {
      startAutonomousLoop();
      // Non-blocking background sync of MT5 history so page loads instantly
      syncMT5HistoryToJournalThrottled().catch(() => {});

      const { tradesCol, logsCol, controlCol } = await autonomousCols();

      // Fetch independent data sources concurrently (with 1500ms safety timeout on remote broker bridge)
      // Only query latest_autonomous_scan if leaderboard is not already hydrated in memory
      const [config, metrics, brokerAccountRes, rawOpenTrades, recentClosed, logs, persistedScan, mainWatchlistSymbols, userWatchlists] = await Promise.all([
        getConfig(),
        getMetrics(),
        Promise.race([
          getMT5Account().catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]),
        tradesCol.find({
          status: { $in: OPEN_STATES },
          brokerComment: { $not: { $regex: /^MQ:/i } },
          comment: { $not: { $regex: /^MQ:/i } },
          magicNumber: { $not: { $gte: 800000, $lte: 899999 } },
        }, { projection: CLOSED_TRADES_PROJECTION }).sort({ createdAt: -1 }).toArray(),
        tradesCol.find({
          $or: [
            { status: { $in: ["closed_tp", "closed_sl", "closed_be", "closed"] } },
            { filledAt: { $exists: true, $ne: null }, status: { $in: TERMINAL_STATES } },
          ],
          brokerComment: { $not: { $regex: /^MQ:/i } },
          comment: { $not: { $regex: /^MQ:/i } },
          magicNumber: { $not: { $gte: 800000, $lte: 899999 } },
          $and: [
            {
              $or: [
                { brokerEntryTime: { $gte: JOURNAL_START_BROKER_SEC } },
                { filledAt: { $gte: new Date(JOURNAL_START_BROKER_SEC * 1000) } },
                { createdAt: { $gte: new Date(JOURNAL_START_BROKER_SEC * 1000) } },
              ],
            },
          ],
        }, { projection: CLOSED_TRADES_PROJECTION }).sort({ closedAt: -1, filledAt: -1, createdAt: -1 }).limit(25).toArray(),
        logsCol.find({}).sort({ createdAt: -1 }).limit(50).toArray(),
        !g._tsAutonomousLeaderboard && controlCol
          ? controlCol.findOne({ _id: "latest_autonomous_scan" }, { projection: { "leaderboard.rankedPairs.snapshot": 0, "leaderboard.rankedPairs.ranges": 0 } }).catch(() => null)
          : Promise.resolve(null),
        getMainWatchlistSymbols(true).catch(() => []),
        allWatchlists(true).catch(() => []),
      ]);

      const allWatchlistSymbols = Array.from(new Set([
        ...(Array.isArray(mainWatchlistSymbols) ? mainWatchlistSymbols : []),
        ...((Array.isArray(userWatchlists) ? userWatchlists : []).flatMap((w) => w?.symbols || [])),
      ])).filter(Boolean);

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

      // Strip duplicate brain and stagedLevel to cut per-trade network payload in half
      const sanitizeTrade = (t) => {
        if (!t) return t;
        const { brain, stagedLevel, ...rest } = t;
        return rest;
      };
      const openTrades = rawOpenTrades.filter(isTradeSpaceTrade).map(sanitizeTrade);
      const cleanRecentClosed = recentClosed.filter(isTradeSpaceTrade);

      const activeTrades = openTrades.filter((trade) => ACTIVE_STATES.includes(trade.status) || trade.status === "pending");
      const currentEnabledModels = config.enabledModels || {};
      const stagedTrades = openTrades.filter((trade) => {
        if (!["staged", "armed", "confirming"].includes(trade.status)) return false;
        const mId = trade.modelId || trade.entryModel?.id;
        return !mId || currentEnabledModels[mId] !== false;
      });
      // Surface every nonterminal execution/reconciliation state without reproducing engine transitions.
      const executionTrades = openTrades.filter((trade) => !activeTrades.includes(trade) && !stagedTrades.includes(trade));

      // Hydrate leaderboard from memory or persisted scan from previous cycle
      if (!g._tsAutonomousLeaderboard && persistedScan?.leaderboard) {
        g._tsAutonomousLeaderboard = persistedScan.leaderboard;
      }
      let leaderboard = g._tsAutonomousLeaderboard || null;
      if (!leaderboard) {
        leaderboard = {
          rankedPairs: [],
          primeSetups: [],
          scannedAt: null,
          summary: { total: 0, prime: 0, watching: 0, blocked: 0 },
        };
      }

      const mainSymbolsList = Array.isArray(mainWatchlistSymbols) ? mainWatchlistSymbols : [];
      const mainSymbolSet = new Set(mainSymbolsList.map((s) => canonOf(s)));

      // Sanitize rankedPairs and ensure isInMainWatchlist flag & session profiles are synchronized with live config
      let sanitizedRanked = (leaderboard.rankedPairs || []).map((pair) => {
        const { snapshot, ...rest } = pair;
        const c = canonOf(rest.symbol || rest.tradeableSymbol);
        const inMain = mainSymbolSet.has(c);
        const sym = rest.symbol || rest.tradeableSymbol;
        const livePermitted = isTradingPermittedNow(new Date(), config, sym);
        const profileForPair = getSymbolSessionProfile(sym, config);
        const isSessionActive = Boolean(livePermitted.permitted);

        let pairStatus = rest.status;
        let pairVetoes = rest.vetoes || [];
        if (isSessionActive && (pairStatus === "OFF_SESSION_DEAD_ZONE" || pairStatus === "BLOCKED_TIMING" || pairStatus === "BLOCKED_DEAD_ZONE")) {
          pairStatus = rest.dir !== 0 ? "WATCHING_RETRACE" : "SCANNING_NEUTRAL";
          pairVetoes = pairVetoes.filter((v) => v.code !== "TIMING" && v.code !== "DEAD_ZONE" && v.code !== "OFF_SESSION");
        }

        const trueScore = Math.max(0, Math.min(100, Math.round(
          rest.stagedLevel?.confluenceScore ??
          rest.rawScore ??
          rest.confluenceBreakdown?.netScore ??
          rest.opportunityScore ??
          0
        )));
        return {
          ...rest,
          opportunityScore: trueScore,
          convictionBreakdown: rest.convictionBreakdown ?? rest.brain?.convictionBreakdown ?? null,
          primaryDrag: rest.primaryDrag ?? rest.brain?.primaryDrag ?? null,
          isInMainWatchlist: inMain,
          isTradeable: inMain,
          activeTimeSlot: currentTimeSlot,
          sessionProfile: {
            ...profileForPair,
            isCurrentlyActive: isSessionActive,
            reason: livePermitted.reason,
          },
          status: pairStatus,
          vetoes: pairVetoes,
        };
      });

      // Strict Model Sanitization: If an entry model was disabled in settings, strip it immediately from leaderboard pairs
      for (const pair of sanitizedRanked) {
        const mId = pair.entryModel?.id || pair.stagedLevel?.modelId;
        if (mId && currentEnabledModels[mId] === false) {
          pair.stagedLevel = null;
          pair.entryModel = null;
          pair.targets = [];
          pair.permitted = false;
          pair.status = pair.dir !== 0 ? "WATCHING_RETRACE" : "SCANNING_NEUTRAL";
          pair.statusReason = `Holding ${pair.dirLabel || "macro"} bias. Model [${mId}] disabled in settings; scanning for active models.`;
          pair.vetoes = [{ code: "MODEL_DISABLED", reason: `Entry model ${mId} is disabled in configuration.` }];
        }
      }

      // Detect any main watchlist symbols that are missing from current rankedPairs
      const existingSymbols = new Set(sanitizedRanked.map((p) => canonOf(p.symbol || p.tradeableSymbol)));
      const missingMainSymbols = mainSymbolsList.filter((s) => !existingSymbols.has(canonOf(s)));

      if (missingMainSymbols.length > 0) {
        for (const s of missingMainSymbols) {
          sanitizedRanked.push({
            radarKey: `${s}:day:scanning`,
            symbol: s,
            tradeableSymbol: s,
            isInMainWatchlist: true,
            isTradeable: true,
            permitted: false,
            dir: 0,
            dirLabel: "NEUTRAL",
            status: "SCANNING",
            statusReason: "Scanning order flow & SMC structure...",
            opportunityScore: 0,
            rawScore: 0,
            brain: {},
            stagedLevel: null,
            horizon: "day",
            horizonBadge: "4H-15M",
            horizonLabel: "Day (4H-15M)",
            scenario: { id: "day", label: "Day (4H-15M)", badge: "4H-15M" },
            vetoes: [{ code: "SCANNING", reason: "Analyzing multi-timeframe order flow" }],
          });
        }
      }

      leaderboard = {
        ...leaderboard,
        rankedPairs: sanitizedRanked,
        primeSetups: [],
      };

      // Check if scan is stale or missing watchlist symbols
      const scannedAtMs = leaderboard?.scannedAt ? new Date(leaderboard.scannedAt).getTime() : 0;
      const scanIntervalMs = Number(config?.scanIntervalMs || 180000);
      const isScanStale = !scannedAtMs || (Date.now() - scannedAtMs > scanIntervalMs);
      const hasMissingSymbols = missingMainSymbols.length > 0;

      // If scan is stale or missing watchlist symbols, trigger scan immediately
      const scanNow = Date.now();
      if ((isScanStale || hasMissingSymbols) && !g._tsAutonomousScanning && (config?.enabled || hasMissingSymbols) && (scanNow - lastBackgroundScanTriggerAt > (hasMissingSymbols ? 10000 : 60000))) {
        lastBackgroundScanTriggerAt = scanNow;
        runAutonomousScan(hasMissingSymbols ? "watchlist_symbol_added" : "interval").catch(() => {});
      }

      const events = [...rawOpenTrades.filter(isTradeSpaceTrade), ...cleanRecentClosed].flatMap((trade) =>
        (Array.isArray(trade.events) ? trade.events : []).map((event, index, timeline) => ({
          ...event,
          tradeId: trade._id,
          symbol: trade.symbol,
          vetoes: event.vetoes || (index === timeline.length - 1 ? trade.vetoes : undefined),
        }))
      ).sort((a, b) => new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt)).slice(0, 80);

      const payload = {
        ok: true,
        config,
        metrics,
        brokerAccount,
        activeTrades,
        stagedTrades,
        executionTrades,
        recentClosed: cleanRecentClosed,
        leaderboard,
        currentTimeSlot,
        allTimeSlots: getAllTimeSlots(config),
        allSymbolProfiles: SYMBOL_SESSION_PROFILES,
        allEntryModels: ENTRY_MODEL_DEFINITIONS,
        mainWatchlistSymbols: Array.isArray(mainWatchlistSymbols) ? mainWatchlistSymbols : [],
        allWatchlistSymbols: allWatchlistSymbols || [],
        universe: allWatchlistSymbols.length ? allWatchlistSymbols : (config.universe || []),
        logs,
        events,
        executionDiagnostics: {
          openStates: OPEN_STATES,
          pendingCount: executionTrades.length,
          brokerStates: [...new Set(rawOpenTrades.map((trade) => trade.brokerStatus).filter(Boolean))],
          operations: rawOpenTrades.filter((trade) => trade.operation).map((trade) => ({
            tradeId: trade._id,
            symbol: trade.symbol,
            status: trade.status,
            brokerStatus: trade.brokerStatus,
            operation: trade.operation,
          })),
        },
        generatedAt: new Date().toISOString(),
        isScanning: !!g._tsAutonomousScanning,
      };

      cachedResponsePayload = payload;
      cachedResponseAt = Date.now();
      return payload;
    } finally {
      inFlightGetPromise = null;
    }
  })();

  try {
    const payload = await inFlightGetPromise;
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Autonomous-Cache": "MISS",
      },
    });
  } catch (err) {
    console.error("[GET /api/autonomous error]", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  invalidateAutonomousRouteCache();
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

    if (action === "sync_broker" || action === "reconcile") {
      await pollBroker();
      return NextResponse.json({ ok: true, message: "Broker state reconciled" });
    }

    if (action === "dismiss" || action === "force_resolve") {
      if (!body.tradeId) return NextResponse.json({ ok: false, error: "Missing tradeId" }, { status: 400 });
      const res = await dismissStagedTrade(body.tradeId, body.reason || "Manual resolution by trader");
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
