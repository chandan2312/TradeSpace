// Dynamic Institutional Level Detector & Confluence Scoring Engine
import { avgRange, findPivots } from "../patterns/core.js";
import { evaluateAllEntryModels, symbolUnits } from "./models.js";

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
      dealingRange: ranges?.ranges?.H4 || ranges?.H4 || brain?.dealingRange,
      thesisId: brain?.thesisId || brain?.verdict || "HTF_STRUCTURE",
      ideaId: `${brain?.thesisId || "thesis"}:${modelResult.modelId}:${modelResult.tf}:${modelResult.entry}`,
    };
  }

  // 2. Discover Institutional Reaction Levels (FVG CE, Order Block, OTE Sweetspot)
  const setupBars = scenario?.id === "swing" ? (frames.H4 || frames.H1) : (frames.H1 || frames.M15);
  if (!setupBars || setupBars.length < 15) return null;

  const currentPrice = setupBars[setupBars.length - 1].close;
  const avg = avgRange(setupBars);
  const minRR = config.minRR || scenario?.minRR || 2.0;

  const candidateLevels = [];

  // A. FVG Consequent Encroachment (CE - 50% Midpoint)
  if (htfFvg?.respected?.length) {
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

  const localFvgs = findLocalFVGs(setupBars, dir);
  for (const fvg of localFvgs.slice(-3)) {
    candidateLevels.push({
      type: "FVG_CE",
      modelId: "ict_2022",
      modelName: "ICT 2022 Mentorship Model",
      modelBadge: "2022 Mentorship",
      tf: scenario?.sessionTf || "15M",
      price: fvg.ce,
      entry: fvg.ce,
      zoneHigh: fvg.top,
      zoneLow: fvg.bottom,
      quality: "A_FRESH",
      age: fvg.age,
      label: `${scenario?.sessionTf || "15M"} FVG CE (${fvg.ce.toFixed(4)})`,
      rationale: `Fresh institutional FVG CE @ ${fvg.ce.toFixed(4)} with clean order flow support.`,
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
      tf: scenario?.sessionTf || "15M",
      price: ob.meanThreshold,
      entry: ob.meanThreshold,
      zoneHigh: ob.top,
      zoneLow: ob.bottom,
      quality: "HIGH_DISPLACEMENT",
      age: ob.age,
      label: `${scenario?.sessionTf || "15M"} OB MT (${ob.meanThreshold.toFixed(4)})`,
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
      tf: scenario?.sessionTf || "15M",
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

  if (!candidateLevels.length) return null;

  // Score candidate levels
  const scoredLevels = candidateLevels.map((lvl) => {
    let score = 50;
    const tags = [lvl.type];

    if (lvl.quality === "A_RESPECTED" || lvl.quality === "A_PRIME_CE_DEFENDED") {
      score += 25;
      tags.push("RESPECTED_DEFENSE");
    } else if (lvl.quality === "HIGH_DISPLACEMENT") {
      score += 20;
      tags.push("DISPLACEMENT");
    }

    if (lvl.age <= 8) {
      score += 10;
      tags.push("FRESH");
    }

    if (dir === 1 && lvl.price <= currentPrice + avg * 0.15) {
      score += 15;
      tags.push("DISCOUNT_PULLBACK");
    } else if (dir === -1 && lvl.price >= currentPrice - avg * 0.15) {
      score += 15;
      tags.push("PREMIUM_PULLBACK");
    }

    return {
      ...lvl,
      confluenceScore: Math.min(100, Math.max(10, score)),
      confluenceTags: tags,
    };
  });

  scoredLevels.sort((a, b) => b.confluenceScore - a.confluenceScore);
  const primary = scoredLevels[0];

  // Calculate Invalidation SL and TP
  let sl = 0;
  if (dir === 1) {
    const floor = Math.min(primary.zoneLow, primary.price);
    sl = floor - avg * 0.45;
  } else {
    const ceiling = Math.max(primary.zoneHigh, primary.price);
    sl = ceiling + avg * 0.45;
  }

  const risk = Math.abs(primary.price - sl);
  if (risk < avg * 0.35) {
    sl = dir === 1 ? primary.price - avg * 0.45 : primary.price + avg * 0.45;
  }

  let tp = 0;
  const isTargetDolValid = targetDOL?.price && (
    dir === 1 ? targetDOL.price > primary.price + avg * 0.5 : targetDOL.price < primary.price - avg * 0.5
  );

  if (isTargetDolValid) {
    tp = targetDOL.price;
  } else {
    const h4R = ranges?.ranges?.H4 || ranges?.H4;
    const d1R = ranges?.ranges?.D1 || ranges?.D1;
    if (dir === 1) {
      tp = (h4R && h4R.high > primary.price + avg * 1.5)
        ? h4R.high
        : ((d1R && d1R.high > primary.price + avg * 1.5) ? d1R.high : primary.price + avg * 3.5);
    } else {
      tp = (h4R && h4R.low < primary.price - avg * 1.5)
        ? h4R.low
        : ((d1R && d1R.low < primary.price - avg * 1.5) ? d1R.low : primary.price - avg * 3.5);
    }
  }

  const actualRisk = Math.abs(primary.price - sl);
  const actualReward = dir === 1 ? (tp - primary.price) : (primary.price - tp);
  if (actualReward <= 0 || actualRisk <= 0) return null;

  const rr = Math.round((actualReward / actualRisk) * 100) / 100;
  if (rr < minRR) return null;

  const tp1Price = Number((primary.price + dir * actualRisk * Math.min(2.0, rr * 0.5)).toFixed(5));
  const tp2Price = Number((primary.price + dir * actualRisk * Math.min(3.0, rr * 0.75)).toFixed(5));
  const targets = [
    { id: "tp1", price: tp1Price, fraction: 0.5, targetSide: dir === 1 ? "BSL" : "SSL" },
    { id: "tp2", price: tp2Price, fraction: 0.3, targetSide: dir === 1 ? "BSL" : "SSL" },
    { id: "runner", price: tp, fraction: 0.2, targetSide: dir === 1 ? "BSL" : "SSL" },
  ];

  const candleFormationTime = setupBars.at(-1)?.closeTime != null ? setupBars.at(-1).closeTime * 1000 : (setupBars.at(-1)?.time ? setupBars.at(-1).time * 1000 : Number(config.now ?? Date.now()));
  return {
    ...primary,
    id: primary.modelId,
    entry: primary.price,
    sl,
    tp,
    rr,
    targetRR: rr,
    targets,
    meetsMinRR: true,
    evidence: primary.evidence || { sequence: [primary.type], formationTime: primary.formationTime || candleFormationTime, label: primary.label, rationale: primary.rationale },
    riskPips: units.pip > 0 ? Math.round(actualRisk / units.pip) : null,
    riskDistance: actualRisk,
    targetDOL,
    dealingRange: ranges?.ranges?.H4 || ranges?.H4 || brain?.dealingRange,
    thesisId: brain?.thesisId || brain?.verdict || "HTF_STRUCTURE",
    ideaId: `${brain?.thesisId || "thesis"}:${primary.modelId}:${primary.tf}:${primary.price}`,
    allCandidates: scoredLevels,
    candidateCount: scoredLevels.length,
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
