/**
 * lib/autonomous_system2/engine.js
 *
 * Master Orchestrator: System #2 Institutional Quantitative Autonomous Engine
 * Class: AutonomousQuantEngine
 *
 * Architecture:
 * - Session-Anchored VWAP & Dynamic Standard Deviation Bands (vwapEngine.js)
 * - Steidlmayer CBOT TPO Profiles & Distribution Topology (tpoTopologyEngine.js)
 * - Lo-MacKinlay Variance Ratio Econometric Test (varianceRatioEngine.js)
 * - Macro Auction Scenarios & Orthogonal Quant Models (scenarios.js, models.js)
 * - Microstructural Pre-Entry Decision Engine (entryDecisionEngine.js)
 * - Structural Stop Loss & Staged Targets (slEngine.js, tpCascadingEngine.js)
 * - In-Flight Lifecycle & Alpha Half-Life Decay Management (management.js, redecisionEngine.js)
 *
 * NOTE: 100% passive on server boot. Does not start any timers or background loops.
 */

import { ENGINE_ID, ENGINE_VERSION, RISK_GUARDRAILS } from "./constants.js";
import { classifyAuctionTime } from "./timeEngine.js";
import { buildTpoTopologyProfile } from "./tpoTopologyEngine.js";
import { calculateSessionVwap } from "./vwapEngine.js";
import { calculateVarianceRatio } from "./varianceRatioEngine.js";
import { resolveAuctionScenario } from "./scenarios.js";
import { evaluateExecutionModels } from "./models.js";
import { validatePreEntry } from "./preEntryValidation.js";
import { calculateStructuralStopLoss } from "./slEngine.js";
import { calculateCascadingTargets } from "./tpCascadingEngine.js";
import { manageActiveTrade } from "./management.js";
import { redecideOpenTrade } from "./redecisionEngine.js";

function calculateAtr(bars, period = 14) {
  if (!bars || bars.length < 2) return 1e-4;
  const N = Math.min(bars.length, period + 1);
  let trSum = 0;
  for (let i = bars.length - N + 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const curH = cur.high ?? cur.h;
    const curL = cur.low ?? cur.l;
    const prevC = prev.close ?? prev.c;
    const tr = Math.max(curH - curL, Math.abs(curH - prevC), Math.abs(curL - prevC));
    trSum += tr;
  }
  return trSum / (N - 1);
}

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
    this.todayVwap = null;
    this.vrState = null;
    this.scenarioState = null;
    this.currentTradingDayKey = null;

    // Trade lifecycle
    this.activeTrades = [];
    this.closedTrades = [];
    this.sessionModelTrades = new Set();
    this.lastTradeBarIndex = -999;
    this.totalBarsProcessed = 0;

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

    this.totalBarsProcessed++;
    this.bars.push(bar);
    if (this.bars.length > 500) this.bars.shift(); // Keep rolling memory bounded

    const stepActions = [];

    // 1. Session Boundary Handling (Europe/Athens midnight rollover per Rule 1.7)
    if (this.currentTradingDayKey === null || timeInfo.tradingDayKey !== this.currentTradingDayKey) {
      if (this.sessionBars.length > 0) {
        const prevAtr = calculateAtr(this.sessionBars, 14);
        this.yesterdayTpo = buildTpoTopologyProfile(this.sessionBars, prevAtr);
        this.priorDayHigh = this.sessionBars.reduce((max, b) => Math.max(max, b.high ?? b.h), -Infinity);
        this.priorDayLow = this.sessionBars.reduce((min, b) => Math.min(min, b.low ?? b.l), Infinity);
      }
      this.currentTradingDayKey = timeInfo.tradingDayKey;
      this.dailyOpen = bar.open ?? bar.o;
      this.sessionBars = [];
      this.sessionModelTrades.clear();
      this.dailyPnlDollars = 0;
      this.dailyLossPct = 0;
      stepActions.push({ type: "SESSION_ROLLOVER", tradingDayKey: timeInfo.tradingDayKey });
    }

    this.sessionBars.push(bar);

    // 2. Microstructure Processing (TPO Topology, Anchored VWAP, Lo-MacKinlay VR)
    const currentAtr = calculateAtr(this.bars, 14);
    this.todayTpo = buildTpoTopologyProfile(this.sessionBars, currentAtr);
    this.todayVwap = calculateSessionVwap(this.sessionBars, currentAtr);
    this.vrState = calculateVarianceRatio(this.bars, 4);
    this.scenarioState = resolveAuctionScenario(this.todayTpo, this.todayVwap, this.vrState, this.yesterdayTpo);

    // 3. In-Flight Trade Redecision & Management for Active Trades
    const remainingTrades = [];
    for (const trade of this.activeTrades) {
      // Step 3A: Check Structural Redecision (Adverse Trend Day or Broken VWAP)
      const redecision = redecideOpenTrade(trade, this.scenarioState, this.todayTpo, this.todayVwap, bar);

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

      // Step 3B: Normal Trade Lifecycle Management (TPs, Trailing, Alpha Half-Life)
      const { trade: updatedTrade, actions } = manageActiveTrade(trade, bar, currentAtr, this.config.spreadPts);
      actions.forEach((a) => stepActions.push({ ...a, tradeId: trade.id }));

      if (updatedTrade.status === "CLOSED") {
        this._finalizeTrade(updatedTrade);
      } else {
        remainingTrades.push(updatedTrade);
      }
    }
    this.activeTrades = remainingTrades;

    // 4. Evaluate New Trade Entries
    const maxPositions = this.config.maxConcurrentTrades ?? RISK_GUARDRAILS.MAX_CONCURRENT_TRADES;
    const isCooldownActive = (this.totalBarsProcessed - this.lastTradeBarIndex) < 4;

    if (
      this.activeTrades.length < maxPositions &&
      this.dailyLossPct < RISK_GUARDRAILS.MAX_DAILY_LOSS_PCT &&
      !isCooldownActive
    ) {
      const candidateSignal = evaluateExecutionModels(
        this.bars,
        this.todayTpo,
        this.todayVwap,
        this.scenarioState,
        currentAtr,
        this.yesterdayTpo,
        {
          dailyOpen: this.dailyOpen,
          priorDayHigh: this.priorDayHigh,
          priorDayLow: this.priorDayLow,
        }
      );

      const modelSessionKey = candidateSignal ? `${candidateSignal.modelId}_${candidateSignal.direction}` : null;

      if (candidateSignal && !this.sessionModelTrades.has(modelSessionKey)) {
        // Step 4A: Pre-Entry Validation & Friction Check
        const validation = validatePreEntry(candidateSignal, {
          spreadPts: this.config.spreadPts,
          minSlPoints: this.config.minSlPoints ?? RISK_GUARDRAILS.MIN_STOP_LOSS_POINTS,
          maxSlPoints: this.config.maxSlPoints ?? RISK_GUARDRAILS.MAX_STOP_LOSS_POINTS,
          currentDailyLossPct: this.dailyLossPct,
          activeTradeCount: this.activeTrades.length,
          biasState: this.scenarioState,
          tpoProfile: this.todayTpo,
          vwapState: this.todayVwap,
          vrState: this.vrState,
          yesterdayTpo: this.yesterdayTpo,
          dailyOpen: this.dailyOpen,
          priorDayHigh: this.priorDayHigh,
          priorDayLow: this.priorDayLow,
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

          // Boundary Verification on Refined Structural Stop
          const minSl = this.config.minSlPoints ?? RISK_GUARDRAILS.MIN_STOP_LOSS_POINTS;
          const maxSl = this.config.maxSlPoints ?? RISK_GUARDRAILS.MAX_STOP_LOSS_POINTS;

          if (slInfo.stopDistancePoints < minSl || slInfo.stopDistancePoints > maxSl) {
            this.auditLog.push({
              time,
              type: "SIGNAL_REJECTED",
              reason: `STRUCTURAL_SL_OUT_OF_BOUNDS: Distance ${slInfo.stopDistancePoints.toFixed(1)} pts outside [${minSl}, ${maxSl}].`,
            });
          } else {
            // Step 4C: Calculate Cascading Targets
            const targets = calculateCascadingTargets(
              candidateSignal,
              slInfo.stopDistancePoints,
              this.todayTpo
            );

            // Step 4D: Fixed Fractional Risk Sizing ($750 on $100K)
            const riskDollars = this.currentBalance * (this.config.riskPerTradePct / 100);
            const rawEntry = bar.close ?? bar.c;
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

            this.sessionModelTrades.add(modelSessionKey);
            this.lastTradeBarIndex = this.totalBarsProcessed;
            this.activeTrades.push(trade);
            stepActions.push({
              type: "OPEN_POSITION",
              tradeId: trade.id,
              modelId: trade.modelId,
              direction: trade.direction,
              entryPrice: trade.entryPrice,
              stopLoss: trade.currentStopLoss,
              tp1: trade.targets.tp1.price,
              tp2: trade.targets.tp2.price,
              score: validation.score,
            });
          }
        }
      }
    }

    return {
      success: true,
      time,
      stepActions,
      activeTrades: this.activeTrades.length,
      currentBalance: this.currentBalance,
      scenario: this.scenarioState?.scenarioId ?? "STAND_ASIDE",
      topology: this.todayTpo?.topology ?? "PENDING",
      varianceRatio: this.vrState?.varianceRatio ?? 1.0,
      vwap: this.todayVwap?.vwap ?? 0,
    };
  }

  /**
   * Calculates PnL and updates account metrics on trade closure.
   */
  _finalizeTrade(trade) {
    const isLong = trade.direction === 1;
    const exitPrice = isLong
      ? trade.exitPrice - this.config.spreadPts
      : trade.exitPrice + this.config.spreadPts;

    const priceDiff = isLong ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
    const finalRMultiple = priceDiff / trade.stopDistancePoints;

    const remainingFraction = (trade.remainingPositionPct ?? 100) / 100;
    const remainingPnl = (trade.riskDollars * finalRMultiple) * remainingFraction;

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

    const dailyLossDollars = Math.max(0, -this.dailyPnlDollars);
    this.dailyLossPct = (dailyLossDollars / this.config.accountBalance) * 100;

    this.closedTrades.push(trade);
  }

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
    this.todayVwap = null;
    this.vrState = null;
    this.scenarioState = null;
    this.activeTrades = [];
    this.closedTrades = [];
    this.sessionModelTrades.clear();
    this.lastTradeBarIndex = -999;
    this.totalBarsProcessed = 0;
    this.currentBalance = this.config.accountBalance;
    this.peakBalance = this.config.accountBalance;
    this.dailyPnlDollars = 0;
    this.dailyLossPct = 0;
    this.maxDrawdownDollars = 0;
  }
}
