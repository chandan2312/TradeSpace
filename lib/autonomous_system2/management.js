/**
 * lib/autonomous_quant/management.js
 *
 * System #2 In-Flight Trade Lifecycle & Risk Management
 * Handles partial scale-outs, breakeven moves, Chandelier ATR trailing, and stagnation exits.
 */

import { RISK_GUARDRAILS } from "./constants.js";

/**
 * Updates an active trade based on a new incoming bar.
 * @param {object} trade - Active trade object
 * @param {object} bar - Newest closed candle
 * @param {number} atr - Current ATR
 * @param {number} spreadPts - Current broker spread
 * @returns {object} Updated trade state and execution actions
 */
export function manageActiveTrade(trade, bar, atr = 10, spreadPts = 1.5) {
  if (!trade || trade.status === "CLOSED") return trade;

  const curHigh = bar.high ?? bar.h;
  const curLow = bar.low ?? bar.l;
  const curClose = bar.close ?? bar.c;
  const curTime = bar.time ?? bar.t;

  trade.barsHeld = (trade.barsHeld || 0) + 1;
  const actions = [];

  // Update extreme price reached during trade
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

  // 2. Check TP1 Hit (40% scale-out & move to Breakeven)
  if (!trade.tp1Hit) {
    const isTp1Hit = trade.direction === 1 ? curHigh >= trade.targets.tp1.price : curLow <= trade.targets.tp1.price;
    if (isTp1Hit) {
      trade.tp1Hit = true;
      trade.remainingPositionPct = 60;
      const rMult1 = trade.targets.tp1.rMultiple || 1.5;
      const profitPart1 = (trade.riskDollars * rMult1) * 0.40;
      trade.realizedPnlDollars = (trade.realizedPnlDollars || 0) + profitPart1;
      actions.push({ type: "SCALE_OUT", pct: 40, price: trade.targets.tp1.price, label: "TP1_SCALED", pnl: profitPart1 });

      // Move Stop Loss to Breakeven (+ spread buffer)
      const bePrice = trade.direction === 1 ? trade.entryPrice + spreadPts : trade.entryPrice - spreadPts;
      trade.currentStopLoss = bePrice;
      trade.isBreakevenActive = true;
      actions.push({ type: "MOVE_STOP", price: bePrice, label: "STOP_MOVED_TO_BREAKEVEN" });
    }
  }

  // 3. Check TP2 Hit (35% scale-out)
  if (trade.tp1Hit && !trade.tp2Hit) {
    const isTp2Hit = trade.direction === 1 ? curHigh >= trade.targets.tp2.price : curLow <= trade.targets.tp2.price;
    if (isTp2Hit) {
      trade.tp2Hit = true;
      trade.remainingPositionPct = 25;
      const rMult2 = trade.targets.tp2.rMultiple || 2.8;
      const profitPart2 = (trade.riskDollars * rMult2) * 0.35;
      trade.realizedPnlDollars = (trade.realizedPnlDollars || 0) + profitPart2;
      actions.push({ type: "SCALE_OUT", pct: 35, price: trade.targets.tp2.price, label: "TP2_SCALED", pnl: profitPart2 });

      // Lock in profit at TP1
      trade.currentStopLoss = trade.targets.tp1.price;
      actions.push({ type: "MOVE_STOP", price: trade.currentStopLoss, label: "STOP_LOCKED_AT_TP1" });
    }
  }

  // 4. Check TP3 Hit (Final Runner exit)
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

    // Dynamic Chandelier Trailing for Runner (2.0x ATR)
    const chandelierTrail = trade.direction === 1 ? curHigh - 2.0 * atr : curHigh + 2.0 * atr;
    if (trade.direction === 1 && chandelierTrail > trade.currentStopLoss) {
      trade.currentStopLoss = Math.round(chandelierTrail * 100) / 100;
      actions.push({ type: "MOVE_STOP", price: trade.currentStopLoss, label: "CHANDELIER_RUNNER_TRAIL" });
    } else if (trade.direction === -1 && chandelierTrail < trade.currentStopLoss) {
      trade.currentStopLoss = Math.round(chandelierTrail * 100) / 100;
      actions.push({ type: "MOVE_STOP", price: trade.currentStopLoss, label: "CHANDELIER_RUNNER_TRAIL" });
    }
  }

  // 5. Max Time Expiration / Stagnation Shield (12 Hours)
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
