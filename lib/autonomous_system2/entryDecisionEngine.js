/**
 * lib/autonomous_system2/entryDecisionEngine.js
 *
 * Institutional Microstructural Pre-Entry Decision Engine
 * Strictly purged of all retail indicators.
 * Evaluates candidates through:
 * 1. Hard Capital Preservation Vetoes (Scenario, Drawdown, Stop Bounds, Spread, R:R).
 * 2. Causal Microstructural Confluence Scoring (Location, Excess Wick, Variance Ratio, Session Timing).
 */

import { RISK_GUARDRAILS, VARIANCE_REGIMES } from "./constants.js";
import { classifyAuctionTime } from "./timeEngine.js";

export const MIN_APPROVAL_SCORE = 60.0; // Institutional Grade Approval Threshold (Grade A: >= 75, Grade B: >= 60)

/**
 * Evaluates an entry candidate signal against institutional risk guardrails and microstructural confluence.
 * @param {object} signal - Candidate signal from models.js
 * @param {object} scenarioState - Sovereign Auction Scenario from scenarios.js
 * @param {object} marketState - Current market state (spread, bars, TPO, vwap, vrState, dailyLoss, activeTrades)
 * @returns {object} Decision result { isApproved, totalScore, breakdown, reason }
 */
export function evaluateAuctionDecisionEngine(signal, scenarioState, marketState = {}) {
  if (!signal) {
    return { isApproved: false, totalScore: 0, breakdown: {}, reason: "NO_SIGNAL" };
  }

  const {
    spreadPts = 1.5,
    tpoProfile = null,
    vwapState = null,
    vrState = null,
    bars = [],
    activeTradeCount = 0,
    currentDailyLossPct = 0,
    minSlPoints = RISK_GUARDRAILS.MIN_STOP_LOSS_POINTS,
    maxSlPoints = RISK_GUARDRAILS.MAX_STOP_LOSS_POINTS,
  } = marketState;

  // -------------------------------------------------------------------------
  // 1. HARD CAPITAL PRESERVATION VETOES
  // -------------------------------------------------------------------------
  // Veto A: Sovereign Scenario Mismatch
  const isScenarioAligned = scenarioState?.allowedModels?.includes(signal.modelId);
  if (!isScenarioAligned) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: { scenarioMismatch: 0 },
      reason: `SCENARIO_MISMATCH: Model ${signal.modelId} not allowed in scenario ${scenarioState?.scenarioName ?? "STAND_ASIDE"}.`,
    };
  }

  // Veto B: Daily Drawdown Limit
  if (currentDailyLossPct >= RISK_GUARDRAILS.MAX_DAILY_LOSS_PCT) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `DAILY_LOSS_GUARDRAIL_HIT: Loss is ${currentDailyLossPct.toFixed(2)}%, exceeding ${RISK_GUARDRAILS.MAX_DAILY_LOSS_PCT}% limit.`,
    };
  }

  // Veto C: Max Concurrent Positions
  if (activeTradeCount >= RISK_GUARDRAILS.MAX_CONCURRENT_TRADES) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `MAX_CONCURRENT_POSITIONS_REACHED: Already holding ${activeTradeCount} trades.`,
    };
  }

  // Veto D: Structural Stop Loss Bounds
  const stopDistance = Math.abs(signal.entryPrice - signal.stopLoss);
  if (stopDistance < minSlPoints) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `STOP_TOO_TIGHT: Stop distance (${stopDistance.toFixed(1)} pts) below minimum ${minSlPoints} pts threshold.`,
    };
  }
  if (stopDistance > maxSlPoints) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `STOP_TOO_WIDE: Stop distance (${stopDistance.toFixed(1)} pts) exceeds maximum ${maxSlPoints} pts threshold.`,
    };
  }

  // Veto E: Spread Friction Ratio
  const spreadRatio = spreadPts / stopDistance;
  if (spreadRatio > RISK_GUARDRAILS.MAX_SPREAD_RATIO) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `SPREAD_FRICTION_TOO_HIGH: Spread ratio (${(spreadRatio * 100).toFixed(1)}%) exceeds ${RISK_GUARDRAILS.MAX_SPREAD_RATIO * 100}% threshold.`,
    };
  }

  // Veto F: Minimum Risk-to-Reward Ratio
  if (signal.rrRatio < RISK_GUARDRAILS.MIN_RR_RATIO) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `INSUFFICIENT_RR_RATIO: Expected R:R of ${signal.rrRatio.toFixed(2)} below ${RISK_GUARDRAILS.MIN_RR_RATIO} requirement.`,
    };
  }

  // -------------------------------------------------------------------------
  // 2. CAUSAL MICROSTRUCTURAL CONFLUENCE SCORING (100 PTS MAX)
  // -------------------------------------------------------------------------
  const breakdown = {};
  const curBar = bars.length > 0 ? bars[bars.length - 1] : {};
  const curHigh = curBar.high ?? curBar.h ?? signal.entryPrice;
  const curLow = curBar.low ?? curBar.l ?? signal.entryPrice;
  const curOpen = curBar.open ?? curBar.o ?? signal.entryPrice;
  const curClose = curBar.close ?? curBar.c ?? signal.entryPrice;
  const candleRange = Math.max(1e-6, curHigh - curLow);
  const atr = Math.max(1e-5, stopDistance * 0.5);

  // 1. Location Quality (0 - 20 pts)
  // Evaluates distance to Session VWAP (μ) and Value Area POC
  let locationScore = 14.0;
  if (vwapState) {
    const vwapDist = Math.abs(signal.entryPrice - vwapState.vwap) / atr;
    if (signal.modelId === "MODEL_VWAP_MEAN_REVERSION") {
      // Probing outside 1.5σ - 2σ scores highest
      locationScore = Math.min(20.0, 13.0 + Math.min(7.0, vwapDist * 4.0));
    } else if (signal.modelId === "STEIDLMAYER_80_PERCENT_RULE") {
      // Re-entry from Value boundary toward POC scores highest
      locationScore = 19.0;
    } else if (signal.modelId === "MODEL_INITIATIVE_VALUE_RETEST") {
      // Retesting VWAP/POC within 0.5 ATR scores highest
      locationScore = vwapDist <= 0.6 ? 19.0 : Math.max(10.0, 19.0 - vwapDist * 6.0);
    } else {
      locationScore = 15.0;
    }
  }
  breakdown.locationQuality = Math.round(locationScore * 10) / 10;

  // 2. Macro Anchor & Daily Directional Flow (0 - 20 pts)
  let macroScore = 14.0;
  if (marketState.dailyOpen) {
    const isBullishFlow = curClose >= marketState.dailyOpen;
    if (signal.direction === 1 && isBullishFlow) {
      macroScore = 20.0;
    } else if (signal.direction === -1 && !isBullishFlow) {
      macroScore = 20.0;
    } else {
      macroScore = 9.0;
    }
  }
  breakdown.macroDailyAlignment = Math.round(macroScore * 10) / 10;

  // 3. Excess Tail & Wick Rejection Quality (0 - 15 pts)
  let wickRatio = 0;
  if (signal.direction === 1) {
    const lowerWick = Math.min(curOpen, curClose) - curLow;
    wickRatio = lowerWick / candleRange;
  } else {
    const upperWick = curHigh - Math.max(curOpen, curClose);
    wickRatio = upperWick / candleRange;
  }
  // Smooth scaling from 12% wick (6 pts) to 35%+ wick (15 pts)
  const wickScore = Math.min(15.0, Math.max(5.0, (wickRatio / 0.35) * 15.0));
  breakdown.excessTailQuality = Math.round(wickScore * 10) / 10;

  // 4. Tactical Chart Price Action & Market Structure Confluence (0 - 20 pts)
  // Evaluates Liquidity Sweeps of Swing Points, Displacement, and Micro-FVGs
  let priceActionScore = 8.0; // Baseline structural credit
  const pa = signal.priceAction || {};

  if (pa.hasSweep) {
    priceActionScore += 8.0; // Major boost: price raided structural liquidity before reversing
  }
  if (pa.hasDisplacement) {
    priceActionScore += 5.0; // Clean institutional body dominance off the level
  }
  if (pa.hasFvgConfluence) {
    priceActionScore += 5.0; // Orderflow imbalance aligns with entry level
  }
  priceActionScore = Math.min(20.0, priceActionScore);
  breakdown.priceActionConfluence = Math.round(priceActionScore * 10) / 10;

  // 5. Variance Ratio Regime Alignment (0 - 15 pts)
  // Loosened so econometric test does not penalize strong price action
  let vrScore = 10.0;
  if (vrState) {
    const isMeanRevModel = signal.modelId === "MODEL_VWAP_MEAN_REVERSION" || signal.modelId === "STEIDLMAYER_80_PERCENT_RULE" || signal.modelId === "MODEL_IB_FAILED_AUCTION_TRAP";
    if (isMeanRevModel && vrState.regime === VARIANCE_REGIMES.SUB_DIFFUSIVE_MEAN_REVERTING) {
      vrScore = 15.0;
    } else if (!isMeanRevModel && vrState.regime === VARIANCE_REGIMES.SUPER_DIFFUSIVE_MOMENTUM) {
      vrScore = 15.0;
    } else if (vrState.isTradeable) {
      vrScore = 11.0;
    } else {
      vrScore = 7.0;
    }
  }
  breakdown.varianceRatioAlignment = Math.round(vrScore * 10) / 10;

  // 6. Session Timing & Spread Friction Health (0 - 10 pts)
  let timingScore = 5.0;
  const timeInfo = classifyAuctionTime(signal.time ?? curBar.time ?? curBar.t);
  if (timeInfo.isValid) {
    const totalMin = timeInfo.totalMinutes;
    // Prime opening auction drives: London 09:45 - 11:30 EET (585 - 690) or NY 16:15 - 18:00 EET (975 - 1080)
    const isPrimeDrive = (totalMin >= 585 && totalMin <= 690) || (totalMin >= 975 && totalMin <= 1080);
    timingScore = isPrimeDrive ? 7.0 : 5.0;
  }
  // Spread health: linear decay from 0% spread (3 pts) to 12% spread (0 pts)
  const spreadHealthScore = Math.max(0, 3.0 * (1.0 - spreadRatio / 0.12));
  breakdown.timingAndFriction = Math.round((timingScore + spreadHealthScore) * 10) / 10;

  const totalScore = Math.round(
    (breakdown.locationQuality +
      breakdown.macroDailyAlignment +
      breakdown.excessTailQuality +
      breakdown.priceActionConfluence +
      breakdown.varianceRatioAlignment +
      breakdown.timingAndFriction) *
      10
  ) / 10;

  const isApproved = totalScore >= MIN_APPROVAL_SCORE;
  const tier = totalScore >= 75.0 ? "GRADE_A_CONVICTION" : "GRADE_B_STANDARD";
  const reason = isApproved
    ? `APPROVED [${tier}] (${totalScore.toFixed(1)}/100): High-grade microstructural confluence in ${scenarioState?.scenarioName ?? "BALANCE"}.`
    : `REJECTED (${totalScore.toFixed(1)}/100): Confluence score below ${MIN_APPROVAL_SCORE} threshold.`;

  return {
    isApproved,
    totalScore,
    tier: isApproved ? tier : "REJECTED",
    breakdown,
    reason,
  };
}
