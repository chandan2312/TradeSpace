/**
 * lib/autonomous_system2/management.js
 *
 * Quantitative Trade Lifecycle & Alpha Half-Life Management Engine
 * Features:
 * 1. Partial scale-out staging: TP1 (40% at POC/VWAP -> Moves stop to Breakeven), TP2 (35%), TP3 (25% Runner).
 * 2. Alpha Half-Life Decay: Prunes stagnant positions after 16 bars (4 hours) if edge has decayed into noise.
 * 3. Chandelier ATR dynamic trailing for asymmetric runners.
 */

import { RISK_GUARDRAILS } from "./constants.js";

function roundPrice(p) {
  if (p < 5) return Math.round(p * 100000) / 100000;
  if (p < 500) return Math.round(p * 1000) / 1000;
  return Math.round(p * 100) / 100;
}

/**
 * Updates an active trade based on a new closed candle.
 * @param {object} trade - Active trade object
 * @param {object} bar - Newest closed candle
 * @param {number} atr - Current ATR
 * @param {number} spreadPts - Current broker spread
 * @returns {object} { trade, actions }
 */
export function manageActiveTrade(trade, bar, atr = 10, spreadPts = 1.5) {
  if (!trade || trade.status === "CLOSED") return { trade, actions: [] };

  const curHigh = bar.high ?? bar.h;
  const curLow = bar.low ?? bar.l;
  const curClose = bar.close ?? bar.c;
  const curTime = bar.time ?? bar.t;

  trade.barsHeld = (trade.barsHeld || 0) + 1;
  const actions = [];

  // Update extreme price reached
  if (trade.direction === 1) {
    if (curHigh > (trade.peakPrice || -Infinity)) trade.peakPrice = curHigh;
  } else {
    if (curLow < (trade.peakPrice || Infinity)) trade.peakPrice = curLow;
  }

  // 1. Check Stop Loss Hit
  const isStopHit = trade.direction === 1 ? curLow <= trade.currentStopLoss : curHigh >= trade.currentStopLoss;
  if (isStopHit) {
    trade.status = "CLOSED";
    trade.exitPrice = trade.currentStopLoss;
    trade.exitTime = curTime;
    trade.exitReason = trade.isBreakevenActive ? "BREAKEVEN_EXIT" : "STOP_LOSS";
    actions.push({ type: "CLOSE_FULL", reason: trade.exitReason, price: trade.exitPrice });
    return { trade, actions };
  }

  // 2. Check TP1 Hit (Scale out 50% & bank 0.75R guaranteed profit)
  if (!trade.tp1Hit) {
    const isTp1Hit = trade.direction === 1 ? curHigh >= trade.targets.tp1.price : curLow <= trade.targets.tp1.price;
    if (isTp1Hit) {
      trade.tp1Hit = true;
      const alloc1 = (trade.targets.tp1.allocationPct ?? 50) / 100;
      trade.remainingPositionPct = 100 - (alloc1 * 100);
      const rMult1 = trade.targets.tp1.rMultiple || 1.5;
      const profitPart1 = (trade.riskDollars * rMult1) * alloc1;
      trade.realizedPnlDollars = (trade.realizedPnlDollars || 0) + profitPart1;
      actions.push({ type: "SCALE_OUT", pct: alloc1 * 100, price: trade.targets.tp1.price, label: "TP1_SCALED", pnl: profitPart1 });

      // Move Stop Loss to Protected Half-Risk Buffer (guarantees net +0.625R while giving 0.25R pullback cushion)
      const bufferPrice = trade.direction === 1
        ? trade.entryPrice - (trade.stopDistancePoints * 0.25)
        : trade.entryPrice + (trade.stopDistancePoints * 0.25);
      trade.currentStopLoss = roundPrice(bufferPrice);
      trade.isBreakevenActive = true;
      actions.push({ type: "MOVE_STOP", price: trade.currentStopLoss, label: "STOP_MOVED_TO_PROTECTED_BUFFER" });
    }
  }

  // 2B. Check 2.0R Milestone (Move Stop to true Breakeven + spread)
  if (trade.tp1Hit && !trade.isHardBeActive) {
    const distFromEntry = trade.direction === 1 ? curHigh - trade.entryPrice : trade.entryPrice - curLow;
    if (distFromEntry >= trade.stopDistancePoints * 2.0) {
      trade.isHardBeActive = true;
      const bePrice = trade.direction === 1 ? trade.entryPrice + spreadPts : trade.entryPrice - spreadPts;
      trade.currentStopLoss = roundPrice(bePrice);
      actions.push({ type: "MOVE_STOP", price: trade.currentStopLoss, label: "STOP_MOVED_TO_FULL_BREAKEVEN" });
    }
  }

  // 3. Check TP2 Hit (Scale out 35%)
  if (trade.tp1Hit && !trade.tp2Hit) {
    const isTp2Hit = trade.direction === 1 ? curHigh >= trade.targets.tp2.price : curLow <= trade.targets.tp2.price;
    if (isTp2Hit) {
      trade.tp2Hit = true;
      const alloc2 = (trade.targets.tp2.allocationPct ?? 35) / 100;
      trade.remainingPositionPct = Math.max(0, trade.remainingPositionPct - (alloc2 * 100));
      const rMult2 = trade.targets.tp2.rMultiple || 3.5;
      const profitPart2 = (trade.riskDollars * rMult2) * alloc2;
      trade.realizedPnlDollars = (trade.realizedPnlDollars || 0) + profitPart2;
      actions.push({ type: "SCALE_OUT", pct: alloc2 * 100, price: trade.targets.tp2.price, label: "TP2_SCALED", pnl: profitPart2 });

      // Lock in profit at TP1 price
      trade.currentStopLoss = trade.targets.tp1.price;
      actions.push({ type: "MOVE_STOP", price: trade.currentStopLoss, label: "STOP_LOCKED_AT_TP1" });
    }
  }

  // 4. Check TP3 Hit (Final Runner 25%)
  if (trade.tp2Hit && !trade.tp3Hit) {
    const isTp3Hit = trade.direction === 1 ? curHigh >= trade.targets.tp3.price : curLow <= trade.targets.tp3.price;
    if (isTp3Hit) {
      trade.tp3Hit = true;
      trade.status = "CLOSED";
      trade.exitPrice = trade.targets.tp3.price;
      trade.exitTime = curTime;
      trade.exitReason = "TP3_RUNNER_FULL_TARGET";
      actions.push({ type: "CLOSE_FULL", reason: "TP3_RUNNER_FULL_TARGET", price: trade.exitPrice });
      return { trade, actions };
    }

    // Dynamic Chandelier ATR Trailing for Runner (2.0x ATR)
    const chandelierTrail = trade.direction === 1 ? curHigh - 2.0 * atr : curLow + 2.0 * atr;
    if (trade.direction === 1 && chandelierTrail > trade.currentStopLoss) {
      trade.currentStopLoss = roundPrice(chandelierTrail);
      actions.push({ type: "MOVE_STOP", price: trade.currentStopLoss, label: "CHANDELIER_RUNNER_TRAIL" });
    } else if (trade.direction === -1 && chandelierTrail < trade.currentStopLoss) {
      trade.currentStopLoss = roundPrice(chandelierTrail);
      actions.push({ type: "MOVE_STOP", price: trade.currentStopLoss, label: "CHANDELIER_RUNNER_TRAIL" });
    }
  }

  // 5. Alpha Half-Life Time Decay (16 bars / 4 hours)
  // If trade has been stagnant for 16 bars without reaching TP1, the structural edge has dissipated
  if (trade.barsHeld >= RISK_GUARDRAILS.ALPHA_HALF_LIFE_BARS && !trade.tp1Hit && !trade.isAlphaDecayTightened) {
    trade.isAlphaDecayTightened = true;
    const halfRiskPrice = (trade.entryPrice + trade.currentStopLoss) / 2;
    trade.currentStopLoss = roundPrice(halfRiskPrice);
    actions.push({
      type: "MOVE_STOP",
      price: trade.currentStopLoss,
      label: "ALPHA_HALF_LIFE_RISK_HALVED",
    });
  }

  // 6. Max Holding Time Expiration (12 Hours)
  if (trade.barsHeld >= RISK_GUARDRAILS.MAX_HOLD_BARS) {
    trade.status = "CLOSED";
    trade.exitPrice = curClose;
    trade.exitTime = curTime;
    trade.exitReason = "MAX_HOLD_TIME_EXPIRED";
    actions.push({ type: "CLOSE_FULL", reason: "MAX_HOLD_TIME_EXPIRED", price: trade.exitPrice });
    return { trade, actions };
  }

  return { trade, actions };
}
