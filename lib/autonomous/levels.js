// Dynamic Institutional Level Detector & Confluence Scoring Engine
import { avgRange, findPivots } from "../patterns/core.js";
import { evaluateAllEntryModels, symbolUnits, getFrameBars } from "./models.js";
import { getCurrentTimeSlot, getSilverBulletWindow } from "./timeslots.js";
import { detectLiquidityRaids } from "../bias/institutional.js";
import { evaluateEntryModelDecisionEngine } from "./entryDecisionEngine.js";
import { calculateStructuralStopLoss } from "./slEngine.js";
import { resolveCascadingDefaultTarget } from "./tpCascadingEngine.js";

export function selectOptimalEntryLevel({
  symbol,
  dir,
  scenario,
  frames = {},
  ranges,
  htfFvg,
  targetDOL,
  config = {},
  brain = {},
}) {
  // 1. Try resolving via the 5 Dynamic Institutional Entry Models
  const modelResult = evaluateAllEntryModels({
    symbol,
    dir,
    scenario,
    frames,
    ranges,
    htfFvg,
    targetDOL,
    config,
    brain,
  });

  const units = symbolUnits(symbol, { ...config, symbolMeta: frames?.symbolMeta || config?.symbolMeta });

  if (modelResult) {
    const risk = Math.abs(modelResult.entry - modelResult.sl);
    return {
      ...modelResult,
      riskPips: units.pip > 0 ? Math.abs(modelResult.entry - modelResult.sl) / units.pip : null,
      riskDistance: risk,
      targetDOL,
      dealingRange: brain?.dealingRange || (
        scenario?.id === "swing" ? (ranges?.D1 || ranges?.H4) :
        scenario?.id === "scalp" ? (ranges?.M30 || ranges?.["30M"] || ranges?.M15 || ranges?.M5) :
        (ranges?.H4 || ranges?.H1)
      ),
      thesisId: brain?.thesisId || brain?.verdict || "HTF_STRUCTURE",
      ideaId: `${brain?.thesisId || "thesis"}:${modelResult.modelId}:${modelResult.tf}:${modelResult.entry}`,
    };
  }

  // 2. Discover Institutional Reaction Levels (FVG CE, Order Block, OTE Sweetspot, Turtle Soup, Silver Bullet)
  const sId = String(scenario?.id || "").toLowerCase();
  const setupBars = sId === "swing"
    ? (getFrameBars(frames, "H4").length ? getFrameBars(frames, "H4") : (getFrameBars(frames, "H1").length ? getFrameBars(frames, "H1") : getFrameBars(frames, "D1")))
    : sId === "scalp"
    ? (getFrameBars(frames, "M5").length ? getFrameBars(frames, "M5") : (getFrameBars(frames, "M15").length ? getFrameBars(frames, "M15") : getFrameBars(frames, "M30")))
    : (getFrameBars(frames, "M15").length ? getFrameBars(frames, "M15") : (getFrameBars(frames, "H1").length ? getFrameBars(frames, "H1") : getFrameBars(frames, "M5")));
  if (!setupBars || setupBars.length < 15) return null;

  const currentPrice = setupBars[setupBars.length - 1].close;
  const avg = avgRange(setupBars);
  const minRR = config.minRR || scenario?.minRR || 1.8;
  const sbWindow = getSilverBulletWindow(new Date(config.now ?? Date.now()));

  const dealingRange = brain?.dealingRange || (
    sId === "swing" ? (ranges?.D1 || ranges?.H4) :
    sId === "scalp" ? (ranges?.M30 || ranges?.["30M"] || ranges?.M15 || ranges?.M5) :
    (ranges?.H4 || ranges?.H1)
  );
  const eq = dealingRange?.eq || (dealingRange?.high && dealingRange?.low ? (dealingRange.high + dealingRange.low) / 2 : null);
  const dSpan = (dealingRange && Number.isFinite(dealingRange.high) && Number.isFinite(dealingRange.low))
    ? Math.abs(dealingRange.high - dealingRange.low)
    : 0;

  const candidateLevels = [];

  // Premier Candidate: Dedicated Horizon Dealing Range OTE Sweetspot (70.5%)
  if (dSpan > 0) {
    const ote705 = dir === 1 ? dealingRange.high - dSpan * 0.705 : dealingRange.low + dSpan * 0.705;
    const ote62 = dir === 1 ? dealingRange.high - dSpan * 0.62 : dealingRange.low + dSpan * 0.62;
    const ote79 = dir === 1 ? dealingRange.high - dSpan * 0.79 : dealingRange.low + dSpan * 0.79;
    const zHigh = Number(Math.max(ote62, ote79).toFixed(5));
    const zLow = Number(Math.min(ote62, ote79).toFixed(5));
    const otePrice = Number(ote705.toFixed(5));

    if (dir === 1 ? otePrice <= currentPrice : otePrice >= currentPrice) {
      const modelTitle = sId === "swing"
        ? "Macro Dealing Range OTE (70.5% Deep Discount)"
        : sId === "day"
        ? "Session Dealing Range OTE (70.5% Discount)"
        : "Micro Dealing Range OTE (70.5% Retracement)";
      const modelBadge = sId === "swing" ? "Macro OTE" : sId === "day" ? "Session OTE" : "Micro OTE";
      const modelTf = sId === "swing" ? "D1" : sId === "day" ? "4H" : "5M";

      candidateLevels.push({
        type: "OTE_SWEETSPOT",
        modelId: "ote_continuation",
        modelName: modelTitle,
        modelBadge,
        tf: modelTf,
        price: otePrice,
        entry: otePrice,
        zoneHigh: zHigh,
        zoneLow: zLow,
        quality: "FIB_DEALING_RANGE",
        age: 0,
        isHorizonAnchorLevel: false,
        label: `${modelTf} ${modelBadge} 70.5% (${otePrice.toFixed(4)})`,
        rationale: `${sId.toUpperCase()} Dealing Range 70.5% discount sweetspot (${dealingRange.low.toFixed(4)} - ${dealingRange.high.toFixed(4)}).`,
        evidence: {
          impulse: {
            high: dealingRange.high,
            low: dealingRange.low,
          },
        },
      });
    }
  }

  // A. FVG Consequent Encroachment (CE - 50% Midpoint)
  // Only inject macro H4 FVG for Swing horizon — NEVER for Scalp!
  if (sId === "swing" && htfFvg?.respected?.length) {
    for (const g of htfFvg.respected) {
      if (g.dir === dir && g.ce) {
        candidateLevels.push({
          type: "FVG_CE",
          modelId: "ict_2022",
          modelName: "ICT 2022 Mentorship Model",
          modelBadge: "2022 Mentorship",
          tf: "H4",
          price: g.ce,
          entry: g.ce,
          zoneHigh: Math.max(g.top, g.bottom),
          zoneLow: Math.min(g.top, g.bottom),
          quality: g.quality || "A_RESPECTED",
          age: g.ageBars || 0,
          label: `4H FVG CE (${g.ce.toFixed(4)})`,
          rationale: `4H Fair Value Gap CE @ ${g.ce.toFixed(4)} actively defended by institutional order flow.`,
        });
      }
    }
  }

  const sessionTf = sId === "swing"
    ? "H1"
    : sId === "scalp"
    ? (frames.M5?.length ? "5M" : "15M")
    : (frames.M15?.length ? "15M" : "1H");

  const localFvgs = findLocalFVGs(setupBars, dir);
  for (const fvg of localFvgs.slice(-3)) {
    const isSb = Boolean(sbWindow);
    candidateLevels.push({
      type: "FVG_CE",
      modelId: isSb ? "silver_bullet" : "ict_2022",
      modelName: isSb ? "ICT Silver Bullet Window" : "ICT 2022 Mentorship Model",
      modelBadge: isSb ? "Silver Bullet" : "2022 Mentorship",
      tf: sessionTf,
      price: fvg.ce,
      entry: fvg.ce,
      zoneHigh: fvg.top,
      zoneLow: fvg.bottom,
      quality: "A_FRESH",
      age: fvg.age,
      label: `${sessionTf} ${isSb ? "SB" : "FVG"} CE (${fvg.ce.toFixed(4)})`,
      rationale: isSb
        ? `Silver Bullet window FVG CE @ ${fvg.ce.toFixed(4)} with time-window alignment.`
        : `Fresh institutional FVG CE @ ${fvg.ce.toFixed(4)} with clean order flow support.`,
    });
  }

  // B. Institutional Order Block (OB)
  const obs = findOrderBlocks(setupBars, dir, avg);
  for (const ob of obs.slice(-2)) {
    candidateLevels.push({
      type: "ORDER_BLOCK",
      modelId: "breaker_block",
      modelName: "Breaker Block & Mitigation Retest",
      modelBadge: "Breaker Block",
      tf: sessionTf,
      price: ob.meanThreshold,
      entry: ob.meanThreshold,
      zoneHigh: ob.top,
      zoneLow: ob.bottom,
      quality: "HIGH_DISPLACEMENT",
      age: ob.age,
      label: `${sessionTf} OB MT (${ob.meanThreshold.toFixed(4)})`,
      rationale: `Institutional Order Block Mean Threshold @ ${ob.meanThreshold.toFixed(4)} displacement origin.`,
    });
  }

  // C. Optimal Trade Entry (OTE 62% - 79% Fibonacci Sweetspot)
  const ote = calculateOTE(setupBars, dir);
  if (ote) {
    candidateLevels.push({
      type: "OTE_SWEETSPOT",
      modelId: "ote_continuation",
      modelName: "OTE Trend Expansion (Optimal Trade Entry)",
      modelBadge: "OTE Sweetspot",
      tf: sessionTf,
      price: ote.sweetspot,
      entry: ote.sweetspot,
      zoneHigh: Math.max(ote.fib62, ote.fib79),
      zoneLow: Math.min(ote.fib62, ote.fib79),
      quality: "FIB_CONFLUENCE",
      age: 0,
      label: `OTE 70.5% (${ote.sweetspot.toFixed(4)})`,
      rationale: `Fibonacci OTE 70.5% sweetspot within dealing range (${ote.swingLow.toFixed(4)} - ${ote.swingHigh.toFixed(4)}).`,
    });
  }

  // D. Turtle Soup Liquidity Sweep & Reclaim
  const raids = detectLiquidityRaids(setupBars, { maxReclaimBars: 2 });
  const recentRaid = raids?.filter(r => r.dir === dir)?.at(-1);
  if (recentRaid && recentRaid.age <= 6) {
    candidateLevels.push({
      type: "TURTLE_SOUP",
      modelId: "turtle_soup",
      modelName: "Turtle Soup Liquidity Raid",
      modelBadge: "Turtle Soup",
      tf: sessionTf,
      price: recentRaid.levelPrice,
      entry: recentRaid.levelPrice,
      zoneHigh: recentRaid.levelPrice,
      zoneLow: recentRaid.levelPrice,
      quality: "A_SWEEP_RECLAIM",
      age: recentRaid.age,
      label: `Turtle Soup Reclaim (${recentRaid.levelPrice.toFixed(4)})`,
      rationale: `Liquidity raid of ${recentRaid.levelPrice.toFixed(4)} with rapid bar reclaim.`,
    });
  }

  if (!candidateLevels.length) return null;

  // Institutional Limit Order Physics:
  // A BUY LIMIT must wait for a downward discount retracement (entry <= currentPrice).
  // A SELL LIMIT must wait for an upward premium retracement (entry >= currentPrice).
  // Any candidate level on the opposing side of market price is an invalid breakout/stop-like order and is strictly rejected.
  const validRetracementLevels = candidateLevels.filter((lvl) => {
    return dir === 1 ? lvl.entry <= currentPrice : lvl.entry >= currentPrice;
  });

  if (!validRetracementLevels.length) return null;

  const candleFormationTime = setupBars.at(-1)?.closeTime != null
    ? setupBars.at(-1).closeTime * 1000
    : (setupBars.at(-1)?.time ? setupBars.at(-1).time * 1000 : Number(config.now ?? Date.now()));

  const timeSlot = getCurrentTimeSlot(new Date(config.now ?? Date.now()));
  const isKillzone = Boolean(timeSlot?.isKillzone);
  const hasSmt = Boolean(brain?.smtEvidence?.some(x => x.dir === dir && x.confirmed !== false));

  // Score candidate levels with institutional geometry and confluence breakdown
  const scoredLevels = validRetracementLevels.map((lvl) => {
    // 1. Calculate Invalidation SL via Autonomous Stop-Loss Engine (ASLE)
    const slRes = calculateStructuralStopLoss({
      dir,
      entry: lvl.price,
      modelId: lvl.modelId,
      zoneLow: lvl.zoneLow,
      zoneHigh: lvl.zoneHigh,
      extreme: lvl.price,
      evidence: lvl.evidence || {},
      scenario,
      frames,
      ranges,
      brain,
      symbol,
      config,
      tf: lvl.tf,
    });
    const sl = slRes?.sl ?? (dir === 1 ? lvl.price - avg * 1.5 : lvl.price + avg * 1.5);

    // 2. Calculate Take Profit via Multi-Timeframe Structural Cascading Target Engine
    const cascadingTarget = resolveCascadingDefaultTarget({
      entry: lvl.price,
      sl,
      dir,
      scenario,
      horizon: sId,
      frames,
      ranges,
      brain,
      htfFvg,
      htfLiq: brain?.htfLiquidity,
      evidence: lvl.evidence || {},
      targets: lvl.targets,
      targetDOL,
      dealingRange,
      digits: 5,
    });

    const tp = cascadingTarget.tpPrice;
    const finalRunnerRR = cascadingTarget.targetRR;
    const targets = cascadingTarget.targets;
    const actualRisk = Math.abs(lvl.price - sl);
    const actualReward = dir === 1 ? (tp - lvl.price) : (lvl.price - tp);
    const rr = finalRunnerRR;
    const meetsMinRR = rr >= minRR;

    // 4. Confluence Breakdown (standard 6 factors: max 25, 20, 20, 15, 10, 10 = 100)
    const inDiscountOrPremium = eq != null
      ? (dir === 1 ? lvl.price <= eq : lvl.price >= eq)
      : (dir === 1 ? lvl.price <= currentPrice + avg * 0.15 : lvl.price >= currentPrice - avg * 0.15);

    const dolAligned = Boolean(
      targetDOL?.price && (dir === 1 ? targetDOL.price > lvl.price : targetDOL.price < lvl.price)
    );

    const hasDisplacement = (
      lvl.quality === "HIGH_DISPLACEMENT" ||
      lvl.quality === "A_RESPECTED" ||
      lvl.quality === "A_PRIME_CE_DEFENDED" ||
      Boolean(brain?.displacement?.valid || brain?.dayTraderContext?.ltfGatekeeper?.triggerStatus === "CONFIRMED")
    );

    const isHtfPdArray = (
      lvl.tf === "H4" ||
      lvl.tf === "D1" ||
      Boolean(htfFvg?.respected?.length) ||
      Boolean(brain?.htfPdArray)
    );

    const confluenceBreakdown = {
      dolAlignment: dolAligned ? 25 : 0,
      premiumDiscount: inDiscountOrPremium ? 20 : 0,
      displacement: hasDisplacement ? 20 : 0,
      killzone: isKillzone ? 15 : 0,
      smt: hasSmt ? 10 : 0,
      htfPdArray: isHtfPdArray ? 10 : 0,
    };

    let confluenceScore = Object.values(confluenceBreakdown).reduce((a, b) => a + b, 0);
    if (lvl.age <= 8 && confluenceScore < 100) {
      confluenceScore = Math.min(100, confluenceScore + 5);
    }
    if (lvl.quality === "A_RESPECTED" || lvl.quality === "A_PRIME_CE_DEFENDED") {
      confluenceScore = Math.min(100, confluenceScore + 10);
    }

    return {
      ...lvl,
      id: lvl.modelId,
      entry: lvl.price,
      sl,
      tp,
      rr,
      targetRR: rr,
      actualRisk,
      actualReward,
      slAudit: slRes,
      targets,
      meetsMinRR,
      status: meetsMinRR ? "QUALIFIED" : "RR_REJECTED",
      confluenceScore: Math.min(100, Math.max(10, confluenceScore)),
      confluenceBreakdown,
      confluenceTags: Object.entries(confluenceBreakdown).filter(([, v]) => v > 0).map(([k]) => k.toUpperCase()),
      riskPips: units.pip > 0 ? Math.round(actualRisk / units.pip) : null,
      riskDistance: actualRisk,
      evidence: lvl.evidence || {
        sequence: [lvl.type],
        formationTime: lvl.formationTime || candleFormationTime,
        label: lvl.label,
        rationale: lvl.rationale,
        confluenceBreakdown,
      },
    };
  });

  const decisionResult = evaluateEntryModelDecisionEngine({
    candidates: scoredLevels.map((lvl) => ({ ...lvl, permitted: lvl.meetsMinRR })),
    symbol,
    dir,
    scenario,
    frames,
    ranges,
    targetDOL,
    brain,
    config,
    now: config.now ?? Date.now(),
  });

  const primary = decisionResult || scoredLevels.find((l) => l.meetsMinRR) || scoredLevels[0];

  if (!primary || !primary.meetsMinRR || primary.rr < minRR || primary.actualReward <= 0 || primary.actualRisk <= 0) {
    return null;
  }

  return {
    ...primary,
    targetDOL,
    dealingRange,
    thesisId: brain?.thesisId || brain?.verdict || "HTF_STRUCTURE",
    ideaId: `${brain?.thesisId || "thesis"}:${primary.modelId}:${primary.tf}:${primary.price}`,
    allCandidates: decisionResult?.allCandidates || scoredLevels,
    candidateCount: decisionResult?.candidateCount || scoredLevels.length,
  };
}

function findLocalFVGs(bars, dir) {
  const fvgs = [];
  if (bars.length < 4) return fvgs;
  for (let i = 2; i < bars.length; i++) {
    const b0 = bars[i - 2], b2 = bars[i];
    if (dir === 1 && b2.low > b0.high) {
      fvgs.push({ top: b2.low, bottom: b0.high, ce: (b2.low + b0.high) / 2, age: bars.length - 1 - i });
    } else if (dir === -1 && b2.high < b0.low) {
      fvgs.push({ top: b0.low, bottom: b2.high, ce: (b0.low + b2.high) / 2, age: bars.length - 1 - i });
    }
  }
  return fvgs;
}

function findOrderBlocks(bars, dir, avg) {
  const obs = [];
  if (bars.length < 5) return obs;
  for (let i = bars.length - 12; i < bars.length - 2; i++) {
    if (i < 1) continue;
    const b = bars[i], next1 = bars[i + 1], next2 = bars[i + 2];
    if (dir === 1 && b.close < b.open && ((next1.close - next1.open) > avg * 1.1 || (next2.close - next2.open) > avg * 1.1)) {
      obs.push({ top: b.high, bottom: b.low, open: b.open, meanThreshold: (b.high + b.low) / 2, age: bars.length - 1 - i });
    } else if (dir === -1 && b.close > b.open && ((next1.open - next1.close) > avg * 1.1 || (next2.open - next2.close) > avg * 1.1)) {
      obs.push({ top: b.high, bottom: b.low, open: b.open, meanThreshold: (b.high + b.low) / 2, age: bars.length - 1 - i });
    }
  }
  return obs;
}

function calculateOTE(bars, dir) {
  const { highs, lows } = findPivots(bars, 3, 3);
  if (!highs.length || !lows.length) return null;
  let swingHigh = null, swingLow = null;
  if (dir === 1) {
    const lastH = highs[highs.length - 1];
    const precedingLows = lows.filter((l) => l.i < lastH.i);
    const anchorLow = precedingLows.length ? precedingLows[precedingLows.length - 1] : lows[lows.length - 1];
    swingHigh = lastH.price;
    swingLow = anchorLow.price;
  } else {
    const lastL = lows[lows.length - 1];
    const precedingHighs = highs.filter((h) => h.i < lastL.i);
    const anchorHigh = precedingHighs.length ? precedingHighs[precedingHighs.length - 1] : highs[highs.length - 1];
    swingHigh = anchorHigh.price;
    swingLow = lastL.price;
  }
  const span = swingHigh - swingLow;
  if (span <= 0) return null;
  const fib62 = dir === 1 ? swingHigh - span * 0.62 : swingLow + span * 0.62;
  const sweetspot = dir === 1 ? swingHigh - span * 0.705 : swingLow + span * 0.705;
  const fib79 = dir === 1 ? swingHigh - span * 0.79 : swingLow + span * 0.79;
  return { fib62, sweetspot, fib79, swingHigh, swingLow };
}

export { evaluateExecutionVetoes } from "./models.js";
