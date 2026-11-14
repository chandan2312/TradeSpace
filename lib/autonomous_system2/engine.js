/**
 * lib/autonomous_quant/engine.js
 *
 * Master Orchestrator: System #2 Quantitative Regime & TPO Auction Engine
 * Class: AutonomousQuantEngine
 * Coordinates Time, TPO Profiles, Hurst/Volatility Regimes, Bias, Execution Models,
 * Pre-Entry Validation, Stop Loss & TP Cascading, and Trade Management.
 *
 * NOTE: Designed to be 100% passive on server boot. Does not start any timers or background loops.
 * Executed strictly on-demand by backtesters or manual invocation.
 */

import { ENGINE_ID, ENGINE_VERSION, RISK_GUARDRAILS } from "./constants.js";
import { classifyAuctionTime, isSessionStartBar } from "./timeEngine.js";
import { buildTpoProfile } from "./tpoEngine.js";
import { calculateAtr } from "./regimeEngine.js";
import { determineMasterBias } from "./biasEngine.js";
import { evaluateExecutionModels } from "./models.js";
import { validatePreEntry } from "./preEntryValidation.js";
import { calculateStructuralStopLoss } from "./slEngine.js";
import { calculateCascadingTargets } from "./tpCascadingEngine.js";
import { manageActiveTrade } from "./management.js";
import { redecideOpenTrade } from "./redecisionEngine.js";

export class AutonomousQuantEngine {
  constructor(config = {}) {
    this.engineId = ENGINE_ID;
    this.version = ENGINE_VERSION;
    this.config = {
      spreadPts: config.spreadPts ?? 1.5,
      accountBalance: config.accountBalance ?? 100000,
      riskPerTradePct: config.riskPerTradePct ?? RISK_GUARDRAILS.RISK_PER_TRADE_PCT,
      ...config,
    };

    // State storage
    this.bars = [];
    this.sessionBars = [];
    this.todayTpo = null;
    this.yesterdayTpo = null;
    this.currentTradingDayKey = null;

    // Trade lifecycle
    this.activeTrades = [];
    this.closedTrades = [];

    // Daily Risk Shield
    this.dailyPnlDollars = 0;
    this.dailyLossPct = 0;
    this.peakBalance = this.config.accountBalance;
    this.currentBalance = this.config.accountBalance;
    this.maxDrawdownDollars = 0;

    // Diagnostics log
    this.auditLog = [];
  }

  /**
   * Primary ingestion entry point. Called whenever a new closed candle finishes.
   * @param {object} bar - Closed candle { time, open, high, low, close }
   * @returns {object} Event results and execution actions for this step
   */
  onBar(bar) {
    if (!bar) return { success: false, error: "NO_BAR_DATA" };

    const time = bar.time ?? bar.t;
    const timeInfo = classifyAuctionTime(time);
    if (!timeInfo.isValid) return { success: false, error: "INVALID_TIMESTAMP" };

    this.bars.push(bar);
    if (this.bars.length > 500) this.bars.shift(); // Keep rolling memory bounded

    const stepActions = [];

    // 1. Session Boundary Handling (Europe/Athens midnight rollover)
    if (this.currentTradingDayKey === null || timeInfo.tradingDayKey !== this.currentTradingDayKey) {
      if (this.sessionBars.length > 0) {
        // Finalize yesterday's TPO profile
        const prevAtr = calculateAtr(this.sessionBars, 14);
        this.yesterdayTpo = buildTpoProfile(this.sessionBars, prevAtr);
      }
      this.currentTradingDayKey = timeInfo.tradingDayKey;
      this.sessionBars = [];
      this.dailyPnlDollars = 0;
      this.dailyLossPct = 0;
      stepActions.push({ type: "SESSION_ROLLOVER", tradingDayKey: timeInfo.tradingDayKey });
    }

    this.sessionBars.push(bar);

    // 2. Calculate Indicators & Developing TPO Profile
    const currentAtr = calculateAtr(this.bars, 14);
    this.todayTpo = buildTpoProfile(this.sessionBars, currentAtr);

    // 3. In-Flight Trade Redecision & Management for Active Trades
    const remainingTrades = [];
    for (const trade of this.activeTrades) {
      // Step 3A: Check Structural Redecision (Adverse Volatility or Regime Break)
      const biasState = determineMasterBias(this.bars, this.todayTpo, this.yesterdayTpo, this.sessionBars);
      const redecision = redecideOpenTrade(trade, biasState, this.todayTpo, bar);

      if (redecision.shouldExitEarly) {
        trade.status = "CLOSED";
        trade.exitPrice = bar.close ?? bar.c;
        trade.exitTime = time;
        trade.exitReason = redecision.reason;
        this._finalizeTrade(trade);
        stepActions.push({ type: "EARLY_EXIT", tradeId: trade.id, reason: redecision.reason });
        continue;
      } else if (redecision.shouldTightenStop) {
        trade.currentStopLoss = redecision.newStopPrice;
        stepActions.push({ type: "STOP_TIGHTENED", tradeId: trade.id, newStop: redecision.newStopPrice });
      }

      // Step 3B: Normal Trade Lifecycle Management (TPs, Trailing, Breakeven)
      const { trade: updatedTrade, actions } = manageActiveTrade(trade, bar, currentAtr, this.config.spreadPts);
      actions.forEach((a) => stepActions.push({ ...a, tradeId: trade.id }));

      if (updatedTrade.status === "CLOSED") {
        this._finalizeTrade(updatedTrade);
      } else {
        remainingTrades.push(updatedTrade);
      }
    }
    this.activeTrades = remainingTrades;

    // 4. Evaluate New Trade Entries (Only if permitted and below max positions)
    const biasState = determineMasterBias(this.bars, this.todayTpo, this.yesterdayTpo, this.sessionBars);

    if (
      this.activeTrades.length < RISK_GUARDRAILS.MAX_CONCURRENT_TRADES &&
      this.dailyLossPct < RISK_GUARDRAILS.MAX_DAILY_LOSS_PCT
    ) {
      const candidateSignal = evaluateExecutionModels(
        this.bars,
        this.todayTpo,
        biasState,
        currentAtr,
        this.yesterdayTpo
      );

      if (candidateSignal) {
        // Step 4A: Pre-Entry Validation & Friction Check
        const validation = validatePreEntry(candidateSignal, {
          spreadPts: this.config.spreadPts,
          minSlPoints: this.config.minSlPoints ?? RISK_GUARDRAILS.MIN_STOP_LOSS_POINTS,
          maxSlPoints: this.config.maxSlPoints ?? RISK_GUARDRAILS.MAX_STOP_LOSS_POINTS,
          currentDailyLossPct: this.dailyLossPct,
          activeTradeCount: this.activeTrades.length,
          biasState,
          tpoProfile: this.todayTpo,
          yesterdayTpo: this.yesterdayTpo,
          bars: this.bars,
        });

        if (validation.isValid) {
          // Step 4B: Calculate Structural Stop Loss
          const slInfo = calculateStructuralStopLoss(
            candidateSignal,
            this.bars,
            currentAtr,
            this.config.spreadPts
          );

          // Secondary Boundary Verification on Refined Structural Stop
          const minSl = this.config.minSlPoints ?? RISK_GUARDRAILS.MIN_STOP_LOSS_POINTS;
          const maxSl = this.config.maxSlPoints ?? RISK_GUARDRAILS.MAX_STOP_LOSS_POINTS;

          if (slInfo.stopDistancePoints < minSl || slInfo.stopDistancePoints > maxSl) {
            this.auditLog.push({
              time,
              type: "SIGNAL_REJECTED",
              reason: `STRUCTURAL_SL_OUT_OF_BOUNDS: Refined distance ${slInfo.stopDistancePoints.toFixed(1)} pts outside [${minSl}, ${maxSl}] bracket.`,
            });
          } else {
            // Step 4C: Calculate Cascading Targets
            const targets = calculateCascadingTargets(
              candidateSignal,
              slInfo.stopDistancePoints,
              this.todayTpo
            );

            // Step 4D: Institutional Position Sizing (Fixed Risk % of Balance)
            const riskDollars = this.currentBalance * (this.config.riskPerTradePct / 100);
            const rawEntry = bar.close ?? bar.c;
            // Apply realistic broker spread to entry fill
            const filledEntryPrice = candidateSignal.direction === 1
              ? rawEntry + this.config.spreadPts
              : rawEntry - this.config.spreadPts;

            const trade = {
              id: `QUANT_${time}_${candidateSignal.direction === 1 ? "LONG" : "SHORT"}`,
              modelId: candidateSignal.modelId,
              caseId: candidateSignal.caseId,
              direction: candidateSignal.direction,
              entryTime: time,
              entryPrice: filledEntryPrice,
              initialStopLoss: slInfo.stopLossPrice,
              currentStopLoss: slInfo.stopLossPrice,
              stopDistancePoints: slInfo.stopDistancePoints,
              riskDollars,
              targets,
              status: "OPEN",
              barsHeld: 0,
              remainingPositionPct: 100,
              isBreakevenActive: false,
              tp1Hit: false,
              tp2Hit: false,
              tp3Hit: false,
              confluenceScore: validation.score,
              reason: candidateSignal.reason,
            };

            this.activeTrades.push(trade);
            stepActions.push({
              type: "OPEN_POSITION",
              tradeId: trade.id,
              modelId: trade.modelId,
              direction: trade.direction,
              entryPrice: trade.entryPrice,
              stopLoss: trade.currentStopLoss,
              tp1: targets.tp1.price,
              tp2: targets.tp2.price,
              score: validation.score,
            });
          }
        } else {
          this.auditLog.push({ time, type: "SIGNAL_REJECTED", reason: validation.reason });
        }
      }
    }

    return {
      success: true,
      time,
      stepActions,
      activeTradesCount: this.activeTrades.length,
      currentBalance: Math.round(this.currentBalance * 100) / 100,
      biasState: biasState.masterBias,
      tpoDayType: this.todayTpo ? this.todayTpo.dayType : "PENDING",
    };
  }

  /**
   * Internal helper to calculate PnL and update account metrics on trade closure.
   */
  _finalizeTrade(trade) {
    const isLong = trade.direction === 1;
    // Apply exit spread friction
    const exitPrice = isLong
      ? trade.exitPrice - this.config.spreadPts
      : trade.exitPrice + this.config.spreadPts;

    const priceDiff = isLong ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
    const finalRMultiple = priceDiff / trade.stopDistancePoints;

    // Calculate PnL for remaining position percentage
    const remainingFraction = (trade.remainingPositionPct ?? 100) / 100;
    const remainingPnl = (trade.riskDollars * finalRMultiple) * remainingFraction;

    // Combine partial scale-out realized profits with remaining portion PnL
    const totalPnl = (trade.realizedPnlDollars || 0) + remainingPnl;
    const netRMultiple = totalPnl / trade.riskDollars;

    trade.finalPnlDollars = Math.round(totalPnl * 100) / 100;
    trade.rMultiple = Math.round(netRMultiple * 100) / 100;

    this.currentBalance += totalPnl;
    this.dailyPnlDollars += totalPnl;

    if (this.currentBalance > this.peakBalance) {
      this.peakBalance = this.currentBalance;
    }
    const currentDrawdown = this.peakBalance - this.currentBalance;
    if (currentDrawdown > this.maxDrawdownDollars) {
      this.maxDrawdownDollars = currentDrawdown;
    }

    // Daily loss % tracking
    const dailyLossDollars = Math.max(0, -this.dailyPnlDollars);
    this.dailyLossPct = (dailyLossDollars / this.config.accountBalance) * 100;

    this.closedTrades.push(trade);
  }

  /**
   * Generates a comprehensive performance analytics report.
   */
  getPerformanceReport() {
    const totalTrades = this.closedTrades.length;
    const wins = this.closedTrades.filter((t) => t.finalPnlDollars > 0);
    const losses = this.closedTrades.filter((t) => t.finalPnlDollars <= 0);

    const winCount = wins.length;
    const lossCount = losses.length;
    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;

    const grossWins = wins.reduce((acc, t) => acc + t.finalPnlDollars, 0);
    const grossLosses = Math.abs(losses.reduce((acc, t) => acc + t.finalPnlDollars, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99.9 : 0;
    const netProfit = this.currentBalance - this.config.accountBalance;
    const maxDrawdownPct = (this.maxDrawdownDollars / this.peakBalance) * 100;

    return {
      totalTrades,
      winCount,
      lossCount,
      winRate: Math.round(winRate * 10) / 10,
      profitFactor: Math.round(profitFactor * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      finalBalance: Math.round(this.currentBalance * 100) / 100,
      maxDrawdownDollars: Math.round(this.maxDrawdownDollars * 100) / 100,
      maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
      trades: this.closedTrades,
    };
  }

  reset() {
    this.bars = [];
    this.sessionBars = [];
    this.todayTpo = null;
    this.yesterdayTpo = null;
    this.currentTradingDayKey = null;
    this.activeTrades = [];
    this.closedTrades = [];
    this.dailyPnlDollars = 0;
    this.dailyLossPct = 0;
    this.currentBalance = this.config.accountBalance;
    this.peakBalance = this.config.accountBalance;
    this.maxDrawdownDollars = 0;
    this.auditLog = [];
  }
}
