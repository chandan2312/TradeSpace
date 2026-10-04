// The Autonomous Trading Engine — Orchestrates pair selection, level staging,
// state-machine transitions, and tick-by-tick paper/live execution.

import { ObjectId } from "mongodb";
import { broadcast } from "../realtime.js";
import { sendTelegram } from "../telegram.js";
import {
  autonomousCols,
  getConfig,
  logEvent,
  OPEN_STATES,
  ACTIVE_STATES,
} from "./store.js";
import { scanUniverse } from "./scanner.js";
import {
  getMainWatchlistSymbols,
  isSymbolInMainWatchlist,
} from "./watchlist.js";
import { isTradingPermittedNow, getStartOfTradingDay } from "./timeslots.js";
import {
  executeMT5Order,
  modifyMT5Order,
  closeMT5Position,
  getMT5Symbol,
  getMT5Account,
  calculateInstitutionalPositionSize,
  reconcileTradeWithBroker,
} from "./mt5.js";

const g = globalThis;
const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

/**
 * Deterministic fingerprint for a setup to prevent duplicate trades & alert spam.
 * Structured as: SYMBOL:DIR:TIMEFRAME:MODEL:ENTRY:SL:TP
 * Including timeframe ensures setups from different timeframes (e.g. 15M vs 1H vs 4H)
 * are distinguished and evaluated independently.
 */
export function getSetupFingerprint(symbol, dir, level, modelId = null, tf = null) {
  if (!symbol || !level) return null;
  const quantize = (p) => (Number(p) ? (Math.round(p * 1000) / 1000).toFixed(3) : "0");
  const pEntry = quantize(level.entry);
  const pSl = quantize(level.sl);
  const pTp = quantize(level.tp);
  const m = modelId || level.modelId || level.type || "DEFAULT";
  const timeframe = (tf || level.tf || level.timeframe || "15M").toUpperCase();
  return `${symbol.toUpperCase()}:${dir}:${timeframe}:${m}:${pEntry}:${pSl}:${pTp}`;
}

/**
 * Retrieves trade idea fingerprints that have already finished (hit TP or SL) today.
 * The trading day resets at midnight EET (00:00 Europe/Athens, aligning with 5 PM NY close).
 * Once a trade reaches terminal outcome (closed_tp or closed_sl), the trade idea is exhausted
 * and cannot be re-entered on the same trading day.
 *
 * @param {Object} tradesCol - MongoDB collection for autonomous trades
 * @param {Date|number} todayStart - Start of the current ICT trading day
 * @returns {Promise<Set<string>>} Set of exhausted fingerprints for today
 */
export async function getExhaustedTodayFingerprints(tradesCol, todayStart) {
  const startDate = todayStart instanceof Date ? todayStart : new Date(todayStart);
  const completedToday = await tradesCol.find({
    status: { $in: ["closed_tp", "closed_sl"] },
    fingerprint: { $exists: true, $ne: null },
    $or: [
      { closedAt: { $gte: startDate } },
      { updatedAt: { $gte: startDate } },
    ],
  }).toArray();

  return new Set(completedToday.map((t) => t.fingerprint).filter(Boolean));
}

// ----------------------------------------------------------------------------
// 1. Scanner & Staging Cadence
// ----------------------------------------------------------------------------

export async function runAutonomousScan(reason = "interval") {
  if (g._tsAutonomousScanning) return { ok: false, error: "scan already in progress" };
  g._tsAutonomousScanning = true;
  try {
    const cfg = await getConfig();
    if (!cfg.enabled && reason !== "manual") {
      return { ok: false, error: "Autonomous Engine is paused." };
    }

    const { tradesCol } = await autonomousCols();
    const mainWatchlistSymbols = await getMainWatchlistSymbols();
    const scanResult = await scanUniverse(cfg, mainWatchlistSymbols);

    // Save latest leaderboard to global memory for fast UI polling
    g._tsAutonomousLeaderboard = {
      scannedAt: new Date(),
      rankedPairs: scanResult.rankedPairs,
      mainWatchlistSymbols: scanResult.mainWatchlistSymbols || mainWatchlistSymbols,
      activeTimeSlot: scanResult.activeTimeSlot,
      timeSlotPermitted: scanResult.timeSlotPermitted,
      timeSlotReason: scanResult.timeSlotReason,
      summary: {
        total: scanResult.totalScanned,
        mainWatchlistCount: scanResult.mainWatchlistCount,
        contextOnlyCount: scanResult.contextOnlyCount,
        prime: scanResult.primeCount,
        watching: scanResult.watchingCount,
        blocked: scanResult.blockedCount,
      },
    };

    // Check open trade slots and query recent trade history for deduplication and cooldown
    const cooldownMins = cfg.cooldownMinutes ?? 45;
    const cooldownCutoff = new Date(Date.now() - cooldownMins * 60 * 1000);

    const recentTrades = await tradesCol.find({
      $or: [
        { status: { $in: OPEN_STATES } },
        { createdAt: { $gte: cooldownCutoff } },
        { closedAt: { $gte: cooldownCutoff } },
        { updatedAt: { $gte: cooldownCutoff } },
      ],
    }).toArray();

    const openTrades = recentTrades.filter((t) => OPEN_STATES.includes(t.status));
    const openSymbols = new Set(openTrades.flatMap((t) => [t.symbol, t.canonicalSymbol].filter(Boolean)));
    const activeCount = openTrades.filter((t) => ACTIVE_STATES.includes(t.status)).length;
    const availableSlots = Math.max(0, cfg.maxConcurrentTrades - activeCount);

    const dedupWindowMs = (cfg.dedupFingerprintWindowMinutes ?? 60) * 60 * 1000;
    const recentFingerprints = new Set(
      recentTrades
        .filter((t) => {
          const tTime = new Date(t.closedAt || t.updatedAt || t.createdAt).getTime();
          return Date.now() - tTime < dedupWindowMs;
        })
        .map((t) => t.fingerprint)
        .filter(Boolean)
    );

    // Day-Scoped Trade Idea Exhaustion Guard:
    // If a trade idea was already executed and closed (TP or SL) today, the idea is considered exhausted
    // for the entire broker trading day (resetting at 00:00 EET / 5 PM NY close).
    const isDayExhaustionEnabled = (cfg.exhaustedIdeaScope ?? "day") !== "none";
    const todayTradingStart = getStartOfTradingDay(new Date());
    const exhaustedTodayFingerprints = isDayExhaustionEnabled
      ? await getExhaustedTodayFingerprints(tradesCol, todayTradingStart)
      : new Set();

    const newlyStaged = [];

    if (availableSlots > 0 && scanResult.primeSetups.length > 0) {
      for (const setup of scanResult.primeSetups) {
        const tradeSymbol = setup.tradeableSymbol || setup.symbol;

        // STRICT ENFORCEMENT: Entry is permitted ONLY for symbols in user's Main Watchlist
        const isSetupInWatchlist =
          isSymbolInMainWatchlist(setup.symbol, mainWatchlistSymbols) ||
          isSymbolInMainWatchlist(tradeSymbol, mainWatchlistSymbols);

        if (!isSetupInWatchlist) {
          console.warn(`[autonomous entry guard] ${setup.symbol} (${tradeSymbol}) blocked: Not in Main Watchlist.`);
          continue;
        }

        // INSTITUTIONAL SESSION GATING: Check symbol-specific allowed session hours
        const sessionCheck = isTradingPermittedNow(new Date(), cfg, setup.symbol);
        if (!sessionCheck.permitted) {
          console.warn(`[autonomous entry guard] ${setup.symbol} blocked: ${sessionCheck.reason}`);
          continue;
        }

        // 1. Symbol open slot check (never double-enter same symbol simultaneously)
        if (openSymbols.has(tradeSymbol) || openSymbols.has(setup.symbol)) continue;
        if (newlyStaged.length >= availableSlots) break;

        const level = setup.stagedLevel;
        if (!level || !level.entry || !level.sl || !level.tp) continue;

        const tf = level.tf || setup.scenario?.sessionTf || "15M";
        const fingerprint = getSetupFingerprint(setup.symbol, setup.dir, level, setup.entryModel?.id, tf);

        // 2. Day-Scoped Trade Idea Exhaustion Guard:
        // If this exact trade idea was already completed today (hit TP or SL), do NOT re-enter today
        if (fingerprint && exhaustedTodayFingerprints.has(fingerprint)) {
          console.warn(`[autonomous idea exhaustion] ${setup.symbol} ${setup.dirLabel} (${setup.entryModel?.name || level.label}) blocked: Trade idea already completed today (TP/SL hit). Idea exhausted for this trading day.`);
          continue;
        }

        // 3. Setup Fingerprint Deduplication (prevent exact same setup from re-staging repeatedly within window)
        if (fingerprint && recentFingerprints.has(fingerprint)) {
          console.warn(`[autonomous dedup] ${setup.symbol} blocked: Identical setup fingerprint recently staged/traded (${fingerprint}).`);
          continue;
        }

        // 4. Post-Loss / Post-Invalidation Directional Cooldown (anti-whipsaw / revenge trading guard)
        const lossCooldownMs = (cfg.lossCooldownMinutes ?? 30) * 60 * 1000;
        const recentLossOrInvalidation = recentTrades.find(
          (t) =>
            (t.symbol === tradeSymbol || t.canonicalSymbol === setup.symbol) &&
            t.dir === setup.dir &&
            (t.status === "invalidated" || t.status === "closed_sl") &&
            Date.now() - new Date(t.closedAt || t.updatedAt || t.createdAt).getTime() < lossCooldownMs
        );
        if (recentLossOrInvalidation) {
          const remainingMin = Math.round((lossCooldownMs - (Date.now() - new Date(recentLossOrInvalidation.closedAt || recentLossOrInvalidation.updatedAt || recentLossOrInvalidation.createdAt).getTime())) / 60000);
          console.warn(`[autonomous dedup] ${setup.symbol} blocked: Directional cooldown after recent ${recentLossOrInvalidation.status} (${remainingMin}m remaining).`);
          continue;
        }

        const risk = Math.abs(level.entry - level.sl);
        const reward = Math.abs(level.tp - level.entry);
        const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;

        // Institutional position sizing based on asset contract size, account size & risk %
        const riskUsd = (cfg.accountSize * (cfg.riskPerTradePct / 100));
        const lotSize = calculateInstitutionalPositionSize({
          symbol: tradeSymbol,
          riskUsd,
          entryPrice: level.entry,
          slPrice: level.sl,
        });

        const tradeDoc = {
          symbol: tradeSymbol,
          canonicalSymbol: setup.symbol,
          fingerprint,
          dir: setup.dir,
          dirLabel: setup.dirLabel,
          status: cfg.executionMode === "auto" ? "armed" : "staged",
          executionMode: cfg.executionMode,
          isLive: false,
          ticket: null,
          brokerVolume: null,
          scenario: setup.scenario,
          entryPrice: level.entry,
          slPrice: level.sl,
          tpPrice: level.tp,
          stagedPrice: setup.currentPrice,
          currentPrice: setup.currentPrice,
          riskUsd,
          lotSize,
          targetRR: rr,
          unrealizedR: 0,
          unrealizedPnl: 0,
          levelDetails: {
            type: level.type,
            tf: level.tf,
            quality: level.quality,
            confluenceScore: level.confluenceScore,
            confluenceTags: level.confluenceTags,
            label: level.label,
            modelId: level.modelId,
            modelName: level.modelName,
            rationale: level.rationale,
          },
          entryModel: setup.entryModel || {
            id: level.modelId || level.type,
            name: level.modelName || level.label,
            badge: level.modelBadge || level.type,
            rationale: level.rationale || "",
            confluenceTags: level.confluenceTags || [],
            confluenceScore: level.confluenceScore || 50,
          },
          activeTimeSlot: setup.activeTimeSlot || null,
          brainSnapshot: {
            verdict: setup.brain.verdict,
            action: setup.brain.action,
            conviction: setup.brain.conviction,
            targetDOL: setup.brain.targetDOL,
            macroCompass: setup.brain.macroCompass,
          },
          opportunityScore: setup.opportunityScore,
          createdAt: new Date(),
          updatedAt: new Date(),
          events: [
            {
              time: new Date(),
              type: cfg.executionMode === "auto" ? "AUTO_ARMED" : "STAGED",
              note: `Opportunity qualified by ${setup.entryModel?.name || "Brain"} (${setup.brain.verdict}, ${setup.brain.conviction}% conviction). Staged at ${level.label}.`,
            },
          ],
        };

        const inserted = await tradesCol.insertOne(tradeDoc);
        tradeDoc._id = inserted.insertedId;
        newlyStaged.push(tradeDoc);
        openSymbols.add(tradeSymbol);
        openSymbols.add(setup.symbol);
        if (fingerprint) recentFingerprints.add(fingerprint);

        await logEvent(
          "SETUP_STAGED",
          `Staged ${tradeSymbol} ${setup.dirLabel} via [${setup.entryModel?.name || "Model"}] @ ${level.entry} (${setup.scenario.label}, ${rr}R)`,
          { symbol: tradeSymbol, rr, level: level.label, model: setup.entryModel?.id }
        );

        if (cfg.telegram) {
          // Double-check: NEVER trigger Telegram alert if symbol is not in user's Main Watchlist
          const inWatchlist =
            isSymbolInMainWatchlist(tradeSymbol, mainWatchlistSymbols) ||
            isSymbolInMainWatchlist(setup.symbol, mainWatchlistSymbols);
          if (!inWatchlist) {
            console.warn(`[telegram guard] Suppressed setup alert for non-watchlist symbol: ${tradeSymbol}`);
          } else {
            // Repetitive Alert Throttle: Prevent duplicate Telegram alerts for identical setups
            const alertKey = `${setup.symbol}:${setup.dir}:${setup.entryModel?.id || level.label}`;
            if (!g._tsAlertThrottle) g._tsAlertThrottle = new Map();
            const lastAlertTime = g._tsAlertThrottle.get(alertKey) || 0;
            const throttleMs = (cfg.alertThrottleMinutes ?? 30) * 60 * 1000;

            if (Date.now() - lastAlertTime < throttleMs) {
              const remainingMin = Math.round((throttleMs - (Date.now() - lastAlertTime)) / 60000);
              console.log(`[telegram throttle] Suppressed duplicate alert for ${alertKey} (${remainingMin}m cooldown remaining).`);
            } else {
              g._tsAlertThrottle.set(alertKey, Date.now());
              sendTelegram(
                `🤖 <b>Autonomous Trader: Setup Staged</b>\n` +
                `• <b>Symbol</b>: ${tradeSymbol} (${setup.dirLabel})\n` +
                `• <b>Model</b>: ${setup.entryModel?.name || level.label}\n` +
                `• <b>Time Slot</b>: ${setup.activeTimeSlot?.name || "Active Session"}${setup.activeTimeSlot?.eetRange ? ` (${setup.activeTimeSlot.eetRange})` : ""}\n` +
                `• <b>Scenario</b>: ${setup.scenario.label}\n` +
                `• <b>Entry</b>: ${level.entry.toFixed(5)} | <b>SL</b>: ${level.sl.toFixed(5)} | <b>TP</b>: ${level.tp.toFixed(5)}\n` +
                `• <b>R:R</b>: ${rr}R | <b>Conviction</b>: ${setup.brain.conviction}%\n` +
                `• <b>Mode</b>: ${cfg.executionMode.toUpperCase()}`
              ).catch(() => {});
            }
          }
        }
      }
    }

    broadcast({ type: "autonomous_changed" });
    return { ok: true, scannedCount: scanResult.totalScanned, stagedCount: newlyStaged.length };
  } catch (err) {
    console.error("[autonomous scan error]", err);
    return { ok: false, error: err.message };
  } finally {
    g._tsAutonomousScanning = false;
  }
}

// ----------------------------------------------------------------------------
// 2. Real-Time Tick Consumer (Connected to alert-engine tick stream)
// ----------------------------------------------------------------------------

export async function autonomousOnTicks(ticks) {
  if (!ticks || !Object.keys(ticks).length) return;
  const { tradesCol } = await autonomousCols();
  const cfg = await getConfig();
  const mainWatchlistSymbols = await getMainWatchlistSymbols().catch(() => []);

  const openTrades = await tradesCol.find({ status: { $in: OPEN_STATES } }).toArray();
  if (!openTrades.length) return;

  for (const trade of openTrades) {
    // ENFORCEMENT: Never process or fill trades for symbols not in the Main Watchlist
    const inWatchlist =
      isSymbolInMainWatchlist(trade.symbol, mainWatchlistSymbols) ||
      isSymbolInMainWatchlist(trade.canonicalSymbol, mainWatchlistSymbols);

    if (!inWatchlist) {
      console.warn(`[autonomous tick guard] Auto-cancelling non-watchlist trade: ${trade.symbol}`);
      await tradesCol.updateOne(
        { _id: trade._id },
        {
          $set: {
            status: "cancelled",
            closedAt: new Date(),
            closeReason: "Symbol not in Main Watchlist - Auto-purged by Watchlist Guard.",
            updatedAt: new Date(),
          },
          $push: {
            events: {
              time: new Date(),
              type: "CANCELLED",
              note: "Cancelled automatically: Symbol not in Main Watchlist.",
            },
          },
        }
      );
      continue;
    }

    const tick = ticks[trade.symbol];
    if (!tick) continue;

    const currentPrice = trade.dir === 1 ? tick.ask || tick.bid : tick.bid || tick.ask;
    if (!currentPrice) continue;

    const riskDist = Math.abs(trade.entryPrice - trade.slPrice);
    let dirty = false;
    const updates = { currentPrice, updatedAt: new Date() };

    // ------------------------------------------------------------------------
    // Staged & Armed Transitions
    // ------------------------------------------------------------------------
    if (trade.status === "staged" || trade.status === "armed") {
      // Check invalidation before fill: if price violates SL level first
      const isInvalidated = trade.dir === 1
        ? currentPrice <= trade.slPrice
        : currentPrice >= trade.slPrice;

      if (isInvalidated) {
        updates.status = "invalidated";
        updates.closedAt = new Date();
        updates.closeReason = "Price breached invalidation level before entry tap.";
        updates.events = [...trade.events, { time: new Date(), type: "INVALIDATED", note: updates.closeReason }];
        await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
        await logEvent("TRADE_INVALIDATED", `Invalidated ${trade.symbol} before fill.`, { symbol: trade.symbol });
        dirty = true;
        continue;
      }

      // Check Entry Tap (price reaching entry zone)
      let isTapped = false;
      if (trade.dir === 1) { // BUY
        if (trade.stagedPrice && trade.stagedPrice > trade.entryPrice) {
          // Normal retracement from above: price pulls down to entry zone
          isTapped = currentPrice <= trade.entryPrice && currentPrice > trade.slPrice;
        } else {
          // Reclamation: price was already at or below entry; wait for bounce back up above entry
          isTapped = currentPrice >= trade.entryPrice && currentPrice > trade.slPrice;
        }
      } else { // SELL
        if (trade.stagedPrice && trade.stagedPrice < trade.entryPrice) {
          // Normal retracement from below: price rallies up to entry zone
          isTapped = currentPrice >= trade.entryPrice && currentPrice < trade.slPrice;
        } else {
          // Reclamation: price was already at or above entry; wait for rejection back down below entry
          isTapped = currentPrice <= trade.entryPrice && currentPrice < trade.slPrice;
        }
      }

      if (isTapped) {
        if (trade.executionMode === "auto" || trade.executionMode === "paper" || trade.status === "armed") {
          let isLive = false;
          let ticket = null;
          let executedPrice = trade.entryPrice;
          let executedLots = trade.lotSize;
          let fillNote = `Position filled @ ${trade.entryPrice} (Simulated Paper Execution).`;

          // DIRECT LIVE MT5 EXECUTION
          const shouldGoLive = cfg.liveTrading && (trade.executionMode === "auto" || trade.status === "armed");
          if (shouldGoLive) {
            try {
              const symInfoRes = await getMT5Symbol(trade.symbol);
              const accInfoRes = await getMT5Account();
              const action = trade.dir === 1 ? "buy" : "sell";
              const calculatedLots = calculateInstitutionalPositionSize({
                symbol: trade.symbol,
                riskUsd: trade.riskUsd,
                entryPrice: trade.entryPrice,
                slPrice: trade.slPrice,
                symInfo: symInfoRes?.symbol,
                accInfo: accInfoRes?.account,
              });

              const orderRes = await executeMT5Order({
                symbol: trade.symbol,
                action,
                volume: calculatedLots,
                sl: trade.slPrice,
                tp: trade.tpPrice,
                entryPrice: trade.entryPrice,
                comment: `TS:${trade.entryModel?.badge || "Brain"}`.slice(0, 31),
                magic: 231223,
              });

              if (orderRes.ok && orderRes.ticket) {
                isLive = true;
                ticket = orderRes.ticket;
                executedPrice = orderRes.price || trade.entryPrice;
                executedLots = orderRes.volume || calculatedLots;
                fillNote = `LIVE MT5 ORDER FILLED (Ticket #${ticket}) @ ${executedPrice} · Lots: ${executedLots}`;
                updates.isLive = true;
                updates.ticket = ticket;
                updates.brokerVolume = executedLots;

                await logEvent("MT5_ORDER_EXECUTED", `Live MT5 order filled: ${trade.symbol} ${action.toUpperCase()} @ ${executedPrice} (Ticket #${ticket})`, {
                  symbol: trade.symbol,
                  ticket,
                  volume: executedLots,
                });

                if (cfg.telegram) {
                  sendTelegram(
                    `🚀 <b>LIVE MT5 ORDER FILLED</b>\n` +
                    `• <b>Symbol</b>: ${trade.symbol} (${trade.dirLabel})\n` +
                    `• <b>Ticket</b>: <code>#${ticket}</code>\n` +
                    `• <b>Filled Price</b>: ${executedPrice}\n` +
                    `• <b>Volume</b>: ${executedLots} lots\n` +
                    `• <b>SL</b>: ${trade.slPrice} | <b>TP</b>: ${trade.tpPrice}\n` +
                    `• <b>Model</b>: ${trade.entryModel?.name || "Brain"}`
                  ).catch(() => {});
                }
              } else {
                fillNote = `MT5 execution failed: ${orderRes.error || "Unknown error"}. Retained as paper simulation.`;
                await logEvent("MT5_ORDER_FAILED", `MT5 execution failed for ${trade.symbol}: ${orderRes.error}`, {
                  symbol: trade.symbol,
                });
                if (cfg.telegram) {
                  sendTelegram(
                    `⚠️ <b>MT5 ORDER EXECUTION FAILED</b>\n` +
                    `• <b>Symbol</b>: ${trade.symbol}\n` +
                    `• <b>Error</b>: ${orderRes.error}\n` +
                    `• Tracking trade on paper.`
                  ).catch(() => {});
                }
              }
            } catch (err) {
              fillNote = `MT5 bridge error: ${err.message}. Retained as paper simulation.`;
            }
          }

          updates.status = "active";
          updates.filledPrice = executedPrice;
          updates.filledAt = new Date();
          updates.lotSize = executedLots;
          updates.isLive = isLive;
          if (ticket) updates.ticket = ticket;
          updates.events = [
            ...trade.events,
            { time: new Date(), type: isLive ? "LIVE_FILLED" : "FILLED", note: fillNote },
          ];
          await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
          await logEvent(isLive ? "LIVE_TRADE_FILLED" : "TRADE_FILLED", `Position filled: ${trade.symbol} ${trade.dirLabel} @ ${executedPrice}`, {
            symbol: trade.symbol,
            entry: executedPrice,
            isLive,
            ticket,
          });
          dirty = true;
          continue;
        }
      }
    }

    // ------------------------------------------------------------------------
    // Active & Managing Position Management
    // ------------------------------------------------------------------------
    if (trade.status === "active" || trade.status === "managing") {
      const priceDelta = trade.dir === 1 ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;
      const currentR = riskDist > 0 ? Math.round((priceDelta / riskDist) * 100) / 100 : 0;
      const currentPnl = Math.round(currentR * trade.riskUsd);

      updates.unrealizedR = currentR;
      updates.unrealizedPnl = currentPnl;

      // Check broker reconciliation for live positions (detects broker-side SL/TP triggers)
      if (trade.isLive && trade.ticket) {
        try {
          const reconcile = await reconcileTradeWithBroker(trade);
          if (reconcile.closed) {
            const brokerExitPrice = reconcile.exitPrice || trade.currentPrice || trade.entryPrice;
            const bPriceDelta = trade.dir === 1 ? brokerExitPrice - trade.entryPrice : trade.entryPrice - brokerExitPrice;
            const realizedR = riskDist > 0 ? Math.round((bPriceDelta / riskDist) * 100) / 100 : 0;
            const realizedPnl = reconcile.realizedPnl !== undefined && reconcile.realizedPnl !== 0
              ? Math.round(reconcile.realizedPnl)
              : Math.round(realizedR * trade.riskUsd);

            updates.status = realizedR >= 0 ? "closed_tp" : "closed_sl";
            updates.closedAt = new Date();
            updates.exitPrice = brokerExitPrice;
            updates.realizedR = realizedR;
            updates.realizedPnl = realizedPnl;
            updates.closeReason = reconcile.reason || "Closed on broker terminal";
            updates.events = [
              ...trade.events,
              { time: new Date(), type: "BROKER_CLOSED", note: `Broker closed position #${trade.ticket} @ ${brokerExitPrice} (${realizedR}R).` },
            ];
            await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
            await logEvent("BROKER_CLOSED", `Position #${trade.ticket} (${trade.symbol}) closed on MT5 @ ${brokerExitPrice}`, {
              symbol: trade.symbol,
              r: realizedR,
              pnl: realizedPnl,
            });
            dirty = true;
            continue;
          }
        } catch {}
      }

      // Check Take Profit hit
      const isTpHit = trade.dir === 1 ? currentPrice >= trade.tpPrice : currentPrice <= trade.tpPrice;
      if (isTpHit) {
        if (trade.isLive && trade.ticket) {
          try {
            await closeMT5Position({ ticket: trade.ticket });
          } catch (err) {
            console.warn(`[mt5 close on TP failed for ticket ${trade.ticket}]`, err.message);
          }
        }
        updates.status = "closed_tp";
        updates.closedAt = new Date();
        updates.exitPrice = trade.tpPrice;
        updates.realizedR = trade.targetRR;
        updates.realizedPnl = Math.round(trade.targetRR * trade.riskUsd);
        updates.events = [
          ...trade.events,
          { time: new Date(), type: "TP_HIT", note: `Target DOL reached @ ${trade.tpPrice} (+${trade.targetRR}R).${trade.isLive ? ` Closed on MT5 (#${trade.ticket}).` : ""}` },
        ];
        await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
        await logEvent("TRADE_WON", `Target Hit (+${trade.targetRR}R): ${trade.symbol} ${trade.dirLabel}`, {
          symbol: trade.symbol,
          r: trade.targetRR,
        });
        if (cfg.telegram) {
          sendTelegram(
            `🏆 <b>TARGET HIT (+${trade.targetRR}R)</b>\n` +
            `• <b>Symbol</b>: ${trade.symbol} (${trade.dirLabel})\n` +
            `• <b>Target</b>: ${trade.tpPrice}\n` +
            `• <b>Realized</b>: +${trade.targetRR}R (+$${updates.realizedPnl})\n` +
            `• <b>Ticket</b>: ${trade.ticket ? `#${trade.ticket}` : "Paper"}`
          ).catch(() => {});
        }
        dirty = true;
        continue;
      }

      // Check Stop Loss hit
      const isSlHit = trade.dir === 1 ? currentPrice <= trade.slPrice : currentPrice >= trade.slPrice;
      if (isSlHit) {
        if (trade.isLive && trade.ticket) {
          try {
            await closeMT5Position({ ticket: trade.ticket });
          } catch (err) {
            console.warn(`[mt5 close on SL failed for ticket ${trade.ticket}]`, err.message);
          }
        }
        const exitLossR = trade.isBreakeven ? 0 : -1;
        updates.status = "closed_sl";
        updates.closedAt = new Date();
        updates.exitPrice = trade.slPrice;
        updates.realizedR = exitLossR;
        updates.realizedPnl = Math.round(exitLossR * trade.riskUsd);
        updates.events = [
          ...trade.events,
          { time: new Date(), type: "SL_HIT", note: `Stop loss executed @ ${trade.slPrice} (${exitLossR}R).${trade.isLive ? ` Closed on MT5 (#${trade.ticket}).` : ""}` },
        ];
        await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
        await logEvent("TRADE_LOST", `Stop Loss Hit (${exitLossR}R): ${trade.symbol} ${trade.dirLabel}`, {
          symbol: trade.symbol,
          r: exitLossR,
        });
        if (cfg.telegram) {
          sendTelegram(
            `🛑 <b>STOP LOSS HIT (${exitLossR}R)</b>\n` +
            `• <b>Symbol</b>: ${trade.symbol} (${trade.dirLabel})\n` +
            `• <b>Exit Price</b>: ${trade.slPrice}\n` +
            `• <b>Realized</b>: ${exitLossR}R ($${updates.realizedPnl})\n` +
            `• <b>Ticket</b>: ${trade.ticket ? `#${trade.ticket}` : "Paper"}`
          ).catch(() => {});
        }
        dirty = true;
        continue;
      }

      // Dynamic Management: Breakeven Protection
      if (currentR >= cfg.breakevenTriggerR && !trade.isBreakeven) {
        updates.status = "managing";
        updates.isBreakeven = true;
        updates.slPrice = trade.entryPrice; // Lock stop loss at breakeven
        let beNote = `Reached +${currentR}R. Stop Loss moved to Entry (${trade.entryPrice}).`;

        if (trade.isLive && trade.ticket) {
          try {
            const modRes = await modifyMT5Order({ ticket: trade.ticket, sl: trade.entryPrice, tp: trade.tpPrice });
            if (modRes.ok) {
              beNote += ` (MT5 SL modified to Breakeven on Ticket #${trade.ticket})`;
              await logEvent("MT5_BREAKEVEN_MODIFIED", `MT5 SL modified to breakeven for ${trade.symbol} #${trade.ticket}`, { symbol: trade.symbol });
            } else {
              beNote += ` (MT5 modify note: ${modRes.error})`;
            }
          } catch (err) {
            beNote += ` (MT5 modify error: ${err.message})`;
          }
        }

        updates.events = [
          ...trade.events,
          { time: new Date(), type: "BREAKEVEN", note: beNote },
        ];
        await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
        await logEvent("BREAKEVEN_TRIGGERED", `Breakeven armed for ${trade.symbol} (+${currentR}R).`, { symbol: trade.symbol });
        if (cfg.telegram) {
          sendTelegram(
            `🛡️ <b>BREAKEVEN PROTECTION ARMED</b>\n` +
            `• <b>Symbol</b>: ${trade.symbol}\n` +
            `• <b>Current R</b>: +${currentR}R\n` +
            `• <b>New SL</b>: ${trade.entryPrice} (Risk Free)\n` +
            `• <b>Ticket</b>: ${trade.ticket ? `#${trade.ticket}` : "Paper"}`
          ).catch(() => {});
        }
        dirty = true;
      }

      // Dynamic Management: Trailing Stop
      if (currentR >= cfg.trailStopTriggerR) {
        const trailR = currentR - cfg.trailStepR;
        const trailPrice = trade.dir === 1
          ? trade.entryPrice + trailR * riskDist
          : trade.entryPrice - trailR * riskDist;

        const isTighterTrail = trade.dir === 1 ? trailPrice > trade.slPrice : trailPrice < trade.slPrice;
        if (isTighterTrail) {
          updates.status = "managing";
          updates.slPrice = trailPrice;
          updates.isTrailing = true;
          let trailNote = `Trailing stop stepped to ${trailPrice.toFixed(5)} (+${trailR.toFixed(1)}R).`;

          if (trade.isLive && trade.ticket) {
            try {
              const modRes = await modifyMT5Order({ ticket: trade.ticket, sl: trailPrice, tp: trade.tpPrice });
              if (modRes.ok) {
                trailNote += ` (MT5 SL trailed on Ticket #${trade.ticket})`;
              }
            } catch {}
          }

          updates.events = [
            ...trade.events,
            { time: new Date(), type: "TRAILING_STEP", note: trailNote },
          ];
          await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
          dirty = true;
        }
      }

      // Regular mark-to-market update
      if (!dirty) {
        await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
      }
    }
  }

  if (dirty) {
    broadcast({ type: "autonomous_changed" });
  }
}

// ----------------------------------------------------------------------------
// 3. Interactive Trader Controls
// ----------------------------------------------------------------------------

export async function approveStagedTrade(tradeId) {
  const { tradesCol } = await autonomousCols();
  const trade = await tradesCol.findOne({ _id: oid(tradeId) });
  if (!trade || trade.status !== "staged") {
    return { ok: false, error: "Trade not found or not in staged state." };
  }

  // Verification: Ensure symbol is STRICTLY in Main Watchlist before arming
  const mainWatchlistSymbols = await getMainWatchlistSymbols();
  if (
    !isSymbolInMainWatchlist(trade.symbol, mainWatchlistSymbols) &&
    !isSymbolInMainWatchlist(trade.canonicalSymbol || trade.symbol, mainWatchlistSymbols)
  ) {
    return {
      ok: false,
      error: `Execution Blocked: ${trade.symbol} is not in your Main Watchlist. Trade entries are strictly limited to Main Watchlist symbols.`,
    };
  }

  // Verification: Check symbol-specific allowed session hours
  const cfg = await getConfig();
  const sessionCheck = isTradingPermittedNow(new Date(), cfg, trade.canonicalSymbol || trade.symbol);
  if (!sessionCheck.permitted) {
    return {
      ok: false,
      error: sessionCheck.reason,
    };
  }

  // Verification: Day-Scoped Trade Idea Exhaustion Guard (prevent manual arming of exhausted ideas)
  const isDayExhaustionEnabled = (cfg.exhaustedIdeaScope ?? "day") !== "none";
  if (isDayExhaustionEnabled && trade.fingerprint) {
    const todayTradingStart = getStartOfTradingDay(new Date());
    const exhaustedTodayFingerprints = await getExhaustedTodayFingerprints(tradesCol, todayTradingStart);
    if (exhaustedTodayFingerprints.has(trade.fingerprint)) {
      return {
        ok: false,
        error: `Execution Blocked: This trade idea has already completed today (TP or SL reached). Idea is exhausted for the remainder of this trading day.`,
      };
    }
  }

  await tradesCol.updateOne(
    { _id: trade._id },
    {
      $set: {
        status: "armed",
        updatedAt: new Date(),
      },
      $push: {
        events: { time: new Date(), type: "MANUALLY_ARMED", note: "Trader approved staged setup." },
      },
    }
  );
  await logEvent("TRADE_ARMED", `Trader approved staged setup for ${trade.symbol}`, { symbol: trade.symbol });
  broadcast({ type: "autonomous_changed" });
  return { ok: true };
}

export async function dismissStagedTrade(tradeId) {
  const { tradesCol } = await autonomousCols();
  const trade = await tradesCol.findOne({ _id: oid(tradeId) });
  if (!trade || !["staged", "armed"].includes(trade.status)) {
    return { ok: false, error: "Trade not found or already executed." };
  }

  await tradesCol.updateOne(
    { _id: trade._id },
    {
      $set: {
        status: "cancelled",
        closedAt: new Date(),
        updatedAt: new Date(),
      },
      $push: {
        events: { time: new Date(), type: "CANCELLED", note: "Trader dismissed setup." },
      },
    }
  );
  broadcast({ type: "autonomous_changed" });
  return { ok: true };
}

export async function closeActiveTrade(tradeId, reason = "Trader manual close") {
  const { tradesCol } = await autonomousCols();
  const trade = await tradesCol.findOne({ _id: oid(tradeId) });
  if (!trade || !ACTIVE_STATES.includes(trade.status)) {
    return { ok: false, error: "Trade not found or not currently active." };
  }

  // Live MT5 Broker position close
  if (trade.isLive && trade.ticket) {
    try {
      const closeRes = await closeMT5Position({ ticket: trade.ticket });
      if (!closeRes.ok) {
        console.warn(`[mt5 manual close warning on ticket ${trade.ticket}]:`, closeRes.error);
      }
    } catch (err) {
      console.warn(`[mt5 manual close error on ticket ${trade.ticket}]:`, err.message);
    }
  }

  const exitPrice = trade.currentPrice || trade.entryPrice;
  const priceDelta = trade.dir === 1 ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
  const riskDist = Math.abs(trade.entryPrice - trade.slPrice);
  const realizedR = riskDist > 0 ? Math.round((priceDelta / riskDist) * 100) / 100 : 0;
  const realizedPnl = Math.round(realizedR * trade.riskUsd);

  await tradesCol.updateOne(
    { _id: trade._id },
    {
      $set: {
        status: realizedR >= 0 ? "closed_tp" : "closed_sl",
        exitPrice,
        realizedR,
        realizedPnl,
        closedAt: new Date(),
        closeReason: reason,
        updatedAt: new Date(),
      },
      $push: {
        events: {
          time: new Date(),
          type: "MANUAL_CLOSE",
          note: `${reason} @ ${exitPrice} (${realizedR}R)${trade.isLive ? ` [MT5 #${trade.ticket} Closed]` : ""}`,
        },
      },
    }
  );
  await logEvent("MANUAL_CLOSE", `Closed ${trade.symbol} @ ${exitPrice} (${realizedR}R)`, { symbol: trade.symbol, r: realizedR });
  broadcast({ type: "autonomous_changed" });
  return { ok: true, realizedR, realizedPnl };
}

// ----------------------------------------------------------------------------
// 4. Background Engine Loop Bootstrapper
// ----------------------------------------------------------------------------

export function startAutonomousLoop() {
  if (g._tsAutonomousStarted) return;
  g._tsAutonomousStarted = true;

  const tick = async () => {
    try {
      const cfg = await getConfig();
      if (cfg?.enabled) {
        await runAutonomousScan("interval");
      }
    } catch (err) {
      console.warn("[autonomous loop error]", err.message);
    }
  };

  setTimeout(tick, 18_000); // allow server to settle
  setInterval(tick, 180_000); // 3 min scanner loop
  console.log("[autonomous] background loop initialized (scanner: 3m, monitor on ticks)");
}
