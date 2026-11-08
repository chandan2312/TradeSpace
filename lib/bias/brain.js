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
  retracements = {},
  intraday = {},
  score = 0,
  extras = {},
  stability = null,
  agreement = null,
  activeTimeSlot = null,
}) {
  const m15Retrace = retracements?.evaluations?.M15 || retracements?.m15;
  const h1Retrace = retracements?.evaluations?.H1 || retracements?.h1;
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
  const hasRespectedBearIfvg = htfFvg?.respectedIfvgs?.some((g) => g.dir === -1 || g.role === "INVERTED_RESISTANCE" || g.effectiveDir === -1);
  const hasRespectedBullIfvg = htfFvg?.respectedIfvgs?.some((g) => g.dir === 1 || g.role === "INVERTED_SUPPORT" || g.effectiveDir === 1);
  if (hasRespectedBearIfvg) {
    catalysts.push("4H Inverted Resistance (iFVG) tested and respected (bearish defense)");
  }
  if (hasRespectedBullIfvg) {
    catalysts.push("4H Inverted Support (iFVG) tested and respected (bullish defense)");
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

  // 1. Respected 4H Order Flow & HTF Structural Trend have primary institutional authority
  if (hasRespectedBullFVG || fvgOrderFlow === "STRONG_BULLISH_ORDER_FLOW" || (structures.H4?.dir === 1 && structures.D1?.dir === 1)) {
    macroCompass = "BULLISH";
    macroRationale = "4H institutional bullish order flow actively defended.";
  } else if (hasRespectedBearFVG || fvgOrderFlow === "STRONG_BEARISH_ORDER_FLOW" || (structures.H4?.dir === -1 && structures.D1?.dir === -1)) {
    macroCompass = "BEARISH";
    macroRationale = "4H institutional bearish order flow actively defended.";
  } else if (freshHtfSweep && freshHtfSweep.side === -1 && !fvgOrderFlow.includes("BEARISH")) {
    macroCompass = "BULLISH";
    macroRationale = `Institutional SSL purge (${freshHtfSweep.name}). Reversal seeking buy-side liquidity.`;
  } else if (freshHtfSweep && freshHtfSweep.side === 1 && !fvgOrderFlow.includes("BULLISH")) {
    macroCompass = "BEARISH";
    macroRationale = `Institutional BSL purge (${freshHtfSweep.name}). Reversal seeking sell-side liquidity.`;
  } else if (structures.H4?.dir === 1 || structures.D1?.dir === 1) {
    macroCompass = "BULLISH";
    macroRationale = "Higher timeframe structural trend is bullish (HH+HL).";
  } else if (structures.H4?.dir === -1 || structures.D1?.dir === -1) {
    macroCompass = "BEARISH";
    macroRationale = "Higher timeframe structural trend is bearish (LH+LL).";
  } else if (score > 20) {
    macroCompass = "BULLISH";
    macroRationale = "Multi-lens ensemble leaning bullish in neutral HTF context.";
  } else if (score < -20) {
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
    if (m15Retrace) {
      if (m15Retrace.isOriginBreached) {
        m15VetoActive = true;
        m15VetoReason = `15M impulse leg origin breached (${m15Retrace.depthPct}%). Structural failure.`;
        m15TriggerStatus = "BLOCKED";
      } else if (m15Retrace.isFreightTrain || m15Retrace.adverseVelocity) {
        m15VetoActive = true;
        m15VetoReason = `15M adverse freight train velocity detected (${m15Retrace.velocityRatio || 1.6}x impulse speed). Awaiting structural deceleration or MSS.`;
        m15TriggerStatus = "WAIT_SHIFT";
      } else if (m15Retrace.inOtePocket) {
        m15VetoActive = false;
        m15TriggerStatus = "APPROVED";
        catalysts.push(`15M in OTE Golden Pocket (${m15Retrace.depthPct}%) with ${m15Retrace.isCorrective ? "A+ corrective compression" : "orderly flow"}`);
      } else if (m15Retrace.stage === "EQUILIBRIUM_DISCOUNT") {
        m15VetoActive = false;
        m15TriggerStatus = "APPROVED";
        catalysts.push(`15M in discount equilibrium (${m15Retrace.depthPct}%)`);
      } else if (m15Retrace.stage === "SHALLOW_CHASING" || m15Retrace.stage === "AWAITING_PULLBACK" || intraday?.setup?.state === "WAIT_FOR_15M_PULLBACK" || intraday?.setup?.state === "WAIT_FOR_M15_PULLBACK") {
        m15VetoActive = true;
        m15VetoReason = `15M retracement is shallow (${m15Retrace.depthPct ?? 15}%). Premature chasing before institutional discount; awaiting deeper pullback.`;
        m15TriggerStatus = "WAIT_PULLBACK";
      } else if (m15Retrace.stage === "AWAITING_SHIFT" || intraday?.setup?.state === "WAIT_FOR_15M_TRIGGER" || intraday?.setup?.state === "WAIT_FOR_M15_TRIGGER") {
        m15VetoActive = true;
        m15VetoReason = `15M in active retracement leg. Awaiting 15M structure shift (MSS/CHoCH) to confirm entry trigger.`;
        m15TriggerStatus = "WAIT_SHIFT";
      } else if (m15Retrace.stage === "DEEP_ORIGIN_TEST") {
        if (m15Retrace.isCorrective) {
          m15VetoActive = false;
          m15TriggerStatus = "APPROVED";
          catalysts.push(`15M deep corrective test of swing origin (${m15Retrace.depthPct}%)`);
        } else {
          m15VetoActive = true;
          m15VetoReason = `15M deep test (${m15Retrace.depthPct}%) with non-corrective velocity. Demands confirmed LTF structure shift.`;
          m15TriggerStatus = "WAIT_SHIFT";
        }
      }
    } else if (m15Coverage != null && (m15Coverage > 65 || m15Range?.status === "EXHAUSTED_HIGH")) {
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
    if (m15Retrace) {
      if (m15Retrace.isOriginBreached) {
        m15VetoActive = true;
        m15VetoReason = `15M impulse leg origin breached (${m15Retrace.depthPct}%). Structural failure.`;
        m15TriggerStatus = "BLOCKED";
      } else if (m15Retrace.isFreightTrain || m15Retrace.adverseVelocity) {
        m15VetoActive = true;
        m15VetoReason = `15M adverse freight train velocity detected (${m15Retrace.velocityRatio || 1.6}x impulse speed). Awaiting structural deceleration or MSS.`;
        m15TriggerStatus = "WAIT_SHIFT";
      } else if (m15Retrace.inOtePocket) {
        m15VetoActive = false;
        m15TriggerStatus = "APPROVED";
        catalysts.push(`15M in OTE Golden Pocket (${m15Retrace.depthPct}%) with ${m15Retrace.isCorrective ? "A+ corrective compression" : "orderly flow"}`);
      } else if (m15Retrace.stage === "EQUILIBRIUM_DISCOUNT") {
        m15VetoActive = false;
        m15TriggerStatus = "APPROVED";
        catalysts.push(`15M in premium equilibrium (${m15Retrace.depthPct}%)`);
      } else if (m15Retrace.stage === "SHALLOW_CHASING" || m15Retrace.stage === "AWAITING_PULLBACK" || intraday?.setup?.state === "WAIT_FOR_15M_PULLBACK" || intraday?.setup?.state === "WAIT_FOR_M15_PULLBACK") {
        m15VetoActive = true;
        m15VetoReason = `15M retracement is shallow (${m15Retrace.depthPct ?? 15}%). Premature chasing before institutional premium; awaiting deeper pullback.`;
        m15TriggerStatus = "WAIT_PULLBACK";
      } else if (m15Retrace.stage === "AWAITING_SHIFT" || intraday?.setup?.state === "WAIT_FOR_15M_TRIGGER" || intraday?.setup?.state === "WAIT_FOR_M15_TRIGGER") {
        m15VetoActive = true;
        m15VetoReason = `15M in active retracement leg. Awaiting 15M structure shift (MSS/CHoCH) to confirm entry trigger.`;
        m15TriggerStatus = "WAIT_SHIFT";
      } else if (m15Retrace.stage === "DEEP_ORIGIN_TEST") {
        if (m15Retrace.isCorrective) {
          m15VetoActive = false;
          m15TriggerStatus = "APPROVED";
          catalysts.push(`15M deep corrective test of swing origin (${m15Retrace.depthPct}%)`);
        } else {
          m15VetoActive = true;
          m15VetoReason = `15M deep test (${m15Retrace.depthPct}%) with non-corrective velocity. Demands confirmed LTF structure shift.`;
          m15TriggerStatus = "WAIT_SHIFT";
        }
      }
    } else if (m15Coverage != null && (m15Coverage < 35 || m15Range?.status === "EXHAUSTED_LOW")) {
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

  // Intraday setup state overrides/reinforces gatekeeper status
  if (intraday?.setup?.state === "WAIT_FOR_15M_PULLBACK" || intraday?.setup?.state === "WAIT_FOR_M15_PULLBACK") {
    m15VetoActive = true;
    m15VetoReason = m15VetoReason || "Awaiting 15M institutional pullback into discount/premium.";
    m15TriggerStatus = "WAIT_PULLBACK";
  } else if (intraday?.setup?.state === "WAIT_FOR_15M_TRIGGER" || intraday?.setup?.state === "WAIT_FOR_M15_TRIGGER") {
    m15VetoActive = true;
    m15VetoReason = m15VetoReason || "Awaiting 15M structure shift (MSS) to confirm entry trigger.";
    m15TriggerStatus = "WAIT_SHIFT";
  }

  // --------------------------------------------------------------------------
  // 4B. SWING (1D-1H) & SCALP (30M-5M) GATEKEEPERS
  // --------------------------------------------------------------------------
  const d1Dir = structures.D1?.dir ?? 0;
  const h1Dir = structures.H1?.dir ?? 0;
  const h1Coverage = h1Range?.coveragePct ?? null;
  const h1Zone = h1Range?.zone || null;

  let h1VetoActive = false;
  let h1VetoReason = null;
  let h1TriggerStatus = "NEUTRAL";

  if (d1Dir === 1 || (d1Dir === 0 && macroCompass === "BULLISH")) {
    if (h1Retrace) {
      if (h1Retrace.isOriginBreached) {
        h1VetoActive = true;
        h1VetoReason = `1H impulse origin breached (${h1Retrace.depthPct}%). Swing structure inverted.`;
        h1TriggerStatus = "BLOCKED";
      } else if (h1Retrace.isFreightTrain) {
        h1VetoActive = true;
        h1VetoReason = `1H adverse freight train plunge (${h1Retrace.velocityRatio}x). Awaiting swing stabilization.`;
        h1TriggerStatus = "WAIT_SHIFT";
      } else if (h1Retrace.inOtePocket || h1Retrace.stage === "EQUILIBRIUM_DISCOUNT") {
        h1VetoActive = false;
        h1TriggerStatus = "APPROVED";
      } else if (h1Retrace.stage === "SHALLOW_CHASING") {
        h1VetoActive = true;
        h1VetoReason = `1H retracement is shallow (${h1Retrace.depthPct}%). Swing traders awaiting deeper discount.`;
        h1TriggerStatus = "WAIT_PULLBACK";
      }
    } else if (h1Coverage != null && (h1Coverage > 65 || h1Range?.status === "EXHAUSTED_HIGH")) {
      h1VetoActive = true;
      h1VetoReason = `1H is overextended in ${h1Zone} (${h1Coverage}%). Swing traders must wait for 1H pullback into Discount (<50%).`;
      h1TriggerStatus = "WAIT_PULLBACK";
    } else if (h1Dir === -1) {
      h1VetoActive = true;
      h1VetoReason = `1H reached ${h1Zone} (${h1Coverage}%) but is in active downward retracement leg. Awaiting 1H structure shift (MSS/CHoCH).`;
      h1TriggerStatus = "WAIT_SHIFT";
    } else {
      h1VetoActive = false;
      h1TriggerStatus = "APPROVED";
    }
  } else if (d1Dir === -1 || (d1Dir === 0 && macroCompass === "BEARISH")) {
    if (h1Retrace) {
      if (h1Retrace.isOriginBreached) {
        h1VetoActive = true;
        h1VetoReason = `1H impulse origin breached (${h1Retrace.depthPct}%). Swing structure inverted.`;
        h1TriggerStatus = "BLOCKED";
      } else if (h1Retrace.isFreightTrain) {
        h1VetoActive = true;
        h1VetoReason = `1H adverse freight train plunge (${h1Retrace.velocityRatio}x). Awaiting swing stabilization.`;
        h1TriggerStatus = "WAIT_SHIFT";
      } else if (h1Retrace.inOtePocket || h1Retrace.stage === "EQUILIBRIUM_DISCOUNT") {
        h1VetoActive = false;
        h1TriggerStatus = "APPROVED";
      } else if (h1Retrace.stage === "SHALLOW_CHASING") {
        h1VetoActive = true;
        h1VetoReason = `1H retracement is shallow (${h1Retrace.depthPct}%). Swing traders awaiting deeper premium.`;
        h1TriggerStatus = "WAIT_PULLBACK";
      }
    } else if (h1Coverage != null && (h1Coverage < 35 || h1Range?.status === "EXHAUSTED_LOW")) {
      h1VetoActive = true;
      h1VetoReason = `1H is overextended in ${h1Zone} (${h1Coverage}%). Swing traders must wait for 1H pullback into Premium (>50%).`;
      h1TriggerStatus = "WAIT_PULLBACK";
    } else if (h1Dir === 1) {
      h1VetoActive = true;
      h1VetoReason = `1H reached ${h1Zone} (${h1Coverage}%) but is in active upward retracement leg. Awaiting 1H structure shift (MSS/CHoCH).`;
      h1TriggerStatus = "WAIT_SHIFT";
    } else {
      h1VetoActive = false;
      h1TriggerStatus = "APPROVED";
    }
  }

  // Scalp Gatekeeper (30M/15M Compass -> 5M Trigger)
  const m30Dir = structures.M30?.dir ?? m15Dir;
  const m30Range = ranges?.ranges?.M30 || m15Range;
  const m30Coverage = m30Range?.coveragePct ?? m15Coverage;
  const m30Zone = m30Range?.zone || m15Zone;
  const m5Dir = structures.M5?.dir ?? 0;
  let m5VetoActive = false;
  let m5VetoReason = null;
  let m5TriggerStatus = "NEUTRAL";

  if (m30Dir === 1 || setupDir === 1) {
    if (m30Coverage != null && (m30Coverage > 70 || m30Range?.status === "EXHAUSTED_HIGH")) {
      m5VetoActive = true;
      m5VetoReason = `30M is overextended in ${m30Zone} (${m30Coverage}%). Scalpers must wait for 30M/15M pullback.`;
      m5TriggerStatus = "WAIT_PULLBACK";
    } else if (m5Dir === -1) {
      m5VetoActive = true;
      m5VetoReason = "5M is in active counter-trend leg. Awaiting 5M displacement shift.";
      m5TriggerStatus = "WAIT_SHIFT";
    } else {
      m5VetoActive = false;
      m5TriggerStatus = "APPROVED";
    }
  } else if (m30Dir === -1 || setupDir === -1) {
    if (m30Coverage != null && (m30Coverage < 30 || m30Range?.status === "EXHAUSTED_LOW")) {
      m5VetoActive = true;
      m5VetoReason = `30M is overextended in ${m30Zone} (${m30Coverage}%). Scalpers must wait for 30M/15M pullback.`;
      m5TriggerStatus = "WAIT_PULLBACK";
    } else if (m5Dir === 1) {
      m5VetoActive = true;
      m5VetoReason = "5M is in active counter-trend leg. Awaiting 5M displacement shift.";
      m5TriggerStatus = "WAIT_SHIFT";
    } else {
      m5VetoActive = false;
      m5TriggerStatus = "APPROVED";
    }
  }

  // --------------------------------------------------------------------------
  // 5. Dynamic Cognitive Synthesis (The Brain's Core State Machine)
  // --------------------------------------------------------------------------

  // SCENARIO 1: Bullish Reversal from HTF Liquidity Sweep
  if (
    freshHtfSweep &&
    freshHtfSweep.side === -1 &&
    fvgOrderFlow !== "STRONG_BEARISH_ORDER_FLOW" &&
    !(structures.H4?.dir === -1 && structures.D1?.dir === -1) &&
    (hasRespectedBullFVG || setupDir === 1 || m15Dir === 1)
  ) {
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
  else if (
    freshHtfSweep &&
    freshHtfSweep.side === 1 &&
    fvgOrderFlow !== "STRONG_BULLISH_ORDER_FLOW" &&
    !(structures.H4?.dir === 1 && structures.D1?.dir === 1) &&
    (hasRespectedBearFVG || setupDir === -1 || m15Dir === -1)
  ) {
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
    (hasRespectedBullFVG || hasViolatedBearFVG || fvgOrderFlow === "STRONG_BULLISH_ORDER_FLOW" || (structures.H4?.dir === 1 && score > 10)) &&
    (!h4Range || h4Range.coveragePct < 82) &&
    score > 10
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
    (hasRespectedBearFVG || hasViolatedBullFVG || fvgOrderFlow === "STRONG_BEARISH_ORDER_FLOW" || (structures.H4?.dir === -1 && score < -10)) &&
    (!h4Range || h4Range.coveragePct > 18) &&
    score < -10
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
  else if (score > 10 && (isH4DeepPremium || (isM15ExhaustedHigh && (!h4Range || h4Range.coveragePct >= 85)))) {
    verdict = "EXHAUSTED_BULLISH";
    action = "STAND_ASIDE";
    allowedToLong = false;
    conviction = 65;
    conflicts.push("Bullish momentum present but range coverage is >= 85% exhausted into resistance");
    blockReasons.push("Range exhausted at range ceiling");
  }
  // SCENARIO 6: Exhausted Bearish (Seller Trap)
  else if (score < -10 && (isH4DeepDiscount || (isM15ExhaustedLow && (!h4Range || h4Range.coveragePct <= 15)))) {
    verdict = "EXHAUSTED_BEARISH";
    action = "STAND_ASIDE";
    allowedToShort = false;
    conviction = 65;
    conflicts.push("Bearish momentum present but range coverage is <= 15% exhausted into support");
    blockReasons.push("Range exhausted at range floor");
  }
  // SCENARIO 7: Pullback into Discount in Uptrend
  else if ((structures.H4?.dir === 1 || structures.D1?.dir === 1) && (h4Range?.zone === "DISCOUNT" || (h4Range && h4Range.coveragePct <= 50))) {
    verdict = "BULLISH_PULLBACK_DEFENDED";
    conviction = 80;
    const support = htfFvg?.nearestSupportFVG;
    invalidationPrice = support ? support.bottom : h4Range ? h4Range.low : null;

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
  else if ((structures.H4?.dir === -1 || structures.D1?.dir === -1) && (h4Range?.zone === "PREMIUM" || (h4Range && h4Range.coveragePct >= 50))) {
    verdict = "BEARISH_PULLBACK_DEFENDED";
    conviction = 80;
    const res = htfFvg?.nearestResistanceFVG;
    invalidationPrice = res ? res.top : h4Range ? h4Range.high : null;

    if (m15VetoActive) {
      allowedToShort = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToShort = true;
      action = "READY_FOR_SHORT";
    }
  }
  // SCENARIO 9: Equilibrium Consolidation in Directional Trend
  else if ((structures.H4?.dir === 1 || structures.D1?.dir === 1 || score > 15) && (!h4Range || h4Range.coveragePct < 80)) {
    verdict = "BULLISH_EQUILIBRIUM_ACCUMULATION";
    conviction = 75;
    invalidationPrice = h4Range ? h4Range.low : null;
    catalysts.push("Market holding equilibrium in established higher-timeframe bullish trend");

    if (m15VetoActive) {
      allowedToLong = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToLong = true;
      action = "READY_FOR_LONG";
    }
  }
  else if ((structures.H4?.dir === -1 || structures.D1?.dir === -1 || score < -15) && (!h4Range || h4Range.coveragePct > 20)) {
    verdict = "BEARISH_EQUILIBRIUM_DISTRIBUTION";
    conviction = 75;
    invalidationPrice = h4Range ? h4Range.high : null;
    catalysts.push("Market holding equilibrium in established higher-timeframe bearish trend");

    if (m15VetoActive) {
      allowedToShort = false;
      action = m15TriggerStatus === "WAIT_PULLBACK" ? "WAIT_FOR_15M_PULLBACK" : "WAIT_FOR_15M_TRIGGER";
      blockReasons.push(m15VetoReason);
    } else {
      allowedToShort = true;
      action = "READY_FOR_SHORT";
    }
  }
  // SCENARIO 10: Pure Neutral Chop (No Trend & Neutral Score)
  else {
    verdict = "RANGE_EQUILIBRIUM_CHOP";
    action = "STAND_ASIDE";
    conviction = 40;
    conflicts.push("Price hovering in Equilibrium without clear institutional order flow defense or directional trend");
  }

  // --------------------------------------------------------------------------
  // 5B. Dynamic Brain Conviction Calibration (DBCC) & Breakdown Engine
  // --------------------------------------------------------------------------
  // Calibrates institutional conviction symmetrically:
  // - Rewards multi-pillar confluences (Retracement quality, SMT, FVG, stability, consensus)
  // - Deducts for lower-timeframe conflicts, adverse freight train velocity, low agreement, and deep range saturation.
  const baseConviction = conviction;
  const baseScenario = verdict;
  const bonuses = [];
  const deductions = [];

  if (verdict !== "RANGE_EQUILIBRIUM_CHOP" && !verdict.startsWith("EXHAUSTED")) {
    // 1. Lower-Timeframe Gatekeeper Alignment:
    // If lower timeframe has not confirmed trigger or is waiting for pullback, apply realistic confirmation discount.
    if (m15VetoActive || intraday?.setup?.state?.includes("WAIT_FOR_15M") || intraday?.setup?.state?.includes("WAIT_FOR_M15")) {
      const isPullback = m15TriggerStatus === "WAIT_PULLBACK" ||
        intraday?.setup?.state === "WAIT_FOR_15M_PULLBACK" ||
        intraday?.setup?.state === "WAIT_FOR_M15_PULLBACK" ||
        m15Retrace?.stage === "AWAITING_PULLBACK" ||
        m15Retrace?.stage === "SHALLOW_CHASING";
      const isShift = m15TriggerStatus === "WAIT_SHIFT" ||
        intraday?.setup?.state === "WAIT_FOR_15M_TRIGGER" ||
        intraday?.setup?.state === "WAIT_FOR_M15_TRIGGER" ||
        m15Retrace?.stage === "AWAITING_SHIFT";

      if (isPullback) {
        deductions.push({
          key: "m15GatekeeperPendingPullback",
          label: "15M Gatekeeper Pending Pullback",
          pts: -10,
        });
      } else if (isShift) {
        deductions.push({
          key: "m15GatekeeperAwaitingShift",
          label: "15M Gatekeeper Awaiting Structure Shift",
          pts: -8,
        });
      } else {
        deductions.push({
          key: "m15GatekeeperVeto",
          label: "15M Lower-Timeframe Veto Active",
          pts: -8,
        });
      }
    }

    // 2. Retracement Quality & Adverse Velocity:
    if (m15Retrace?.isFreightTrain || m15Retrace?.adverseVelocity || (m15Retrace?.qualityGrade || m15Retrace?.grade) === "F") {
      deductions.push({
        key: "adverseVelocityFreightTrain",
        label: "Adverse Velocity / Freight Train Against Bias",
        pts: -8,
      });
    }
    if ((m15Retrace?.qualityGrade || m15Retrace?.grade) === "D" || (typeof m15Retrace?.qualityScore === "number" && m15Retrace.qualityScore < 40)) {
      deductions.push({
        key: "poorRetracementQuality",
        label: "Subpar Retracement Quality (Grade D)",
        pts: -4,
      });
    } else if (m15Retrace?.qualityGrade === "A+") {
      bonuses.push({
        key: "retraceQualityAPlus",
        label: "Pristine Retracement Quality (A+)",
        pts: 5,
      });
    } else if (m15Retrace?.qualityGrade === "A") {
      bonuses.push({
        key: "retraceQualityA",
        label: "Solid Retracement Quality (A)",
        pts: 3,
      });
    } else if (m15Retrace?.stage === "EQUILIBRIUM_DISCOUNT") {
      bonuses.push({
        key: "retraceEquilibriumDiscount",
        label: "Equilibrium Discount Retracement",
        pts: 1,
      });
    }

    // 3. Dual-Timeframe OTE Nesting Bonus (+3)
    if (retracements?.compositeGrade === "A+") {
      bonuses.push({
        key: "dualOteNesting",
        label: "Dual-Timeframe OTE Nesting Alignment",
        pts: 3,
      });
    }

    // 4. SMT Divergence Alignment (+3)
    if (htfLiq?.smtDivergence || intraday?.setup?.smt) {
      bonuses.push({
        key: "smtDivergence",
        label: "HTF SMT Divergence Confirmation",
        pts: 3,
      });
    }
  }

  // 5. Multi-Lens Consensus & Agreement (Bidirectional across all scenarios):
  if (typeof agreement === "number") {
    if (agreement >= 80) {
      bonuses.push({
        key: "highLensAgreement",
        label: `High Multi-Lens Consensus (${Math.round(agreement)}%)`,
        pts: 3,
      });
    } else if (agreement < 45) {
      deductions.push({
        key: "severeLensConflict",
        label: `Severe Multi-Lens Conflict (${Math.round(agreement)}%)`,
        pts: -8,
      });
    } else if (agreement < 55) {
      deductions.push({
        key: "lowLensConsensus",
        label: `Low Multi-Lens Consensus (${Math.round(agreement)}%)`,
        pts: -6,
      });
    } else if (agreement < 65) {
      deductions.push({
        key: "mixedLensAgreement",
        label: `Mixed Multi-Lens Agreement (${Math.round(agreement)}%)`,
        pts: -3,
      });
    }
  }

  // 6. Multi-Lens Stability (Bidirectional across all scenarios):
  if (typeof stability === "number") {
    if (stability >= 80) {
      bonuses.push({
        key: "highStability",
        label: `Resilient Multi-Frame Stability (${Math.round(stability)}%)`,
        pts: 2,
      });
    } else if (stability < 40) {
      deductions.push({
        key: "unstableOrderFlow",
        label: `Unstable Multi-Frame Order Flow (${Math.round(stability)}%)`,
        pts: -6,
      });
    } else if (stability < 50) {
      deductions.push({
        key: "degradedStability",
        label: `Degraded Multi-Frame Stability (${Math.round(stability)}%)`,
        pts: -4,
      });
    }
  }

  // 7. Dealing Range Saturation Penalty (runway exhausted into obstacle):
  if (h4Range && typeof h4Range.coveragePct === "number") {
    if (h4Range.coveragePct >= 80) {
      deductions.push({
        key: "severeRangeSaturation",
        label: `Severe Range Saturation (${Math.round(h4Range.coveragePct)}% into extreme)`,
        pts: -6,
      });
    } else if (h4Range.coveragePct > 70) {
      deductions.push({
        key: "rangeSaturation",
        label: `Dealing Range Saturation (${Math.round(h4Range.coveragePct)}% covered)`,
        pts: -4,
      });
    }
  }

  // 8. Dead Zone Off-Peak Timing Lull (Universal timing penalty):
  const timeSlot = activeTimeSlot || extras?.activeTimeSlot;
  if (timeSlot?.isDeadZone) {
    deductions.push({
      key: "timingDeadZone",
      label: "Dead Zone Off-Peak Timing Lull",
      pts: -8,
    });
  }

  const positiveMod = bonuses.reduce((acc, b) => acc + b.pts, 0);
  const negativeMod = deductions.reduce((acc, d) => acc + d.pts, 0);
  const netConviction = Math.min(95, Math.max(35, Math.round(baseConviction + positiveMod + negativeMod)));
  conviction = netConviction;

  // Identify the single most significant negative drag factor for quick queries and telemetry
  const sortedDeductions = [...deductions].sort((a, b) => a.pts - b.pts);
  const primaryDrag = sortedDeductions[0] || null;

  const convictionBreakdown = {
    baseConviction,
    baseScenario,
    bonuses,
    deductions,
    positiveMod,
    negativeMod,
    netConviction,
    primaryDrag,
  };

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
  } else if (verdict === "BULLISH_EQUILIBRIUM_ACCUMULATION") {
    narrative = `Market is holding equilibrium accumulation in an established higher-timeframe bullish trend (${
      h4Range?.coveragePct ?? 50
    }% of H4 range). Order flow supports re-accumulation into overhead targets.`;
  } else if (verdict === "BEARISH_EQUILIBRIUM_DISTRIBUTION") {
    narrative = `Market is holding equilibrium distribution in an established higher-timeframe bearish trend (${
      h4Range?.coveragePct ?? 50
    }% of H4 range). Order flow supports distribution into discount targets.`;
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
    convictionBreakdown,
    primaryDrag,
    macroCompass,
    macroRationale,
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
    htfFvg: htfFvg || null,
    activeCycle: htfLiq?.activeCycle ?? "UNKNOWN",
    retracement: {
      compositeGrade: retracements?.compositeGrade || "N/A",
      compositeScore: retracements?.compositeScore || 0,
      m15: m15Retrace ? {
        stage: m15Retrace.stage,
        depthPct: m15Retrace.depthPct,
        grade: m15Retrace.qualityGrade,
        qualityGrade: m15Retrace.qualityGrade,
        isCorrective: m15Retrace.isCorrective,
        isFreightTrain: m15Retrace.isFreightTrain,
        inOtePocket: m15Retrace.inOtePocket,
        fibLevels: m15Retrace.fibLevels,
      } : null,
      h1: h1Retrace ? {
        stage: h1Retrace.stage,
        depthPct: h1Retrace.depthPct,
        grade: h1Retrace.qualityGrade,
        qualityGrade: h1Retrace.qualityGrade,
        isCorrective: h1Retrace.isCorrective,
        isFreightTrain: h1Retrace.isFreightTrain,
        inOtePocket: h1Retrace.inOtePocket,
        fibLevels: h1Retrace.fibLevels,
      } : null,
    },
    // 3 Official Horizons Matrix: Swing (1D-1H), Day (4H-15M), Scalp (30M-5M)
    horizons: {
      SWING: {
        horizon: "SWING",
        timeframeCombo: "1D-1H",
        macroCompass: d1Dir === 1 ? "BULLISH" : d1Dir === -1 ? "BEARISH" : macroCompass,
        compassTf: "1D",
        roadmapTf: "4H",
        gatekeeperTf: "1H",
        roadmap: {
          h4Zone: h4Range?.zone || null,
          h4CoveragePct: h4Range?.coveragePct ?? null,
          h4Status: h4Range?.status || "NORMAL",
          h4StructureDir: structures.H4?.dir ?? 0,
          fvgOrderFlow,
        },
        gatekeeper: {
          h1Zone,
          h1CoveragePct: h1Coverage,
          h1StructureDir: h1Dir,
          vetoActive: h1VetoActive,
          vetoReason: h1VetoReason,
          triggerStatus: h1TriggerStatus,
        },
      },
      DAY: {
        horizon: "DAY",
        timeframeCombo: "4H-15M",
        macroCompass,
        macroRationale,
        compassTf: "4H",
        roadmapTf: "1H",
        gatekeeperTf: "15M",
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
        gatekeeper: {
          m15Zone: m15Zone || null,
          m15CoveragePct: m15Coverage,
          m15StructureDir: m15Dir,
          vetoActive: m15VetoActive,
          vetoReason: m15VetoReason,
          triggerStatus: m15TriggerStatus,
        },
      },
      SCALP: {
        horizon: "SCALP",
        timeframeCombo: "30M-5M",
        macroCompass: m30Dir === 1 ? "BULLISH" : m30Dir === -1 ? "BEARISH" : "NEUTRAL",
        compassTf: "30M",
        roadmapTf: "15M",
        gatekeeperTf: "5M",
        roadmap: {
          m15StructureDir: m15Dir,
          m15Range: ranges?.ranges?.M15 || m15Range || null,
        },
        gatekeeper: {
          m5StructureDir: m5Dir,
          vetoActive: m5VetoActive,
          vetoReason: m5VetoReason,
          triggerStatus: m5TriggerStatus,
        },
      },
    },
    // Day Trader Multi-Timeframe Matrix (Maintained for backward compatibility)
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
