// The Market Brain Synthesis Engine
// Combines Multi-Timeframe Dealing Ranges, 4H FVG Order Flow, HTF Liquidity,
// and Intraday Triggers into a cognitive market thesis for automated systems.
//
// Key principles:
//   1. Dynamic evaluation over simple score sums
//   2. Range coverage awareness: Never chase exhausted moves
//   3. 4H FVG defense vs violation governs institutional bias
//   4. Institutional Draw on Liquidity (DOL) dictates direction
//   5. Day-Trading Division of Labor:
//      - 1D & 4H: THE COMPASS (Directional bias & Macro Target/DOL)
//      - 1H: THE SESSION ROADMAP (Intermediate dealing range & context)
//      - 15M: THE GATEKEEPER & TRIGGER (100% Veto Power over execution)

/**
 * Dynamically evaluates the market state using all structural and liquidity layers.
 * @param {Object} params
 * @param {string} params.symbol
 * @param {Object} params.ranges - output from analyzeAllDealingRanges
 * @param {Object} params.htfFvg - output from analyze4HFVGs
 * @param {Object} params.htfLiq - output from analyzeHTFLiquidity
 * @param {Object} params.structures - per-TF structure from analyzeStructure
 * @param {Object} params.intraday - intraday triggers (setup, QML, sweeps)
 * @param {number} params.score - base lens score from engine
 */
export function evaluateMarketBrain({
  symbol,
  ranges,
  htfFvg,
  htfLiq,
  structures = {},
  intraday = {},
  score = 0,
}) {
  const h4Range = ranges?.ranges?.H4;
  const m15Range = ranges?.ranges?.M15;
  const h1Range = ranges?.ranges?.H1;
  const d1Range = ranges?.ranges?.D1;

  const currentPrice = h4Range?.currentPrice || m15Range?.currentPrice || 0;
  const dol = htfLiq?.drawOnLiquidity;
  const fvgOrderFlow = htfFvg?.orderFlowState || "NEUTRAL";
  const recentSweeps = htfLiq?.sweeps || [];
  const freshHtfSweep = recentSweeps.find((s) => s.age <= 6);

  const catalysts = [];
  const blockReasons = [];
  const conflicts = [];

  let verdict = "RANGE_EQUILIBRIUM_CHOP";
  let action = "STAND_ASIDE";
  let conviction = 50;
  let allowedToLong = false;
  let allowedToShort = false;
  let invalidationPrice = null;
  let warning = null;

  // --------------------------------------------------------------------------
  // 1. Evaluate Range Coverage & Exhaustion
  // --------------------------------------------------------------------------
  const isH4DeepPremium = h4Range && h4Range.coveragePct >= 78;
  const isH4DeepDiscount = h4Range && h4Range.coveragePct <= 22;
  const isM15ExhaustedHigh = m15Range && m15Range.status === "EXHAUSTED_HIGH";
  const isM15ExhaustedLow = m15Range && m15Range.status === "EXHAUSTED_LOW";

  if (isH4DeepPremium && isM15ExhaustedHigh) {
    warning = "H4 and M15 ranges are both exhausted in Deep Premium (>80%). Chasing longs is strictly blocked.";
    blockReasons.push("Severe range exhaustion at premium ceiling");
  } else if (isH4DeepDiscount && isM15ExhaustedLow) {
    warning = "H4 and M15 ranges are both exhausted in Deep Discount (<20%). Chasing shorts is strictly blocked.";
    blockReasons.push("Severe range exhaustion at discount floor");
  }

  // --------------------------------------------------------------------------
  // 2. Evaluate 4H FVG Respect vs Violation
  // --------------------------------------------------------------------------
  const hasRespectedBullFVG = htfFvg?.respected?.some((g) => g.dir === 1 && g.ageBars <= 12);
  const hasRespectedBearFVG = htfFvg?.respected?.some((g) => g.dir === -1 && g.ageBars <= 12);
  const hasViolatedBullFVG = htfFvg?.unrespected?.some((g) => g.dir === 1 && g.ageBars <= 12);
  const hasViolatedBearFVG = htfFvg?.unrespected?.some((g) => g.dir === -1 && g.ageBars <= 12);

  if (hasRespectedBullFVG) {
    catalysts.push("4H Bullish FVG tested and respected (institutional buy defense)");
  }
  if (hasRespectedBearFVG) {
    catalysts.push("4H Bearish FVG tested and respected (institutional sell defense)");
  }
  if (hasViolatedBullFVG) {
    catalysts.push("4H Bullish FVG violated and inverted into resistance");
  }
  if (hasViolatedBearFVG) {
    catalysts.push("4H Bearish FVG violated and inverted into support");
  }

  // --------------------------------------------------------------------------
  // 3. Evaluate HTF Sweeps & ERL/IRL Cycle
  // --------------------------------------------------------------------------
  if (freshHtfSweep) {
    catalysts.push(`HTF liquidity raid: ${freshHtfSweep.name} swept on 4H frame (${freshHtfSweep.age * 4}h ago)`);
  }
  if (htfLiq?.activeCycle === "IRL_TO_ERL") {
    catalysts.push("Active HTF auction cycle: Expanding from internal liquidity towards external pool");
  } else if (htfLiq?.activeCycle === "ERL_TO_IRL") {
    catalysts.push("Active HTF auction cycle: Rotating from external pool into internal range");
  }

  // --------------------------------------------------------------------------
  // 4. DAY-TRADING DIVISION OF LABOR: Macro Compass & 15M Gatekeeper
  // --------------------------------------------------------------------------
  let macroCompass = "NEUTRAL";
  let macroRationale = "Macro context in equilibrium consolidation.";

  if (freshHtfSweep && freshHtfSweep.side === -1) {
    macroCompass = "BULLISH";
    macroRationale = `Institutional SSL purge (${freshHtfSweep.name}). Reversal seeking buy-side liquidity.`;
  } else if (freshHtfSweep && freshHtfSweep.side === 1) {
    macroCompass = "BEARISH";
    macroRationale = `Institutional BSL purge (${freshHtfSweep.name}). Reversal seeking sell-side liquidity.`;
  } else if (hasRespectedBullFVG || fvgOrderFlow === "STRONG_BULLISH_ORDER_FLOW" || (structures.H4?.dir === 1 && score > 15)) {
    macroCompass = "BULLISH";
    macroRationale = "4H institutional bullish order flow actively defended.";
  } else if (hasRespectedBearFVG || fvgOrderFlow === "STRONG_BEARISH_ORDER_FLOW" || (structures.H4?.dir === -1 && score < -15)) {
    macroCompass = "BEARISH";
    macroRationale = "4H institutional bearish order flow actively defended.";
  } else if (structures.H4?.dir === 1 || structures.D1?.dir === 1) {
    macroCompass = "BULLISH";
    macroRationale = "Higher timeframe structural trend is bullish (HH+HL).";
  } else if (structures.H4?.dir === -1 || structures.D1?.dir === -1) {
    macroCompass = "BEARISH";
    macroRationale = "Higher timeframe structural trend is bearish (LH+LL).";
  } else if (score > 25) {
    macroCompass = "BULLISH";
    macroRationale = "Multi-lens ensemble leaning bullish in neutral HTF context.";
  } else if (score < -25) {
    macroCompass = "BEARISH";
    macroRationale = "Multi-lens ensemble leaning bearish in neutral HTF context.";
  }

  const m15Dir = structures.M15?.dir ?? 0;
  const setupDir = intraday?.setup?.dir ?? 0;
  const m15Coverage = m15Range?.coveragePct ?? null;
  const m15Zone = m15Range?.zone || null;

  let m15VetoActive = false;
  let m15VetoReason = null;
  let m15TriggerStatus = "NEUTRAL"; // "APPROVED" | "WAIT_PULLBACK" | "WAIT_SHIFT" | "BLOCKED"

  if (macroCompass === "BULLISH") {
    if (m15Coverage != null && (m15Coverage > 65 || m15Range?.status === "EXHAUSTED_HIGH")) {
      m15VetoActive = true;
      m15VetoReason = `15M is overextended in ${m15Zone} (${m15Coverage}%). Day traders must wait for 15M pullback into Discount (<50%).`;
      m15TriggerStatus = "WAIT_PULLBACK";
    } else if (m15Coverage != null && m15Coverage <= 65) {
      if (m15Dir === -1 && setupDir !== 1) {
        m15VetoActive = true;
        m15VetoReason = `15M reached ${m15Zone} (${m15Coverage}%) but is still in active downward retracement leg. Awaiting 15M structure shift (MSS/CHoCH) to confirm entry.`;
        m15TriggerStatus = "WAIT_SHIFT";
      } else {
        m15VetoActive = false;
        m15TriggerStatus = "APPROVED";
      }
    } else if (m15Dir === 1 || setupDir === 1) {
      m15VetoActive = false;
      m15TriggerStatus = "APPROVED";
    }
  } else if (macroCompass === "BEARISH") {
    if (m15Coverage != null && (m15Coverage < 35 || m15Range?.status === "EXHAUSTED_LOW")) {
      m15VetoActive = true;
      m15VetoReason = `15M is overextended in ${m15Zone} (${m15Coverage}%). Day traders must wait for 15M pullback into Premium (>50%).`;
      m15TriggerStatus = "WAIT_PULLBACK";
    } else if (m15Coverage != null && m15Coverage >= 35) {
      if (m15Dir === 1 && setupDir !== -1) {
        m15VetoActive = true;
        m15VetoReason = `15M reached ${m15Zone} (${m15Coverage}%) but is still in active upward retracement leg. Awaiting 15M structure shift (MSS/CHoCH) to confirm entry.`;
        m15TriggerStatus = "WAIT_SHIFT";
      } else {
        m15VetoActive = false;
        m15TriggerStatus = "APPROVED";
      }
    } else if (m15Dir === -1 || setupDir === -1) {
      m15VetoActive = false;
      m15TriggerStatus = "APPROVED";
    }
  }

  // --------------------------------------------------------------------------
  // 5. Dynamic Cognitive Synthesis (The Brain's Core State Machine)
  // --------------------------------------------------------------------------

  // SCENARIO 1: Bullish Reversal from HTF Liquidity Sweep
  if (freshHtfSweep && freshHtfSweep.side === -1 && (hasRespectedBullFVG || setupDir === 1 || m15Dir === 1)) {
    verdict = "BULLISH_REVERSAL_CONFIRMED";
    conviction = 88;
    invalidationPrice = freshHtfSweep.sweptPrice;
    catalysts.push("SSL swept + immediate lower-timeframe bullish reclamation");

    if (m15VetoActive) {
      allowedToLong = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToLong = true;
      action = "READY_FOR_LONG";
    }
  }
  // SCENARIO 2: Bearish Reversal from HTF Liquidity Sweep
  else if (freshHtfSweep && freshHtfSweep.side === 1 && (hasRespectedBearFVG || setupDir === -1 || m15Dir === -1)) {
    verdict = "BEARISH_REVERSAL_CONFIRMED";
    conviction = 88;
    invalidationPrice = freshHtfSweep.sweptPrice;
    catalysts.push("BSL swept + immediate lower-timeframe bearish rejection");

    if (m15VetoActive) {
      allowedToShort = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToShort = true;
      action = "READY_FOR_SHORT";
    }
  }
  // SCENARIO 3: Strong Bullish Expansion (Clean Uncovered Runway)
  else if (
    (hasRespectedBullFVG || hasViolatedBearFVG || fvgOrderFlow === "STRONG_BULLISH_ORDER_FLOW") &&
    (!h4Range || h4Range.coveragePct < 75) &&
    (!m15Range || m15Range.status !== "EXHAUSTED_HIGH") &&
    score > 15
  ) {
    verdict = "STRONG_BULLISH_EXPANSION";
    conviction = 84;
    const support = htfFvg?.nearestSupportFVG;
    invalidationPrice = support ? support.bottom : h4Range ? h4Range.eq : null;
    catalysts.push("Bullish 4H order flow defended with ample uncovered range runway to target");

    if (m15VetoActive) {
      allowedToLong = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToLong = true;
      action = "READY_FOR_LONG";
      catalysts.push("15M Gatekeeper confirmed: In Discount with bullish structure alignment");
    }
  }
  // SCENARIO 4: Strong Bearish Expansion (Clean Uncovered Runway)
  else if (
    (hasRespectedBearFVG || hasViolatedBullFVG || fvgOrderFlow === "STRONG_BEARISH_ORDER_FLOW") &&
    (!h4Range || h4Range.coveragePct > 25) &&
    (!m15Range || m15Range.status !== "EXHAUSTED_LOW") &&
    score < -15
  ) {
    verdict = "STRONG_BEARISH_EXPANSION";
    conviction = 84;
    const res = htfFvg?.nearestResistanceFVG;
    invalidationPrice = res ? res.top : h4Range ? h4Range.eq : null;
    catalysts.push("Bearish 4H order flow defended with ample uncovered range runway to target");

    if (m15VetoActive) {
      allowedToShort = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToShort = true;
      action = "READY_FOR_SHORT";
      catalysts.push("15M Gatekeeper confirmed: In Premium with bearish structure alignment");
    }
  }
  // SCENARIO 5: Exhausted Bullish (Chaser Trap)
  else if (score > 10 && (isH4DeepPremium || isM15ExhaustedHigh)) {
    verdict = "EXHAUSTED_BULLISH";
    action = "STAND_ASIDE";
    allowedToLong = false;
    conviction = 65;
    conflicts.push("Bullish momentum present but range coverage is >= 85% exhausted into resistance");
    blockReasons.push("Range exhausted at range ceiling");
  }
  // SCENARIO 6: Exhausted Bearish (Seller Trap)
  else if (score < -10 && (isH4DeepDiscount || isM15ExhaustedLow)) {
    verdict = "EXHAUSTED_BEARISH";
    action = "STAND_ASIDE";
    allowedToShort = false;
    conviction = 65;
    conflicts.push("Bearish momentum present but range coverage is <= 15% exhausted into support");
    blockReasons.push("Range exhausted at range floor");
  }
  // SCENARIO 7: Pullback into Discount in Uptrend
  else if (structures.H4?.dir === 1 && h4Range?.zone === "DISCOUNT" && hasRespectedBullFVG) {
    verdict = "BULLISH_PULLBACK_DEFENDED";
    conviction = 80;
    const support = htfFvg?.nearestSupportFVG;
    invalidationPrice = support ? support.bottom : h4Range.low;

    if (m15VetoActive) {
      allowedToLong = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToLong = true;
      action = "READY_FOR_LONG";
    }
  }
  // SCENARIO 8: Pullback into Premium in Downtrend
  else if (structures.H4?.dir === -1 && h4Range?.zone === "PREMIUM" && hasRespectedBearFVG) {
    verdict = "BEARISH_PULLBACK_DEFENDED";
    conviction = 80;
    const res = htfFvg?.nearestResistanceFVG;
    invalidationPrice = res ? res.top : h4Range.high;

    if (m15VetoActive) {
      allowedToShort = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToShort = true;
      action = "READY_FOR_SHORT";
    }
  }
  // SCENARIO 9: Equilibrium Chop / Mixed Signals
  else {
    verdict = "RANGE_EQUILIBRIUM_CHOP";
    action = "STAND_ASIDE";
    conviction = 40;
    conflicts.push("Price hovering in Equilibrium without clear institutional order flow defense");
  }

  // --------------------------------------------------------------------------
  // 6. Generate Institutional Narrative
  // --------------------------------------------------------------------------
  let narrative = "";
  if (verdict === "STRONG_BULLISH_EXPANSION") {
    narrative = `Macro Compass is BULLISH: 4H fair value gaps are defended and delivery targets ${
      dol ? dol.name : "overhead liquidity"
    }. `;
    if (m15VetoActive) {
      narrative += `[15M VETO ACTIVE]: ${m15VetoReason}`;
    } else {
      narrative += `15M Gatekeeper approves execution with ${
        m15Range ? `${m15Range.remainingPctToHigh}% uncovered upside in the M15 dealing range` : "clean runway"
      }.`;
    }
  } else if (verdict === "STRONG_BEARISH_EXPANSION") {
    narrative = `Macro Compass is BEARISH: 4H fair value gaps are defended and delivery targets ${
      dol ? dol.name : "sell-side liquidity"
    }. `;
    if (m15VetoActive) {
      narrative += `[15M VETO ACTIVE]: ${m15VetoReason}`;
    } else {
      narrative += `15M Gatekeeper approves execution with ${
        m15Range ? `${m15Range.remainingPctToLow}% uncovered downside in the M15 dealing range` : "clean runway"
      }.`;
    }
  } else if (verdict === "EXHAUSTED_BULLISH") {
    narrative = `Bullish movement is currently covering terminal ground. Price is located in deep premium (${
      h4Range?.coveragePct ?? 90
    }% of H4 range) near external liquidity. Long entries are blocked due to range exhaustion and high probability of rotation.`;
  } else if (verdict === "EXHAUSTED_BEARISH") {
    narrative = `Bearish movement is currently covering terminal ground. Price is located in deep discount (${
      h4Range?.coveragePct ?? 10
    }% of H4 range) near key sell-side stops. Short entries are blocked due to range exhaustion and high probability of bounce.`;
  } else if (verdict === "BULLISH_REVERSAL_CONFIRMED") {
    narrative = `Institutional liquidity raid completed. Sell-side liquidity (${
      freshHtfSweep?.name ?? "SSL"
    }) was purged, and price has reclaimed value with 4H support holding. `;
    if (m15VetoActive) {
      narrative += `[15M VETO ACTIVE]: ${m15VetoReason}`;
    } else {
      narrative += `15M Gatekeeper confirmed immediate lower-timeframe reclamation.`;
    }
  } else if (verdict === "BEARISH_REVERSAL_CONFIRMED") {
    narrative = `Institutional liquidity raid completed. Buy-side liquidity (${
      freshHtfSweep?.name ?? "BSL"
    }) was purged, and price has rejected value with 4H resistance holding. `;
    if (m15VetoActive) {
      narrative += `[15M VETO ACTIVE]: ${m15VetoReason}`;
    } else {
      narrative += `15M Gatekeeper confirmed immediate lower-timeframe rejection.`;
    }
  } else {
    narrative = `Market is currently consolidating within the dealing range equilibrium (${
      h4Range?.coveragePct ?? 50
    }% of H4 range). Order flow does not show high-conviction institutional defense. Stand aside and wait for liquidity raid or clean breakout.`;
  }

  return {
    verdict,
    narrative,
    action,
    conviction,
    allowedToLong,
    allowedToShort,
    invalidationPrice,
    targetDOL: dol,
    catalysts,
    blockReasons,
    conflicts,
    warning,
    h4CoveragePct: h4Range?.coveragePct ?? null,
    m15CoveragePct: m15Range?.coveragePct ?? null,
    h4Zone: h4Range?.zone ?? null,
    m15Zone: m15Range?.zone ?? null,
    fvgOrderFlow,
    activeCycle: htfLiq?.activeCycle ?? "UNKNOWN",
    // Day Trader Multi-Timeframe Matrix
    dayTraderContext: {
      macroCompass,
      macroRationale,
      sessionRoadmap: {
        h1Zone: h1Range?.zone || null,
        h1CoveragePct: h1Range?.coveragePct ?? null,
        h1Status: h1Range?.status || "NORMAL",
        h1StructureDir: structures.H1?.dir || 0,
      },
      ltfGatekeeper: {
        m15Zone: m15Zone || null,
        m15CoveragePct: m15Coverage,
        m15StructureDir: m15Dir,
        vetoActive: m15VetoActive,
        vetoReason: m15VetoReason,
        triggerStatus: m15TriggerStatus,
      },
    },
  };
}
