import { getEetTime } from "./timeslots.js";

// Trading Scenarios & Dynamic Horizon Resolver
// Governs whether a qualified pair should be traded as Intraday (15M-1M) or Swing (4H-1D).

export const SCENARIOS = {
  INTRADAY: {
    id: "intraday",
    label: "Intraday Expansion (15M-1M)",
    badge: "15M-1M",
    description: "Captures intraday expansions toward session DOL. 4H/1D Compass provides directional guardrail, 1H defines session runway, 15M Gatekeeper approves, and 15M/5M provides entry.",
    macroTf: "H4",
    sessionTf: "H1",
    gatekeeperTf: "M15",
    triggerTf: "M15",
    minRR: 2.0,
    expectedHoldingHours: "2 - 8 hrs",
  },
  SWING: {
    id: "swing",
    label: "Swing Expansion (4H-1D)",
    badge: "4H-1D",
    description: "Captures multi-day structural expansions between HTF dealing range extremes. D1 sets macro trend, 4H FVG lifecycle defends order flow, and 1H/15M refines deep discount/premium entry.",
    macroTf: "D1",
    sessionTf: "H4",
    gatekeeperTf: "H1",
    triggerTf: "H1",
    minRR: 2.8,
    expectedHoldingHours: "1 - 4 days",
  },
};

/**
 * Resolves the optimal trading scenario dynamically for a given symbol.
 * @param {Object} params
 * @param {string} params.symbol
 * @param {Object} params.brain - output from evaluateMarketBrain
 * @param {Object} params.ranges - dealing ranges output
 * @param {Object} params.config - autonomous configuration
 */
export function resolveScenarioForPair({
  symbol,
  brain,
  ranges,
  config,
}) {
  const mode = config.horizonMode || "adaptive";

  // 1. Trader hard override
  if (mode === "intraday") {
    return {
      scenario: SCENARIOS.INTRADAY,
      mode: "intraday",
      rationale: "Locked to Intraday (15M-1M) by user configuration.",
    };
  }
  if (mode === "swing") {
    return {
      scenario: SCENARIOS.SWING,
      mode: "swing",
      rationale: "Locked to Swing (4H-1D) by user configuration.",
    };
  }

  // 2. Dynamic Adaptive Evaluation
  const h4Range = ranges?.ranges?.H4;
  const d1Range = ranges?.ranges?.D1;
  const dol = brain?.targetDOL;
  const conviction = brain?.conviction || 50;

  // Check EET hour for active trading session (Broker Server Time Standard)
  const now = new Date();
  const { h: eetHour } = getEetTime(now);
  const isLondonSession = eetHour >= 10 && eetHour <= 19;
  const isNySession = eetHour >= 15 && eetHour <= 23;
  const isPrimeIntradaySession = isLondonSession || isNySession;

  // Calculate HTF remaining runway to target
  let h4Runway = 50;
  if (h4Range) {
    if (brain?.allowedToLong) {
      h4Runway = Math.max(0, 100 - h4Range.coveragePct);
    } else if (brain?.allowedToShort) {
      h4Runway = Math.max(0, h4Range.coveragePct);
    }
  }

  // Swing qualification criteria:
  // - Massive HTF runway remaining (>50%)
  // - Clear HTF target DOL (PWH, PWL, 4H External Liquidity)
  // - High conviction >= 80
  // - 4H FVG lifecycle dominant
  const isHtfDol = dol && /(PWH|PWL|D1|4H\s+EQ[HL]|SWING)/i.test(dol.name || "");
  const hasMassiveHtfRunway = h4Runway >= 55;
  const isHtfOrderFlowDominant = brain?.fvgOrderFlow === "BULLISH_DOMINANT" || brain?.fvgOrderFlow === "BEARISH_DOMINANT";

  if (hasMassiveHtfRunway && isHtfDol && conviction >= 78 && isHtfOrderFlowDominant) {
    return {
      scenario: SCENARIOS.SWING,
      mode: "adaptive_swing",
      rationale: `Adaptive Engine selected Swing (4H-1D): Pair exhibits dominant 4H order flow with ${Math.round(h4Runway)}% open HTF runway targeting ${dol?.name || "HTF DOL"}.`,
    };
  }

  // Intraday qualification:
  // - Prime killzone active (London/NY) or intraday setup ready
  // - 15M Gatekeeper actively evaluating session range
  if (isPrimeIntradaySession) {
    return {
      scenario: SCENARIOS.INTRADAY,
      mode: "adaptive_intraday",
      rationale: `Adaptive Engine selected Intraday (15M-1M): Active session timing (${isNySession ? "NY Session" : "London Session"}) with session dealing range offering tight invalidation.`,
    };
  }

  // Default fallback if outside prime session:
  // If runway is wide, swing; otherwise standard intraday
  if (h4Runway >= 45) {
    return {
      scenario: SCENARIOS.SWING,
      mode: "adaptive_swing",
      rationale: "Adaptive Engine selected Swing: Off-session hours with wide HTF range runway favoring macro positioning.",
    };
  }

  return {
    scenario: SCENARIOS.INTRADAY,
    mode: "adaptive_intraday",
    rationale: "Adaptive Engine selected Intraday: Defined 1H/15M session range runway.",
  };
}
