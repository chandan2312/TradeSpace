/**
 * lib/autonomous_system2/preEntryValidation.js
 *
 * System #2 Pre-Entry Institutional Validation & Friction Guardrails
 * Connects directly to entryDecisionEngine.js for multi-factor confluence scoring.
 */

import { evaluateAuctionDecisionEngine } from "./entryDecisionEngine.js";

/**
 * Validates a potential trade signal against institutional prop firm guardrails and scenario confluence.
 * @param {object} signal - Proposed entry signal from models.js
 * @param {object} marketState - Current market state (spread, dailyLossPct, activeTrades, etc.)
 * @returns {object} Validation result { isValid: boolean, score: number, breakdown: object, reason: string }
 */
export function validatePreEntry(signal, marketState = {}) {
  const scenarioState = marketState.biasState ?? {};
  const decision = evaluateAuctionDecisionEngine(signal, scenarioState, marketState);

  return {
    isValid: decision.isApproved,
    score: decision.totalScore,
    breakdown: decision.breakdown,
    reason: decision.reason,
    spreadDeductionPoints: marketState.spreadPts ?? 1.5,
  };
}
