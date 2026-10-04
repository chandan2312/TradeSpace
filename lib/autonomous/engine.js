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
import { isTradingPermittedNow } from "./timeslots.js";

const g = globalThis;
const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

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

    // Check open trade slots
    const openTrades = await tradesCol.find({ status: { $in: OPEN_STATES } }).toArray();
    const openSymbols = new Set(openTrades.map((t) => t.symbol));
    const activeCount = openTrades.filter((t) => ACTIVE_STATES.includes(t.status)).length;
    const availableSlots = Math.max(0, cfg.maxConcurrentTrades - activeCount);

    const newlyStaged = [];

    if (availableSlots > 0 && scanResult.primeSetups.length > 0) {
      for (const setup of scanResult.primeSetups) {
        // STRICT ENFORCEMENT: Entry is permitted ONLY for symbols in user's Main Watchlist
        if (!isSymbolInMainWatchlist(setup.symbol, mainWatchlistSymbols)) {
          console.warn(`[autonomous entry guard] ${setup.symbol} blocked: Not in Main Watchlist.`);
          continue;
        }

        // INSTITUTIONAL SESSION GATING: Check symbol-specific allowed session hours
        const sessionCheck = isTradingPermittedNow(new Date(), cfg, setup.symbol);
        if (!sessionCheck.permitted) {
          console.warn(`[autonomous entry guard] ${setup.symbol} blocked: ${sessionCheck.reason}`);
          continue;
        }

        const tradeSymbol = setup.tradeableSymbol || setup.symbol;
        if (openSymbols.has(tradeSymbol)) continue;
        if (newlyStaged.length >= availableSlots) break;

        const level = setup.stagedLevel;
        if (!level || !level.entry || !level.sl || !level.tp) continue;

        const risk = Math.abs(level.entry - level.sl);
        const reward = Math.abs(level.tp - level.entry);
        const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;

        // Position sizing based on account size & risk %
        const riskUsd = (cfg.accountSize * (cfg.riskPerTradePct / 100));
        const lotSize = Math.max(0.01, Math.round((riskUsd / (level.riskPips * 10 || 100)) * 100) / 100);

        const tradeDoc = {
          symbol: tradeSymbol,
          canonicalSymbol: setup.symbol,
          dir: setup.dir,
          dirLabel: setup.dirLabel,
          status: cfg.executionMode === "auto" ? "armed" : "staged",
          executionMode: cfg.executionMode,
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

        await logEvent(
          "SETUP_STAGED",
          `Staged ${tradeSymbol} ${setup.dirLabel} via [${setup.entryModel?.name || "Model"}] @ ${level.entry} (${setup.scenario.label}, ${rr}R)`,
          { symbol: tradeSymbol, rr, level: level.label, model: setup.entryModel?.id }
        );

        if (cfg.telegram) {
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

  const openTrades = await tradesCol.find({ status: { $in: OPEN_STATES } }).toArray();
  if (!openTrades.length) return;

  for (const trade of openTrades) {
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
          // Fill Paper Position
          updates.status = "active";
          updates.filledPrice = trade.entryPrice;
          updates.filledAt = new Date();
          updates.events = [
            ...trade.events,
            { time: new Date(), type: "FILLED", note: `Position filled @ ${trade.entryPrice} (Simulated Paper Execution).` },
          ];
          await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
          await logEvent("TRADE_FILLED", `Position filled: ${trade.symbol} ${trade.dirLabel} @ ${trade.entryPrice}`, {
            symbol: trade.symbol,
            entry: trade.entryPrice,
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

      // Check Take Profit hit
      const isTpHit = trade.dir === 1 ? currentPrice >= trade.tpPrice : currentPrice <= trade.tpPrice;
      if (isTpHit) {
        updates.status = "closed_tp";
        updates.closedAt = new Date();
        updates.exitPrice = trade.tpPrice;
        updates.realizedR = trade.targetRR;
        updates.realizedPnl = Math.round(trade.targetRR * trade.riskUsd);
        updates.events = [
          ...trade.events,
          { time: new Date(), type: "TP_HIT", note: `Target DOL reached @ ${trade.tpPrice} (+${trade.targetRR}R).` },
        ];
        await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
        await logEvent("TRADE_WON", `Target Hit (+${trade.targetRR}R): ${trade.symbol} ${trade.dirLabel}`, {
          symbol: trade.symbol,
          r: trade.targetRR,
        });
        dirty = true;
        continue;
      }

      // Check Stop Loss hit
      const isSlHit = trade.dir === 1 ? currentPrice <= trade.slPrice : currentPrice >= trade.slPrice;
      if (isSlHit) {
        const exitLossR = trade.isBreakeven ? 0 : -1;
        updates.status = "closed_sl";
        updates.closedAt = new Date();
        updates.exitPrice = trade.slPrice;
        updates.realizedR = exitLossR;
        updates.realizedPnl = Math.round(exitLossR * trade.riskUsd);
        updates.events = [
          ...trade.events,
          { time: new Date(), type: "SL_HIT", note: `Stop loss executed @ ${trade.slPrice} (${exitLossR}R).` },
        ];
        await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
        await logEvent("TRADE_LOST", `Stop Loss Hit (${exitLossR}R): ${trade.symbol} ${trade.dirLabel}`, {
          symbol: trade.symbol,
          r: exitLossR,
        });
        dirty = true;
        continue;
      }

      // Dynamic Management: Breakeven Protection
      if (currentR >= cfg.breakevenTriggerR && !trade.isBreakeven) {
        updates.status = "managing";
        updates.isBreakeven = true;
        updates.slPrice = trade.entryPrice; // Lock stop loss at breakeven
        updates.events = [
          ...trade.events,
          { time: new Date(), type: "BREAKEVEN", note: `Reached +${currentR}R. Stop Loss moved to Entry (${trade.entryPrice}).` },
        ];
        await tradesCol.updateOne({ _id: trade._id }, { $set: updates });
        await logEvent("BREAKEVEN_TRIGGERED", `Breakeven armed for ${trade.symbol} (+${currentR}R).`, { symbol: trade.symbol });
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
          updates.events = [
            ...trade.events,
            { time: new Date(), type: "TRAILING_STEP", note: `Trailing stop stepped to ${trailPrice.toFixed(5)} (+${trailR.toFixed(1)}R).` },
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
        events: { time: new Date(), type: "MANUAL_CLOSE", note: `${reason} @ ${exitPrice} (${realizedR}R)` },
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
