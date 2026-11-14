/**
 * lib/autonomous_system2/scenarios.js
 *
 * System #2 Foundational Auction Scenario Engine
 * Categorizes the macro market structure into 3 sovereign Auction Scenarios:
 * 1. SCENARIO_INITIATIVE_EXPANSION (Trend Discovery & Volatility Breakout)
 * 2. SCENARIO_ROTATIONAL_BALANCE (Two-Sided Auction & Structural Excess Traps)
 * 3. SCENARIO_STAND_ASIDE_NOISE (Brownian Random Walk & Capital Preservation)
 */

import {
  AUCTION_SCENARIOS,
  MODELS,
  REGIMES,
  VALUE_RELATIONSHIPS,
  TPO_DAY_TYPES,
  MASTER_BIAS,
} from "./constants.js";
import { classifyValueRelationship } from "./tpoEngine.js";

export const DALTON_OPEN_TYPES = {
  OPEN_DRIVE: "OPEN_DRIVE",                         // Immediate one-sided initiative, never returns to open
  OPEN_TEST_DRIVE: "OPEN_TEST_DRIVE",               // Quick test of prior reference, then drives aggressively
  OPEN_REJECTION_REVERSE: "OPEN_REJECTION_REVERSE", // Probes outside range, strongly rejected, rotates back through range
  OPEN_AUCTION_IN_RANGE: "OPEN_AUCTION_IN_RANGE",   // Opens inside range, two-sided rotational chop
};

/**
 * Classifies the Dalton Open Auction Type from the early session bars (first 4 M15 bars / 60 mins).
 */
export function classifyDaltonOpenType(sessionBars, yesterdayTpo) {
  if (!sessionBars || sessionBars.length === 0) return DALTON_OPEN_TYPES.OPEN_AUCTION_IN_RANGE;

  const firstBar = sessionBars[0];
  const openPrice = firstBar.open ?? firstBar.o;
  const earlyBars = sessionBars.slice(0, Math.min(4, sessionBars.length));

  if (!yesterdayTpo) return DALTON_OPEN_TYPES.OPEN_AUCTION_IN_RANGE;

  const isOpenedOutsideValue = openPrice > yesterdayTpo.vah || openPrice < yesterdayTpo.val;
  let retestedOpen = false;

  for (let i = 1; i < earlyBars.length; i++) {
    const b = earlyBars[i];
    const h = b.high ?? b.h;
    const l = b.low ?? b.l;
    if (openPrice >= l && openPrice <= h) retestedOpen = true;
  }

  // Open Drive
  if (!retestedOpen && earlyBars.length >= 3 && isOpenedOutsideValue) {
    return DALTON_OPEN_TYPES.OPEN_DRIVE;
  }

  // Open Rejection Reverse
  const latestEarlyBar = earlyBars[earlyBars.length - 1];
  const latestClose = latestEarlyBar.close ?? latestEarlyBar.c;
  const isNowInsideValue = latestClose <= yesterdayTpo.vah && latestClose >= yesterdayTpo.val;
  if (isOpenedOutsideValue && isNowInsideValue) {
    return DALTON_OPEN_TYPES.OPEN_REJECTION_REVERSE;
  }

  return DALTON_OPEN_TYPES.OPEN_AUCTION_IN_RANGE;
}

/**
 * Authoritative Scenario Classification Engine.
 * Evaluates the full macro structural context and returns the sovereign scenario.
 */
export function resolveAuctionScenario(bars, sessionBars, todayTpo, yesterdayTpo, regimeInfo) {
  const valueRel = classifyValueRelationship(todayTpo, yesterdayTpo);
  const openType = classifyDaltonOpenType(sessionBars, yesterdayTpo);
  const curBar = bars[bars.length - 1];
  const curClose = curBar.close ?? curBar.c;

  // 1. Capital Preservation Guardrail (Brownian noise without compressed energy)
  if (!regimeInfo.isTradeable && !regimeInfo.squeezeInfo?.isSqueezeOn && !regimeInfo.squeezeInfo?.squeezeFired) {
    return {
      scenarioId: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.id,
      scenarioName: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.name,
      description: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.description,
      allowedModels: [],
      masterBias: MASTER_BIAS.STAND_ASIDE_CHOP,
      confidence: 0,
      openType,
      valueRel,
      rationale: `Brownian Noise (Hurst=${regimeInfo.hurst}) with zero kinetic compression. Capital preservation mode.`,
    };
  }

  // 2. Initiative Directional Expansion Scenario
  // Requirements: Verified Squeeze release with >= 4 bars of coiled energy, OR strong Hurst trend persistence
  const isSqueezeReleased = regimeInfo.squeezeInfo?.squeezeFired && regimeInfo.squeezeInfo?.squeezeBars >= 4;
  const isTrendPersistent = regimeInfo.regime === REGIMES.TREND_PERSISTENT;

  if (isSqueezeReleased || (isTrendPersistent && regimeInfo.squeezeInfo?.isMomentumExpanding)) {
    // Determine direction via Prior TPO Value Acceptance
    const isBullishAcceptance = yesterdayTpo ? curClose > yesterdayTpo.tpoPoc : curClose > (todayTpo?.ibMid ?? curClose);
    const direction = isBullishAcceptance ? 1 : -1;

    return {
      scenarioId: AUCTION_SCENARIOS.SCENARIO_INITIATIVE_EXPANSION.id,
      scenarioName: AUCTION_SCENARIOS.SCENARIO_INITIATIVE_EXPANSION.name,
      description: AUCTION_SCENARIOS.SCENARIO_INITIATIVE_EXPANSION.description,
      allowedModels: [MODELS.MODEL_2_COILED_SQUEEZE_EXPANSION],
      masterBias: direction === 1 ? MASTER_BIAS.BULLISH_TREND : MASTER_BIAS.BEARISH_TREND,
      confidence: 88,
      openType,
      valueRel,
      rationale: `Initiative Expansion active. Squeeze release + Directional Value Acceptance (${direction === 1 ? "Above Prior POC" : "Below Prior POC"}).`,
    };
  }

  // 3. Two-Sided Rotational Balance Scenario
  // Requirements: Mean-Reverting Hurst (H < 0.45) OR TPO Normal Day (Price confined inside Initial Balance)
  const isMeanReverting = regimeInfo.regime === REGIMES.MEAN_REVERTING;
  const isNormalDay = todayTpo?.dayType === TPO_DAY_TYPES.NORMAL_DAY;

  if (isMeanReverting || isNormalDay) {
    return {
      scenarioId: AUCTION_SCENARIOS.SCENARIO_ROTATIONAL_BALANCE.id,
      scenarioName: AUCTION_SCENARIOS.SCENARIO_ROTATIONAL_BALANCE.name,
      description: AUCTION_SCENARIOS.SCENARIO_ROTATIONAL_BALANCE.description,
      allowedModels: [MODELS.MODEL_1_IB_FAILED_AUCTION_TRAP],
      masterBias: MASTER_BIAS.ROTATIONAL_BALANCED,
      confidence: 80,
      openType,
      valueRel,
      rationale: `Rotational Two-Sided Auction verified. Hurst=${regimeInfo.hurst}, DayType=${todayTpo?.dayType ?? "NORMAL"}. Failed Auction traps active.`,
    };
  }

  // 4. Stand-Aside Mode
  return {
    scenarioId: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.id,
    scenarioName: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.name,
    description: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.description,
    allowedModels: [],
    masterBias: MASTER_BIAS.STAND_ASIDE_CHOP,
    confidence: 0,
    openType,
    valueRel,
    rationale: `Market outside tradeable auction structures (Hurst=${regimeInfo.hurst}, Value=${valueRel}). Standing aside.`,
  };
}
