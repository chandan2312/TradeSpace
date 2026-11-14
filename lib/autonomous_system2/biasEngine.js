/**
 * lib/autonomous_system2/biasEngine.js
 *
 * System #2 Master Bias & Context Engine
 * Synthesizes Multi-Day TPO Value Area Migration with Quantitative Hurst Regimes.
 * Coordinates with scenarios.js to determine the sovereign Auction Scenario.
 */

import { MASTER_BIAS } from "./constants.js";
import { assessMarketRegime } from "./regimeEngine.js";
import { resolveAuctionScenario } from "./scenarios.js";

/**
 * Determines the Master Bias and Sovereign Auction Scenario for the asset.
 * @param {Array<object>} bars - Historical rolling bars
 * @param {object} todayTpo - Current session's TPO profile
 * @param {object} yesterdayTpo - Previous session's finalized TPO profile
 * @param {Array<object>} sessionBars - Current day's intraday bars
 * @returns {object} Comprehensive Bias state, Sovereign Scenario, and allowed models
 */
export function determineMasterBias(bars, todayTpo, yesterdayTpo, sessionBars = []) {
  const regimeInfo = assessMarketRegime(bars);
  const scenario = resolveAuctionScenario(bars, sessionBars, todayTpo, yesterdayTpo, regimeInfo);

  return {
    masterBias: scenario.masterBias,
    confidence: scenario.confidence,
    allowedModels: scenario.allowedModels,
    scenarioId: scenario.scenarioId,
    scenarioName: scenario.scenarioName,
    scenarioDescription: scenario.description,
    openType: scenario.openType,
    valueRel: scenario.valueRel,
    reason: scenario.rationale,
    regimeInfo,
    tpoDayType: todayTpo ? todayTpo.dayType : "UNKNOWN",
  };
}
