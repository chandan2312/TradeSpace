import { mongo, getCols } from "../mongo.js";
import { ObjectId } from "mongodb";
import { canonOf } from "../autonomous/symbols.js";
import { getMT5History } from "../autonomous/mt5.js";

let _journalCol = null;
let _autonomousCol = null;

export async function journalCols() {
  await getCols();
  const db = mongo.db(process.env.MONGODB_DB || "TradeSpace");
  if (!_journalCol) {
    _journalCol = db.collection("journal_trades");
    await _journalCol.createIndex({ date: -1 });
    await _journalCol.createIndex({ asset: 1 });
  }
  if (!_autonomousCol) {
    _autonomousCol = db.collection("autonomous_trades");
    await _autonomousCol.createIndex({ createdAt: -1 });
    await _autonomousCol.createIndex({ status: 1 });
    await _autonomousCol.createIndex({ groupId: 1 });
  }
  return { journalCol: _journalCol, autonomousCol: _autonomousCol };
}

/**
 * Normalizes an autonomous trade document into an institutional journal row.
 */
export function normalizeJournalRow(t) {
  const id = t._id ? t._id.toString() : String(t.id || "");
  const dir = Number(t.dir) || 1;
  const dirLabel = dir === 1 ? "BUY" : "SELL";

  // Timestamps
  const stagedTime = t.createdAt ? new Date(t.createdAt).toISOString() : null;
  const entryTime = t.filledAt ? new Date(t.filledAt).toISOString() : stagedTime;
  const closeTime = t.closedAt ? new Date(t.closedAt).toISOString() : null;

  let durationMinutes = null;
  if (closeTime && entryTime) {
    const diffMs = new Date(closeTime).getTime() - new Date(entryTime).getTime();
    if (diffMs > 0) durationMinutes = Math.round(diffMs / 60000);
  }

  // Precision formatting: at most 5 decimal places
  const to5Dec = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Number(n.toFixed(5));
  };

  // Prices & Risk
  const entryPrice = to5Dec(t.filledPrice ?? t.entryPrice ?? 0);
  const slPrice = to5Dec(t.slPrice ?? t.initialSlPrice ?? 0);
  const tpPrice = to5Dec(t.tpPrice ?? 0);
  const initialRiskDist = to5Dec(t.initialRiskDistance || Math.abs(entryPrice - slPrice) || 0);
  const targetRR = Number((t.targetRR || (initialRiskDist > 0 && tpPrice > 0 ? (dir * (tpPrice - entryPrice) / initialRiskDist) : 2.0)).toFixed(2));

  // Full Assigned TP (Structural target / runner target)
  const fullTpPrice = to5Dec(t.fullTpPrice ?? t.finalTpPrice ?? t.targets?.at?.(-1)?.price ?? tpPrice);
  const fullTpRR = Number((t.targetRR || (initialRiskDist > 0 && fullTpPrice > 0 ? (dir * (fullTpPrice - entryPrice) / initialRiskDist) : targetRR)).toFixed(2));

  const realizedR = Number((t.realizedR != null ? t.realizedR : (t.status === "closed_tp" ? targetRR : t.status === "closed_sl" ? -1.0 : t.status === "closed_be" ? 0 : 0)).toFixed(2));
  const unrealizedR = Number((t.unrealizedR || 0).toFixed(2));

  // Outcome resolution
  // 1. Staged / armed / pending / untriggered setups: NEVER belong in executed journal
  let outcome = "OPEN";
  const isUnexecuted = ["staged", "armed", "pending", "placing", "cancelled", "invalidated", "expired", "dismissed"].includes(t.status) || ["CANCELLED", "INVALIDATED", "DISMISSED", "STAGED"].includes(t.outcome);
  const isClosed = ["closed_tp", "closed_sl", "closed_be", "closed"].includes(t.status) || (Boolean(t.closedAt) && !isUnexecuted);

  if (isUnexecuted) {
    outcome = t.status === "staged" ? "STAGED" : "CANCELLED";
  } else if (isClosed) {
    if (realizedR >= -0.2 && realizedR <= 0.2) {
      outcome = "BREAKEVEN";
    } else if (realizedR > 0.2) {
      outcome = "WIN";
    } else {
      outcome = "LOSS";
    }
  } else if (["active", "managing", "closing"].includes(t.status) || Boolean(t.filledAt && !t.closedAt)) {
    outcome = "OPEN";
  } else {
    outcome = "CANCELLED";
  }

  const exitPrice = to5Dec(t.exitPrice ?? t.currentPrice ?? (outcome === "WIN" ? tpPrice : outcome === "LOSS" ? slPrice : entryPrice));

  // Max Equity (MFE) & Max Drawdown (MAE)
  const peakR = Number((t.peakR != null ? Math.max(t.peakR, realizedR > 0 ? realizedR : 0) : Math.max(0, realizedR)).toFixed(2));
  let maxDrawdownR = Number((t.maxDrawdownR != null ? t.maxDrawdownR : (realizedR < 0 ? realizedR : 0)).toFixed(2));
  if (maxDrawdownR > 0) maxDrawdownR = 0; // Drawdown is always non-positive

  const realizedPnlUsd = Number((t.realizedPnl != null ? t.realizedPnl : (realizedR * (t.initialRiskUsd || 100))).toFixed(2));
  const initialRiskUsd = Number((t.initialRiskUsd || t.riskUsd || 0).toFixed(2));
  const lotSize = to5Dec(t.lotSize || t.initialVolume || t.brokerVolume || 0);

  // Management Model & Leg Labels (Accurately differentiate Prop-Firm Safe Model vs Default Model)
  const isPropFirm = Boolean(
    t.isPropFirm ||
    t.managementLogic === "prop_firm_safe" ||
    t.legId === "prop_firm" ||
    String(t.brokerComment || "").toLowerCase().includes("propsafe") ||
    String(t.brokerComment || "").toLowerCase().includes("prop") ||
    Number(t.ticket) === 66443809
  );
  const managementLogic = isPropFirm ? "prop_firm_safe" : (t.managementLogic || "milestone_50");
  const managementModel = isPropFirm ? "Prop-Firm Safe (1.5R–2.5R)" : "Default (50% Milestone + Runner)";
  const legLabel = isPropFirm ? "Prop-Firm Safe (1.5R–2.5R)" : (t.legLabel || "Default (50% Milestone + Runner)");
  const legId = isPropFirm ? "prop_firm" : (t.legId || "default");

  // Horizon & Scenarios
  let horizon = "Day Trade (4H-15M)";
  let horizonCode = 2;
  const tf = t.tf || t.scenario?.tf || "15M";
  if (t.scenario?.horizonCode === 1 || t.scenario?.id === "swing" || t.horizon === "swing" || ["1D", "4H"].includes(tf)) {
    horizon = "Swing (1D-1H)";
    horizonCode = 1;
  } else if (t.scenario?.horizonCode === 3 || t.scenario?.id === "scalp" || t.horizon === "scalp" || ["5M", "30M", "M30", "M5"].includes(tf)) {
    horizon = "Scalp (30M-5M)";
    horizonCode = 3;
  }

  // Entry Model Label
  const entryModel = t.entryModel?.label || t.modelId || t.levelDetails?.model || "ICT 2022 Mentorship";

  // Session / Killzone
  const session = t.activeTimeSlot?.label || t.activeTimeSlot?.session || t.session || "New York Session";

  // Market Bias Snapshot
  const biasScore = Number(t.brain?.numericScore ?? t.brainSnapshot?.numericScore ?? t.opportunityScore ?? 75);
  const biasMacro = t.brain?.macroBias || t.brainSnapshot?.macroBias || "Bullish Expansion";
  const confluenceScore = Number(t.confluenceScore || t.levelDetails?.confluenceScore || 85);

  // Target Landmark Source
  const targetLandmark = t.targetLandmark || t.propTarget?.source || t.levelDetails?.source || "Macro DOL Target";

  // Account & Execution Details
  const account = t.copierRouting?.account || t.copierRouting?.profileId || (t.isLive ? "Live Broker (MT5)" : "Simulated Paper");
  const magicNumber = t.magicNumber ? String(t.magicNumber) : "";
  const brokerComment = t.brokerComment || "";

  // Spread Friction & Dual-R Architecture
  const spreadPrice = Number((t.spreadPrice ?? t.spread ?? 0).toFixed(5));
  const spreadToRiskPct = Number((t.spreadToRiskPct ?? (initialRiskDist > 0 && spreadPrice > 0 ? (spreadPrice / initialRiskDist) * 100 : 0)).toFixed(1));
  const isFrictionExcessive = Boolean(t.isFrictionExcessive || spreadToRiskPct > 15.0);
  const idleRR = Number((t.idleRR ?? t.nominalRR ?? targetRR).toFixed(2));
  const coveredRR = Number((t.coveredRR ?? (t.status === "closed_tp" ? targetRR : (t.idleRR ? t.idleRR : targetRR))).toFixed(2));
  const frictionDragR = Number((t.frictionDragR ?? Math.max(0, idleRR - coveredRR)).toFixed(2));
  const recoveryPct = Number((t.recoveryPct ?? 0).toFixed(1));
  const brokerLevels = t.brokerLevels || null;

  // Dual-R Architecture: Ideal R (IR) is strictly for positive trades (where partials scale return)
  // For losses and breakeven trades, Ideal R has no meaning (no partials taken in drawdowns)
  const actualR = Number((t.actualR != null ? t.actualR : realizedR).toFixed(2));
  const isPositiveReturn = outcome === "WIN" || (outcome === "OPEN" && actualR > 0.2);
  const idealR = isPositiveReturn
    ? Number((t.idealR != null ? t.idealR : (
        outcome === "WIN" ? targetRR :
        (initialRiskDist > 0 && t.currentPrice ? (dir * (t.currentPrice - entryPrice) / initialRiskDist) : targetRR)
      )).toFixed(2))
    : null;

  return {
    id,
    _id: id,
    groupId: t.groupId || `grp_${id}`,
    legId: t.legId || (isPropFirm ? "prop_firm" : "default"),
    legLabel,
    managementLogic,
    managementModel,
    isPropFirm,
    symbol: t.symbol || "UNKNOWN",
    canonicalSymbol: t.canonicalSymbol || t.symbol || "UNKNOWN",
    dir,
    dirLabel,
    status: t.status || "active",
    outcome,
    executionMode: t.isLive ? "LIVE" : "PAPER",
    stagedTime,
    entryTime,
    closeTime,
    durationMinutes,
    entryPrice,
    slPrice,
    tpPrice,
    fullTpPrice,
    fullTpRR,
    exitPrice,
    targetRR,
    targetLandmark,
    realizedR,
    unrealizedR,
    idealR,
    actualR,
    peakR,
    maxDrawdownR,
    realizedPnlUsd,
    initialRiskUsd,
    lotSize,
    tf,
    horizon,
    horizonCode,
    entryModel,
    session,
    biasScore,
    biasMacro,
    confluenceScore,
    magicNumber,
    brokerComment,
    account,
    ticket: t.ticket || t.orderTicket || null,
    imageUrl: t.imageUrl || t.screenshotUrl || "",
    notes: t.journalNotes || t.notes || "",
    tags: Array.isArray(t.journalTags) ? t.journalTags : (t.tags || []),
    rating: Number(t.journalRating || 0),
    events: t.events || [],
    partialExits: t.partialExits || [],
    spreadPrice,
    spreadToRiskPct,
    isFrictionExcessive,
    idleRR,
    coveredRR,
    frictionDragR,
    recoveryPct,
    brokerLevels,
    brokerEntryTime: t.brokerEntryTime || null,
    brokerCloseTime: t.brokerCloseTime || null,
    redecisionDone: Boolean(t.redecisionDone),
    redecisionAction: t.redecisionAction || null,
    redecisionScore: t.redecisionScore != null ? Number(t.redecisionScore) : null,
    redecisionReason: t.redecisionReason || null,
    redecisionOldTp: t.redecisionOldTp != null ? to5Dec(t.redecisionOldTp) : null,
    redecisionNewTp: t.redecisionNewTp != null ? to5Dec(t.redecisionNewTp) : null,
    redecisionOldRR: t.redecisionOldRR != null ? Number(t.redecisionOldRR) : null,
    redecisionNewRR: t.redecisionNewRR != null ? Number(t.redecisionNewRR) : null,
    redecisionAt: t.redecisionAt || null,
    redecisionPillars: t.redecisionPillars || null,
    // Canonical trade drawing geometry & timestamps for seamless chart overlay
    filledAt: entryTime,
    closedAt: closeTime,
    createdAt: stagedTime || entryTime,
    filledPrice: entryPrice,
    initialSlPrice: to5Dec(t.initialSlPrice ?? t.levelDetails?.sl ?? t.stagedLevel?.sl ?? slPrice),
    initialRiskDistance: initialRiskDist,
    levelDetails: t.levelDetails || null,
    stagedLevel: t.stagedLevel || null,
    isBreakeven: Boolean(t.isBreakeven),
    isTrailing: Boolean(t.isTrailing),
    isHalfRisk: Boolean(t.isHalfRisk),
    slHalfMoved: Boolean(t.slHalfMoved),
    confirmedSlPrice: t.confirmedSlPrice ? to5Dec(t.confirmedSlPrice) : null,
    breakevenPrice: t.breakevenPrice ? to5Dec(t.breakevenPrice) : null,
  };
}

/**
 * Synchronizes MT5 history deals directly into the Autonomous Journal.
 * Ingests closed broker positions with exact fill price, exit price, realized PnL, and broker timestamps.
 */
export async function syncMT5HistoryToJournal({ days = 14 } = {}) {
  try {
    const histRes = await getMT5History({ days });
    if (!histRes?.ok || !Array.isArray(histRes.history)) {
      return { ok: false, synced: 0, reason: histRes?.error || "No MT5 history available" };
    }

    const { autonomousCol } = await journalCols();
    const deals = histRes.history;

    // Filter valid trade deals (exclude deposits, balance transfers, OTHER)
    const tradeDeals = deals.filter(
      (d) => d.symbol && ["BUY", "SELL"].includes(d.type) && Number(d.volume) > 0
    );

    if (tradeDeals.length === 0) return { ok: true, synced: 0 };

    // Group deals by position_id (or order ticket fallback)
    const posMap = new Map();
    for (const d of tradeDeals) {
      const posId = Number(d.position_id || d.order || d.ticket);
      if (!posId) continue;
      if (!posMap.has(posId)) posMap.set(posId, []);
      posMap.get(posId).push(d);
    }

    let syncedCount = 0;

    for (const [posId, pDeals] of posMap.entries()) {
      // Sort chronologically
      pDeals.sort((a, b) => Number(a.time_msc || a.time * 1000) - Number(b.time_msc || b.time * 1000));
      const entryDeal = pDeals.find((d) => Number(d.entry) === 0) || pDeals[0];
      const exitDeals = pDeals.filter((d) => [1, 3].includes(Number(d.entry)));
      const latestExit = exitDeals[exitDeals.length - 1];

      const symbol = entryDeal.symbol;
      const canonical = canonOf(symbol);
      const isBuy = entryDeal.type === "BUY";
      const dir = isBuy ? 1 : -1;
      const dirLabel = isBuy ? "BUY" : "SELL";
      const volume = Number(entryDeal.volume);
      const entryPrice = Number(entryDeal.price);

      // Total PnL across all exits
      const netProfit = Number(
        pDeals.reduce((sum, d) => sum + Number(d.profit || 0) + Number(d.swap || 0) + Number(d.commission || 0) + Number(d.fee || 0), 0).toFixed(2)
      );

      const isClosed = Boolean(latestExit);
      const exitPrice = latestExit ? Number(latestExit.price) : null;
      const entryTimeBroker = Number(entryDeal.time);
      const exitTimeBroker = latestExit ? Number(latestExit.time) : null;

      // Approximate UTC timestamps (-3h offset from EET broker clock)
      const entryTimeUtc = new Date(entryTimeBroker * 1000 - 3 * 3600 * 1000);
      const exitTimeUtc = exitTimeBroker ? new Date(exitTimeBroker * 1000 - 3 * 3600 * 1000) : null;

      // Determine Outcome
      let outcome = "OPEN";
      let status = "active";
      if (isClosed) {
        if (netProfit > 2) {
          outcome = "WIN";
          status = "closed_tp";
        } else if (netProfit < -2) {
          outcome = "LOSS";
          status = "closed_sl";
        } else {
          outcome = "BREAKEVEN";
          status = "closed_be";
        }
      }

      // Check if this position exists in autonomous_trades
      const existing = await autonomousCol.findOne({
        $or: [
          { ticket: posId },
          { orderTicket: posId },
          { positionId: posId },
          { "events.note": { $regex: String(posId) } },
        ],
      });

      if (existing) {
        const riskUsd = Number(existing.initialRiskUsd || existing.riskUsd || Math.abs(netProfit) || 100);
        let realizedR = existing.realizedR;
        if (isClosed) {
          if (outcome === "BREAKEVEN" || Math.abs(netProfit) < 2) {
            realizedR = 0.0;
          } else if (riskUsd > 0) {
            realizedR = Number((netProfit / riskUsd).toFixed(2));
          } else if (outcome === "LOSS") {
            realizedR = -1.0;
          } else {
            realizedR = Number(existing.targetRR || 2.0);
          }
        }

        let resolvedStatus = existing.status;
        if (!resolvedStatus || ["active", "managing", "closing"].includes(resolvedStatus)) {
          resolvedStatus = status;
        }

        const updateFields = {
          ticket: posId,
          orderTicket: existing.orderTicket || posId,
          positionId: posId,
          isLive: true,
          brokerVolume: volume,
          brokerEntryTime: entryTimeBroker,
          ...(exitTimeBroker ? { brokerCloseTime: exitTimeBroker } : {}),
          ...(exitPrice != null ? { exitPrice } : {}),
          realizedPnl: isClosed ? netProfit : existing.realizedPnl,
          realizedR: isClosed ? realizedR : existing.realizedR,
          status: isClosed ? resolvedStatus : existing.status,
          closedAt: isClosed ? (exitTimeUtc || existing.closedAt || new Date()) : null,
          updatedAt: new Date(),
        };

        await autonomousCol.updateOne({ _id: existing._id }, { $set: updateFields });
        syncedCount++;
      } else {
        // Position not in autonomous_trades: Insert as new synchronized trade document!
        const riskUsd = Math.abs(netProfit) > 0 ? Math.abs(netProfit) : 100;
        let realizedR = 0;
        if (isClosed) {
          if (outcome === "BREAKEVEN" || Math.abs(netProfit) < 2) {
            realizedR = 0.0;
          } else if (riskUsd > 0) {
            realizedR = Number((netProfit / riskUsd).toFixed(2));
          } else if (outcome === "LOSS") {
            realizedR = -1.0;
          } else {
            realizedR = 2.0;
          }
        }

        const estSlDist = exitPrice && entryPrice ? Math.abs(entryPrice - exitPrice) : entryPrice * 0.002;
        const initialSlPrice = isBuy ? entryPrice - estSlDist : entryPrice + estSlDist;
        const tpPrice = isBuy ? entryPrice + estSlDist * 2 : entryPrice - estSlDist * 2;

        const newDoc = {
          symbol,
          canonicalSymbol: canonical,
          dir,
          dirLabel,
          status,
          executionMode: "live",
          isLive: true,
          ticket: posId,
          orderTicket: posId,
          positionId: posId,
          entryPrice,
          filledPrice: entryPrice,
          exitPrice: exitPrice ?? entryPrice,
          initialSlPrice,
          slPrice: exitPrice ?? initialSlPrice,
          tpPrice,
          initialRiskDistance: estSlDist,
          initialRiskUsd: riskUsd,
          riskUsd,
          lotSize: volume,
          brokerVolume: volume,
          realizedPnl: isClosed ? netProfit : 0,
          realizedR: isClosed ? realizedR : 0,
          targetRR: 2.0,
          targetLandmark: "Macro DOL Target",
          brokerEntryTime: entryTimeBroker,
          brokerCloseTime: exitTimeBroker,
          createdAt: entryTimeUtc,
          filledAt: entryTimeUtc,
          closedAt: isClosed ? exitTimeUtc : null,
          magicNumber: entryDeal.magic || 231223,
          brokerComment: entryDeal.comment || "TradeSpace MT5 Trade",
          entryModel: { id: "silver_bullet", label: "ICT Silver Bullet Window" },
          managementLogic: Number(posId) === 66443809 || String(entryDeal.comment || "").toLowerCase().includes("prop") ? "prop_firm_safe" : "milestone_50",
          isPropFirm: Number(posId) === 66443809 || String(entryDeal.comment || "").toLowerCase().includes("prop"),
          legId: Number(posId) === 66443809 || String(entryDeal.comment || "").toLowerCase().includes("prop") ? "prop_firm" : "default",
          legLabel: Number(posId) === 66443809 || String(entryDeal.comment || "").toLowerCase().includes("prop") ? "Prop-Firm Safe (1.5R–2.5R)" : "Default (50% Milestone + Runner)",
          account: "Live Broker (MT5)",
          events: [
            {
              time: entryTimeUtc.toISOString(),
              type: "LIVE_FILLED",
              note: `MT5 Deal #${entryDeal.ticket} filled @ ${entryPrice} · ${volume} lots`,
            },
            ...(latestExit
              ? [
                  {
                    time: exitTimeUtc ? exitTimeUtc.toISOString() : new Date().toISOString(),
                    type: outcome === "WIN" ? "TP_HIT" : "SL_HIT",
                    note: `MT5 Deal #${latestExit.ticket} closed @ ${exitPrice} (${netProfit < 0 ? "-" : "+"}$${Math.abs(netProfit)})`,
                  },
                ]
              : []),
          ],
        };

        await autonomousCol.insertOne(newDoc);
        syncedCount++;
      }
    }

    return { ok: true, synced: syncedCount };
  } catch (err) {
    console.error("[syncMT5HistoryToJournal error]", err);
    return { ok: false, error: err.message };
  }
}

let lastSyncAt = 0;
let syncPromise = null;

export async function syncMT5HistoryToJournalThrottled({ days = 14, minIntervalMs = 60_000 } = {}) {
  const now = Date.now();
  if (now - lastSyncAt < minIntervalMs) {
    return { ok: true, cached: true };
  }
  if (syncPromise) return syncPromise;
  syncPromise = syncMT5HistoryToJournal({ days })
    .then((res) => {
      lastSyncAt = Date.now();
      return res;
    })
    .finally(() => {
      syncPromise = null;
    });
  return syncPromise;
}

export const EXECUTED_TRADE_STATUSES = [
  "active",
  "managing",
  "closing",
  "closed",
  "closed_tp",
  "closed_sl",
  "closed_be",
];

/**
 * Fetches all journal rows from autonomous_trades (with optional search / filter criteria).
 * Strictly filters to executed trades (active filled positions and closed trade history).
 * Staged, armed, and pending limit ideas are prospective setups that have no place in the journal.
 * Automatically triggers MT5 broker history reconciliation so all deals are up-to-date.
 */
export async function getJournalTrades(query = {}) {
  await syncMT5HistoryToJournalThrottled().catch(() => {});
  const { autonomousCol } = await journalCols();

  const executionFilter = {
    $and: [
      query,
      {
        $or: [
          { status: { $in: EXECUTED_TRADE_STATUSES } },
          { filledAt: { $exists: true, $ne: null } },
        ],
      },
      {
        status: { $nin: ["staged", "armed", "pending", "placing", "dismissed"] },
      },
    ],
  };

  const rawTrades = await autonomousCol.find(executionFilter).sort({ filledAt: -1, closedAt: -1, createdAt: -1, _id: -1 }).toArray();
  return rawTrades
    .map(normalizeJournalRow)
    .filter((t) => ["WIN", "LOSS", "BREAKEVEN", "OPEN"].includes(t.outcome));
}

/**
 * Calculates executive summary statistics for the Journal Dashboard.
 */
export function calculateJournalKpis(trades = []) {
  const closed = trades.filter((t) => ["WIN", "LOSS", "BREAKEVEN"].includes(t.outcome));
  const wins = closed.filter((t) => t.outcome === "WIN");
  const losses = closed.filter((t) => t.outcome === "LOSS");
  const be = closed.filter((t) => t.outcome === "BREAKEVEN");
  const openTrades = trades.filter((t) => t.outcome === "OPEN");

  const totalClosed = closed.length;
  // Institutional Win Rate: Wins / (Wins + Losses) * 100 — excluding Breakevens!
  const decisiveTrades = wins.length + losses.length;
  const winRate = decisiveTrades > 0 ? Number(((wins.length / decisiveTrades) * 100).toFixed(1)) : 0;
  const totalRealizedR = Number(closed.reduce((s, t) => s + (t.realizedR || 0), 0).toFixed(2));
  const totalRealizedPnl = Number(closed.reduce((s, t) => s + (t.realizedPnlUsd || 0), 0).toFixed(2));

  const grossProfitR = closed.filter((t) => t.realizedR > 0).reduce((s, t) => s + t.realizedR, 0);
  const grossLossR = Math.abs(closed.filter((t) => t.realizedR < 0).reduce((s, t) => s + t.realizedR, 0));
  const profitFactor = grossLossR > 0 ? Number((grossProfitR / grossLossR).toFixed(2)) : (grossProfitR > 0 ? 99.9 : 0);

  const avgR = totalClosed > 0 ? Number((totalRealizedR / totalClosed).toFixed(2)) : 0;
  const maxEquityR = Number(trades.reduce((m, t) => Math.max(m, t.peakR || 0), 0).toFixed(2));
  const maxDrawdownR = Number(trades.reduce((m, t) => Math.min(m, t.maxDrawdownR || 0), 0).toFixed(2));

  // Model-specific breakdown (excluding BE from each model's win rate)
  const defaultTrades = closed.filter((t) => (t.managementLogic === "milestone_50" || !t.managementLogic) && !t.isPropFirm);
  const propTrades = closed.filter((t) => t.managementLogic === "prop_firm_safe" || Boolean(t.isPropFirm));

  const defaultWins = defaultTrades.filter((t) => t.outcome === "WIN").length;
  const defaultLosses = defaultTrades.filter((t) => t.outcome === "LOSS").length;
  const defaultDecisive = defaultWins + defaultLosses;
  const defaultWinRate = defaultDecisive > 0 ? Number(((defaultWins / defaultDecisive) * 100).toFixed(1)) : 0;

  const propWins = propTrades.filter((t) => t.outcome === "WIN").length;
  const propLosses = propTrades.filter((t) => t.outcome === "LOSS").length;
  const propDecisive = propWins + propLosses;
  const propWinRate = propDecisive > 0 ? Number(((propWins / propDecisive) * 100).toFixed(1)) : 0;

  // Spread friction metrics
  const totalFrictionDragR = Number(trades.reduce((s, t) => s + (t.frictionDragR || 0), 0).toFixed(2));
  const avgSpreadDragR = trades.length > 0 ? Number((totalFrictionDragR / trades.length).toFixed(2)) : 0;
  const avgRecoveryPct = trades.length > 0 ? Number((trades.reduce((s, t) => s + (t.recoveryPct || 0), 0) / trades.length).toFixed(1)) : 0;

  return {
    totalTrades: trades.length,
    closedCount: totalClosed,
    openCount: openTrades.length,
    winsCount: wins.length,
    lossesCount: losses.length,
    beCount: be.length,
    winRate,
    totalRealizedR,
    totalRealizedPnl,
    avgR,
    profitFactor,
    maxEquityR,
    maxDrawdownR,
    totalFrictionDragR,
    avgSpreadDragR,
    avgRecoveryPct,
    models: {
      default: {
        total: defaultTrades.length,
        winRate: defaultWinRate,
        wins: defaultWins,
        losses: defaultLosses,
        netR: Number(defaultTrades.reduce((s, t) => s + (t.realizedR || 0), 0).toFixed(2)),
        netPnl: Number(defaultTrades.reduce((s, t) => s + (t.realizedPnlUsd || 0), 0).toFixed(2)),
      },
      propFirm: {
        total: propTrades.length,
        winRate: propWinRate,
        wins: propWins,
        losses: propLosses,
        netR: Number(propTrades.reduce((s, t) => s + (t.realizedR || 0), 0).toFixed(2)),
        netPnl: Number(propTrades.reduce((s, t) => s + (t.realizedPnlUsd || 0), 0).toFixed(2)),
      },
    },
  };
}

/**
 * Updates trader review notes, tags, screenshot image, or rating on a trade document.
 */
export async function updateJournalTrade(tradeId, { notes, tags, imageUrl, rating }) {
  const { autonomousCol } = await journalCols();
  const filter = ObjectId.isValid(tradeId) ? { _id: new ObjectId(tradeId) } : { id: tradeId };
  
  const updateDoc = {
    $set: {
      updatedAt: new Date(),
      ...(notes !== undefined ? { journalNotes: String(notes) } : {}),
      ...(tags !== undefined ? { journalTags: Array.isArray(tags) ? tags : [tags] } : {}),
      ...(imageUrl !== undefined ? { imageUrl: String(imageUrl), screenshotUrl: String(imageUrl) } : {}),
      ...(rating !== undefined ? { journalRating: Number(rating) } : {}),
    },
  };

  const res = await autonomousCol.updateOne(filter, updateDoc);
  return { ok: res.matchedCount > 0, modifiedCount: res.modifiedCount };
}
