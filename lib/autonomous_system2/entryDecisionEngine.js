/**
 * lib/autonomous_system2/entryDecisionEngine.js
 *
 * System #2 Multi-Factor Institutional Confluence & Friction Decision Engine
 * Evaluates candidate execution signals against positive confluence factors and negative friction hazards.
 * Mirrors TradeSpace's institutional quantitative scoring framework.
 */

import { RISK_GUARDRAILS } from "./constants.js";
import { classifyAuctionTime } from "./timeEngine.js";

export const AUCTION_DECISION_WEIGHTS = {
  // Positive Institutional Confluence
  scenarioAlignment: 25,
  structuralExcessOrAcceptance: 20,
  daltonRotationConfirmation: 20,
  rrAsymmetry: 20,
  sessionTimingKillzone: 15,

  // Negative Friction & Hazard Deductions
  spreadFrictionDrag: -12,
  opposingInitiativeHazard: -15,
  lateSessionFatigue: -10,
  brownianNoiseHazard: -20,
};

/**
 * Evaluates an entry candidate signal through the institutional multi-factor engine.
 * @param {object} signal - Candidate signal from models.js
 * @param {object} scenarioState - Sovereign Auction Scenario from scenarios.js
 * @param {object} marketState - Current market state (spread, bars, TPO, dailyLoss, activeTrades)
 * @returns {object} Decision result { isApproved, totalScore, breakdown, reason }
 */
export function evaluateAuctionDecisionEngine(signal, scenarioState, marketState = {}) {
  if (!signal) {
    return { isApproved: false, totalScore: 0, breakdown: {}, reason: "NO_SIGNAL" };
  }

  const {
    spreadPts = 1.5,
    tpoProfile = null,
    yesterdayTpo = null,
    bars = [],
    activeTradeCount = 0,
    currentDailyLossPct = 0,
    minSlPoints = RISK_GUARDRAILS.MIN_STOP_LOSS_POINTS,
    maxSlPoints = RISK_GUARDRAILS.MAX_STOP_LOSS_POINTS,
  } = marketState;

  // -------------------------------------------------------------------------
  // 1. HARD CAPITAL PRESERVATION GUARDRAILS (Non-Negotiable Vetoes)
  // -------------------------------------------------------------------------
  if (currentDailyLossPct >= RISK_GUARDRAILS.MAX_DAILY_LOSS_PCT) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `DAILY_LOSS_GUARDRAIL_HIT: Loss is ${currentDailyLossPct.toFixed(2)}%, exceeding ${RISK_GUARDRAILS.MAX_DAILY_LOSS_PCT}% limit.`,
    };
  }

  if (activeTradeCount >= RISK_GUARDRAILS.MAX_CONCURRENT_TRADES) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `MAX_CONCURRENT_POSITIONS_REACHED: Holding ${activeTradeCount} trades.`,
    };
  }

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

  const spreadRatio = spreadPts / stopDistance;
  if (spreadRatio > RISK_GUARDRAILS.MAX_SPREAD_RATIO) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `SPREAD_FRICTION_TOO_HIGH: Spread ratio (${(spreadRatio * 100).toFixed(1)}%) exceeds ${RISK_GUARDRAILS.MAX_SPREAD_RATIO * 100}% threshold.`,
    };
  }

  if (signal.rrRatio < RISK_GUARDRAILS.MIN_RR_RATIO) {
    return {
      isApproved: false,
      totalScore: 0,
      breakdown: {},
      reason: `INSUFFICIENT_RR_RATIO: Expected R:R of ${signal.rrRatio.toFixed(2)} below ${RISK_GUARDRAILS.MIN_RR_RATIO} requirement.`,
    };
  }

  // -------------------------------------------------------------------------
  // 2. MULTI-FACTOR WEIGHTED SCORING
  // -------------------------------------------------------------------------
  const breakdown = {};
  let totalScore = 0;

  // Factor 1: Scenario Alignment (Max 25 pts)
  const isScenarioAligned = scenarioState?.allowedModels?.includes(signal.modelId);
  if (isScenarioAligned) {
    breakdown.scenarioAlignment = AUCTION_DECISION_WEIGHTS.scenarioAlignment;
    totalScore += breakdown.scenarioAlignment;
  } else {
    breakdown.scenarioAlignment = 0;
  }

  // Factor 2: Structural Excess or Value Acceptance (Max 20 pts)
  if (signal.direction === 1) {
    if (tpoProfile?.hasLowerExcess || (yesterdayTpo && signal.entryPrice > yesterdayTpo.tpoPoc)) {
      breakdown.structuralExcessOrAcceptance = AUCTION_DECISION_WEIGHTS.structuralExcessOrAcceptance;
    } else {
      breakdown.structuralExcessOrAcceptance = 10;
    }
  } else {
    if (tpoProfile?.hasUpperExcess || (yesterdayTpo && signal.entryPrice < yesterdayTpo.tpoPoc)) {
      breakdown.structuralExcessOrAcceptance = AUCTION_DECISION_WEIGHTS.structuralExcessOrAcceptance;
    } else {
      breakdown.structuralExcessOrAcceptance = 10;
    }
  }
  totalScore += breakdown.structuralExcessOrAcceptance;

  // Factor 3: Dalton Rotation Factor Confirmation (Max 20 pts)
  const rf = tpoProfile?.rotationFactor ?? 0;
  if (signal.direction === 1 && rf >= 0) {
    breakdown.daltonRotationConfirmation = AUCTION_DECISION_WEIGHTS.daltonRotationConfirmation;
  } else if (signal.direction === -1 && rf <= 0) {
    breakdown.daltonRotationConfirmation = AUCTION_DECISION_WEIGHTS.daltonRotationConfirmation;
  } else {
    // Slight counter-rotation acceptable if fading extreme
    breakdown.daltonRotationConfirmation = 8;
  }
  totalScore += breakdown.daltonRotationConfirmation;

  // Factor 4: Risk-to-Reward Asymmetry (Max 20 pts)
  if (signal.rrRatio >= 3.0) {
    breakdown.rrAsymmetry = AUCTION_DECISION_WEIGHTS.rrAsymmetry;
  } else if (signal.rrRatio >= 2.5) {
    breakdown.rrAsymmetry = 15;
  } else {
    breakdown.rrAsymmetry = 10;
  }
  totalScore += breakdown.rrAsymmetry;

  // Factor 5: Session Timing & Prime Killzones (Max 15 pts)
  const timeInfo = classifyAuctionTime(signal.entryPriceTime ?? (bars.length > 0 ? (bars[bars.length - 1].time ?? bars[bars.length - 1].t) : Date.now() / 1000));
  if (timeInfo.isLondonKZ || timeInfo.isNyKZ) {
    breakdown.sessionTimingKillzone = AUCTION_DECISION_WEIGHTS.sessionTimingKillzone;
  } else {
    breakdown.sessionTimingKillzone = 5;
  }
  totalScore += breakdown.sessionTimingKillzone;

  // -------------------------------------------------------------------------
  // 3. NEGATIVE FRICTION & HAZARD DEDUCTIONS
  // -------------------------------------------------------------------------
  // Hazard A: Excessive spread friction
  if (spreadRatio > 0.08) {
    breakdown.spreadFrictionDrag = AUCTION_DECISION_WEIGHTS.spreadFrictionDrag;
    totalScore += breakdown.spreadFrictionDrag;
  }

  // Hazard B: Opposing strong one-timeframing (e.g. going short against RF >= +4)
  if ((signal.direction === -1 && rf >= 4) || (signal.direction === 1 && rf <= -4)) {
    breakdown.opposingInitiativeHazard = AUCTION_DECISION_WEIGHTS.opposingInitiativeHazard;
    totalScore += breakdown.opposingInitiativeHazard;
  }

  // Final Decision Threshold: Must achieve >= 70 points
  const isApproved = totalScore >= 70;

  return {
    isApproved,
    totalScore,
    breakdown,
    reason: isApproved
      ? `APPROVED: Institutional Confluence Score ${totalScore}/100 passed threshold.`
      : `REJECTED: Confluence score ${totalScore}/100 below required 70 threshold.`,
  };
}
