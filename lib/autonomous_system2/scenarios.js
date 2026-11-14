/**
 * lib/autonomous_system2/scenarios.js
 *
 * Master Quantitative Auction Scenario Engine
 * Evaluates Distribution Topology, Session VWAP dispersion, and Lo-MacKinlay Variance Ratios.
 * Resolves the market structure into 4 authoritative quantitative scenarios.
 */

import {
  AUCTION_SCENARIOS,
  MODELS,
  TOPOLOGY_SHAPES,
  VARIANCE_REGIMES,
  MASTER_BIAS,
} from "./constants.js";

/**
 * Resolves the macro market structure into an authoritative Auction Scenario.
 * @param {object} tpoProfile - TPO topology profile from tpoTopologyEngine.js
 * @param {object} vwapState - Session VWAP state from vwapEngine.js
 * @param {object} vrState - Lo-MacKinlay Variance Ratio state from varianceRatioEngine.js
 * @param {object} yesterdayTpo - Previous session TPO profile
 * @returns {object} Authoritative Scenario State
 */
export function resolveAuctionScenario(tpoProfile, vwapState, vrState, yesterdayTpo = null) {
  if (!tpoProfile || !vwapState) {
    return {
      scenarioId: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.id,
      scenarioName: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.name,
      description: AUCTION_SCENARIOS.SCENARIO_STAND_ASIDE_NOISE.description,
      allowedModels: [],
      masterBias: MASTER_BIAS.STAND_ASIDE_CHOP,
      confidence: 0,
      rationale: "Insufficient intraday profile data.",
    };
  }

  const { topology, isPoorHigh, isPoorLow } = tpoProfile;
  const { varianceRatio, regime: vrRegime } = vrState ?? { varianceRatio: 1.0, regime: VARIANCE_REGIMES.RANDOM_WALK_BROWNIAN };

  // 1. Unfinished Auction Exploitation (Magnet towards the poor extreme)
  if (isPoorHigh || isPoorLow) {
    return {
      scenarioId: AUCTION_SCENARIOS.SCENARIO_UNFINISHED_AUCTION.id,
      scenarioName: AUCTION_SCENARIOS.SCENARIO_UNFINISHED_AUCTION.name,
      description: AUCTION_SCENARIOS.SCENARIO_UNFINISHED_AUCTION.description,
      allowedModels: [MODELS.MODEL_INITIATIVE_VALUE_RETEST],
      masterBias: isPoorHigh ? MASTER_BIAS.BULLISH_TREND : MASTER_BIAS.BEARISH_TREND,
      confidence: 82,
      rationale: `Unfinished Auction extreme confirmed (${isPoorHigh ? "Poor High" : "Poor Low"}). Structural magnet active.`,
    };
  }

  // 2. Initiative Value Migration Scenario (P-Shape / b-Shape or Trend Day)
  const isInitiativeTopology =
    topology === TOPOLOGY_SHAPES.P_SHAPE_BUYER_INITIATIVE ||
    topology === TOPOLOGY_SHAPES.B_SHAPE_SELLER_INITIATIVE ||
    topology === TOPOLOGY_SHAPES.TRENDING_AUCTION;
  const isSuperDiffusive = vrRegime === VARIANCE_REGIMES.SUPER_DIFFUSIVE_MOMENTUM;

  if (isInitiativeTopology || isSuperDiffusive) {
    let isBullish = false;
    if (topology === TOPOLOGY_SHAPES.P_SHAPE_BUYER_INITIATIVE) {
      isBullish = true;
    } else if (topology === TOPOLOGY_SHAPES.B_SHAPE_SELLER_INITIATIVE) {
      isBullish = false;
    } else {
      // Trending Auction or Super-Diffusive: Check price location relative to Session VWAP and IB Mid
      isBullish = vwapState.vwap ? (tpoProfile.tpoPoc >= vwapState.vwap) : (tpoProfile.rotationFactor > 0);
    }

    return {
      scenarioId: AUCTION_SCENARIOS.SCENARIO_INITIATIVE_MIGRATION.id,
      scenarioName: AUCTION_SCENARIOS.SCENARIO_INITIATIVE_MIGRATION.name,
      description: AUCTION_SCENARIOS.SCENARIO_INITIATIVE_MIGRATION.description,
      allowedModels: [MODELS.MODEL_INITIATIVE_VALUE_RETEST],
      masterBias: isBullish ? MASTER_BIAS.BULLISH_TREND : MASTER_BIAS.BEARISH_TREND,
      confidence: 85,
      rationale: `Initiative Value Migration active (Topology=${topology}, VR=${varianceRatio}). Retest continuation active.`,
    };
  }

  // 3. Two-Sided Rotational Balance Scenario (D-Shape Balance or Sub-Diffusive)
  const isBalancedTopology = topology === TOPOLOGY_SHAPES.D_SHAPE_BALANCED;
  const isSubDiffusive = vrRegime === VARIANCE_REGIMES.SUB_DIFFUSIVE_MEAN_REVERTING;

  if (isBalancedTopology || isSubDiffusive) {
    return {
      scenarioId: AUCTION_SCENARIOS.SCENARIO_ROTATIONAL_BALANCE.id,
      scenarioName: AUCTION_SCENARIOS.SCENARIO_ROTATIONAL_BALANCE.name,
      description: AUCTION_SCENARIOS.SCENARIO_ROTATIONAL_BALANCE.description,
      allowedModels: [
        MODELS.MODEL_VWAP_MEAN_REVERSION,
        MODELS.STEIDLMAYER_80_PERCENT_RULE,
        MODELS.MODEL_IB_FAILED_AUCTION_TRAP,
      ],
      masterBias: MASTER_BIAS.ROTATIONAL_BALANCED,
      confidence: 88,
      rationale: `Rotational Two-Sided Balance verified (D-Shape, VR=${varianceRatio}). Inventory reversion & 80% Rule active.`,
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
    rationale: `Market in Brownian noise without structural edge (VR=${varianceRatio}). Standing aside.`,
  };
}
