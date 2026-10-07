// Multi-Timeframe Structural Cascading Take-Profit Engine (MT-STPE)
// Resolves realistic, dynamic structural Take Profit levels without artificial fixed clamps:
//
// 1. tradeDefault mode (Cascading Downwards):
//    - Preferred RR bracket: 3.0R - 7.0R
//    - Timeframe hierarchies (Max 3 levels per horizon):
//      * Day Horizon:   Level 1: 4H  -> Level 2: 1H  -> Level 3: 15M
//      * Swing Horizon: Level 1: 1D  -> Level 2: 4H  -> Level 3: 1H
//      * Scalp Horizon: Level 1: 30M -> Level 2: 15M -> Level 3: 5M
//    - If Level 1 target RR > 7.0R (e.g. 12R on 4H), cascades to Level 2 (1H).
//    - If Level 2 target RR > 7.0R, cascades to Level 3 (15M).
//    - If Level 3 target RR > 7.0R, kept as a valid structural exception out of preferred range (NOT artificially clamped).
//    - Builds institutional 3-target ladder: TP1 (40% milestone), TP2 (70% milestone), Runner (100% structural).
//
// 2. tradeProp mode (Cascading Upwards Gradual Ladder):
//    - Preferred RR bracket: 1.5R - 2.5R
//    - Gradual timeframe ladder: 5M -> 15M -> 30M -> 1H -> 2H -> 4H -> 1D
//    - Starting timeframe:
//      * Scalp: starts at 5M
//      * Day:   starts at 15M
//      * Swing: starts at 1H
//    - If current timeframe < 1.5R, steps up to the next higher timeframe.
//    - If a timeframe gives 1.5R - 2.5R, keeps it.
//    - If a timeframe gives > 2.5R, caps max RR to 2.5R only.

export const DEFAULT_TP_RANGE = { minR: 3.0, maxR: 7.0 };
export const PROP_FIRM_TP_RANGE = { minR: 1.5, maxR: 2.5 };

export const DEFAULT_HORIZON_TIMEFRAME_LEVELS = {
  day: ["H4", "H1", "M15"],
  swing: ["D1", "H4", "H1"],
  scalp: ["M30", "M15", "M5"],
};

export const PROP_TIMEFRAME_LADDER = ["M5", "M15", "M30", "H1", "H2", "H4", "D1"];

export const PROP_HORIZON_STARTING_TIMEFRAME = {
  scalp: "M5",
  day: "M15",
  swing: "H1",
};

/**
 * Normalizes timeframe string to standard uppercase code (e.g. '4H' -> 'H4', '15M' -> 'M15').
 * @param {string} tf
 * @returns {string}
 */
export function normalizeTf(tf) {
  if (!tf) return "H4";
  const s = String(tf).trim().toUpperCase();
  if (s === "5M" || s === "M5") return "M5";
  if (s === "15M" || s === "M15") return "M15";
  if (s === "30M" || s === "M30") return "M30";
  if (s === "1H" || s === "H1") return "H1";
  if (s === "2H" || s === "H2") return "H2";
  if (s === "4H" || s === "H4") return "H4";
  if (s === "1D" || s === "D1") return "D1";
  if (s === "1W" || s === "W1") return "W1";
  return s;
}

/**
 * Gathers all structural landmark candidates for a specific timeframe in the trade's profit direction.
 * @param {Object} params
 * @returns {Array<Object>}
 */
export function getStructuralCandidatesForTf({
  tf,
  entry,
  sl,
  dir,
  frames = {},
  ranges = {},
  brain = {},
  htfFvg = {},
  htfLiq = {},
  evidence = {},
  targets = [],
  targetDOL = null,
  dealingRange = null,
  digits = 5,
}) {
  const normTf = normalizeTf(tf);
  const risk = Math.abs(Number(entry) - Number(sl));
  if (!(risk > 0) || !Number.isFinite(Number(entry))) return [];

  const isProfit = (price) => (dir === 1 ? Number(price) > Number(entry) : Number(price) < Number(entry));
  const computeR = (price) => (dir * (Number(price) - Number(entry))) / risk;

  const rawCandidates = [];
  const add = (price, name, type, weight = 90) => {
    if (!Number.isFinite(Number(price)) || !isProfit(price)) return;
    const r = Math.round(computeR(price) * 100) / 100;
    if (r <= 0) return;
    rawCandidates.push({
      price: Number(Number(price).toFixed(digits)),
      rr: r,
      name,
      type,
      weight,
      tf: normTf,
    });
  };

  // 1. Dealing Range on this timeframe
  const rangeMap = ranges?.ranges || ranges || {};
  const r = rangeMap[normTf] || rangeMap[tf] ||
    (normTf === "M30" ? rangeMap["30M"] : null) ||
    (normTf === "M5" ? rangeMap["5M"] : null) ||
    (normTf === "H4" ? (dealingRange || brain?.dealingRange) : null);

  if (r) {
    if (Number.isFinite(r.eq)) {
      add(r.eq, `${normTf} Dealing Range Equilibrium (50% EQ)`, "RANGE_EQ", 95);
    }
    if (Number.isFinite(r.high) && Number.isFinite(r.low)) {
      const ote062 = dir === 1 ? r.low + (r.high - r.low) * 0.62 : r.high - (r.high - r.low) * 0.62;
      const ote0705 = dir === 1 ? r.low + (r.high - r.low) * 0.705 : r.high - (r.high - r.low) * 0.705;
      add(ote062, `${normTf} Dealing Range OTE 0.62`, "RANGE_OTE", 82);
      add(ote0705, `${normTf} Dealing Range OTE 0.705`, "RANGE_OTE", 85);

      const extreme = dir === 1 ? r.high : r.low;
      add(extreme, `${normTf} Dealing Range External ${dir === 1 ? "High (BSL)" : "Low (SSL)"}`, "RANGE_EXTREME", 98);
    }
  }

  // 2. Opposing FVGs & Consequent Encroachment (CE 50%) on this timeframe
  const allFvgs = [
    ...(htfFvg?.all || []),
    ...(htfFvg?.unmitigated || []),
    ...(brain?.htfFvg?.unmitigated || []),
    ...(evidence?.pd?.fvgs || []),
    ...(evidence?.fvgs || []),
  ];
  for (const f of allFvgs) {
    if (!f) continue;
    const fTf = normalizeTf(f.tf || "H4");
    if (fTf === normTf) {
      const isOpposing = f.dir === -dir || f.originalDir === -dir || (f.type && f.type.includes(dir === 1 ? "BEAR" : "BULL"));
      if (isOpposing) {
        const ce = Number.isFinite(Number(f.ce)) ? Number(f.ce) : (Number(f.top) + Number(f.bottom)) / 2;
        const boundary = dir === 1 ? Math.min(Number(f.top), Number(f.bottom)) : Math.max(Number(f.top), Number(f.bottom));
        add(ce, `${normTf} FVG Consequent Encroachment (CE 50%)`, "FVG_CE", 100);
        add(boundary, `${normTf} FVG Entry Boundary`, "FVG_BOUNDARY", 88);
      }
    }
  }

  // 3. Opposing Order Blocks & Breakers on this timeframe
  const allObs = [
    ...(evidence?.pd?.orderBlocks || []),
    ...(evidence?.orderBlocks || []),
    ...(brain?.pd?.orderBlocks || []),
    ...(evidence?.breakers || []),
  ];
  for (const ob of allObs) {
    if (!ob) continue;
    const obTf = normalizeTf(ob.tf || "H4");
    if (obTf === normTf) {
      const isOpposing = ob.dir === -dir || ob.originalDir === -dir || ob.state === "INVALIDATED";
      if (isOpposing) {
        const isBreaker = ob.state === "INVALIDATED" || ob.type === "BREAKER";
        const label = isBreaker ? "Breaker Block" : "Order Block";
        const mt = (Number(ob.top) + Number(ob.bottom)) / 2;
        const boundary = dir === 1 ? Math.min(Number(ob.top), Number(ob.bottom)) : Math.max(Number(ob.top), Number(ob.bottom));
        add(mt, `${normTf} ${label} Mean Threshold (50%)`, "OB_MT", 94);
        add(boundary, `${normTf} ${label} Entry`, "OB_ENTRY", 89);
      }
    }
  }

  // 4. Liquidity Pools & Key Levels on this timeframe
  const liq = htfLiq || brain?.htfLiquidity || {};
  const keyLevels = liq.keyLevels || {};
  if (normTf === "D1") {
    if (dir === 1 && keyLevels.PDH?.price) add(keyLevels.PDH.price, "PDH (Previous Day High BSL)", "HTF_LIQUIDITY", 98);
    if (dir === -1 && keyLevels.PDL?.price) add(keyLevels.PDL.price, "PDL (Previous Day Low SSL)", "HTF_LIQUIDITY", 98);
  } else if (normTf === "W1") {
    if (dir === 1 && keyLevels.PWH?.price) add(keyLevels.PWH.price, "PWH (Previous Week High BSL)", "HTF_LIQUIDITY", 99);
    if (dir === -1 && keyLevels.PWL?.price) add(keyLevels.PWL.price, "PWL (Previous Week Low SSL)", "HTF_LIQUIDITY", 99);
  } else if (normTf === "H4") {
    if (dir === 1) {
      for (const eq of (liq.eqh || [])) if (eq?.price) add(eq.price, "4H EQH (Equal Highs Buyside Magnet)", "LIQUIDITY_MAGNET", 96);
    } else {
      for (const eq of (liq.eql || [])) if (eq?.price) add(eq.price, "4H EQL (Equal Lows Sellside Magnet)", "LIQUIDITY_MAGNET", 96);
    }
  }

  const pools = dir === 1 ? (liq.pools?.bsl || []) : (liq.pools?.ssl || []);
  for (const pool of pools) {
    if (pool?.price && normalizeTf(pool.tf || "H4") === normTf) {
      add(pool.price, pool.name || `${normTf} Liquidity Pool`, "LIQUIDITY_POOL", 92);
    }
  }

  // 5. Direct Candle Bars Swing Extremes / Pivots (if bars provided in frames)
  const bars = frames[normTf] || frames[tf] || (normTf === "M30" ? frames["30M"] : null) || (normTf === "M5" ? frames["5M"] : null);
  if (Array.isArray(bars) && bars.length >= 10) {
    const lookback = Math.min(bars.length, 60);
    const slice = bars.slice(-lookback);
    // Find unmitigated swing highs for long, swing lows for short
    if (dir === 1) {
      const highs = slice.map((b) => b.high).filter((h) => isProfit(h));
      if (highs.length > 0) {
        const highestRecent = Math.max(...highs);
        add(highestRecent, `${normTf} Swing High Resistance`, "SWING_EXTREME", 87);
      }
    } else {
      const lows = slice.map((b) => b.low).filter((l) => isProfit(l));
      if (lows.length > 0) {
        const lowestRecent = Math.min(...lows);
        add(lowestRecent, `${normTf} Swing Low Support`, "SWING_EXTREME", 87);
      }
    }
  }

  // 6. Explicit targets array (from setup or entry model)
  if (Array.isArray(targets)) {
    for (const t of targets) {
      if (t?.price && isProfit(t.price)) {
        const tTf = normalizeTf(t.tf || tf);
        if (tTf === normTf) {
          add(t.price, t.source || t.name || t.id || `${normTf} Structural Target`, "STRUCTURAL_LADDER", 88);
        }
      }
    }
  }

  // 7. Target DOL
  const dol = targetDOL || brain?.targetDOL || htfLiq?.drawOnLiquidity;
  if (dol?.price != null && isProfit(dol.price)) {
    const dolTf = normalizeTf(dol.tf || "H4");
    if (dolTf === normTf) {
      add(dol.price, `Draw on Liquidity (${dol.name || 'Macro DOL'})`, "MACRO_DOL", 97);
    }
  }

  // Deduplicate candidates by point proximity (collapse levels within 0.05R)
  const unique = [];
  rawCandidates.sort((a, b) => (dir === 1 ? a.price - b.price : b.price - a.price));
  for (const c of rawCandidates) {
    const existing = unique.find((u) => Math.abs(u.rr - c.rr) <= 0.05);
    if (!existing) {
      unique.push(c);
    } else if (c.weight > existing.weight) {
      Object.assign(existing, c);
    }
  }

  return unique;
}

/**
 * Resolves the Take-Profit and Target Ladder for tradeDefault mode using
 * downward multi-timeframe structural cascading.
 *
 * Algorithm:
 * - Preferred range: 3.0R - 7.0R
 * - Timeframe tiers (max 3 levels):
 *   Day:   4H  -> 1H  -> 15M
 *   Swing: 1D  -> 4H  -> 1H
 *   Scalp: 30M -> 15M -> 5M
 * - If Level 1 target RR > 7.0R, cascade to Level 2.
 * - If Level 2 target RR > 7.0R, cascade to Level 3.
 * - If Level 3 target RR > 7.0R, keep Level 3 target as a valid exception.
 *
 * @param {Object} params
 * @returns {Object} { targetRR, tpPrice, tf, source, landmarkType, levelIndex, isException, targets }
 */
export function resolveCascadingDefaultTarget({
  entry,
  sl,
  dir,
  scenario = {},
  horizon = null,
  frames = {},
  ranges = {},
  brain = {},
  htfFvg = {},
  htfLiq = {},
  evidence = {},
  targets = [],
  targetDOL = null,
  dealingRange = null,
  digits = 5,
  minPreferredR = DEFAULT_TP_RANGE.minR,
  maxPreferredR = DEFAULT_TP_RANGE.maxR,
}) {
  const risk = Math.abs(Number(entry) - Number(sl));
  if (!(risk > 0)) {
    return {
      targetRR: 3.5,
      tpPrice: Number(entry) || 0,
      tf: "4H",
      source: "fallback_zero_risk",
      landmarkType: "FALLBACK",
      levelIndex: 0,
      isException: false,
      targets: [],
    };
  }

  const sId = String(scenario?.id || scenario?.horizon || horizon || "day").toLowerCase();
  const isSwing = sId.includes("swing") || sId.includes("1d") || scenario?.horizonCode === 1;
  const isScalp = sId.includes("scalp") || sId.includes("30m") || sId.includes("5m") || scenario?.horizonCode === 3;
  const horizonKey = isSwing ? "swing" : isScalp ? "scalp" : "day";

  const tfLevels = DEFAULT_HORIZON_TIMEFRAME_LEVELS[horizonKey] || DEFAULT_HORIZON_TIMEFRAME_LEVELS.day;

  let selectedCandidate = null;
  let selectedTf = tfLevels[0];
  let selectedLevelIndex = 0;
  let isException = false;
  let bestBelowCandidate = null;
  let bestBelowTf = null;
  let bestBelowLevelIndex = 0;

  // Cascade through Level 1 -> Level 2 -> Level 3
  for (let k = 0; k < tfLevels.length; k++) {
    const tf = tfLevels[k];
    const candidates = getStructuralCandidatesForTf({
      tf, entry, sl, dir, frames, ranges, brain, htfFvg, htfLiq, evidence, targets, targetDOL, dealingRange, digits,
    });

    if (!candidates || candidates.length === 0) {
      continue;
    }

    candidates.sort((a, b) => a.rr - b.rr);

    // 1. Are there candidates within preferred range [3.0, 7.0]?
    const inRange = candidates.filter((c) => c.rr >= minPreferredR - 0.05 && c.rr <= maxPreferredR + 0.05);
    if (inRange.length > 0) {
      // Sort by weight then RR to pick highest-conviction structural landmark
      inRange.sort((a, b) => (b.weight || 90) - (a.weight || 90) || b.rr - a.rr);
      selectedCandidate = inRange[0];
      selectedTf = tf;
      selectedLevelIndex = k;
      break;
    }

    // 2. Are candidates above 7.0R?
    const aboveRange = candidates.filter((c) => c.rr > maxPreferredR + 0.05);
    if (aboveRange.length > 0) {
      if (k < tfLevels.length - 1) {
        // More than range -> cascade to next lower timeframe level
        continue;
      } else {
        // At 3rd level (k === 2): cannot go lower than 3rd level!
        // Keep Level 3 lowest structural target as an exception out of preferred range!
        selectedCandidate = aboveRange[0];
        selectedTf = tf;
        selectedLevelIndex = k;
        isException = true;
        break;
      }
    }

    // 3. What if candidates exist below 3.0R?
    // Store as fallback candidate, but continue checking lower levels in case they offer a target in [3.0, 7.0]
    const belowRange = candidates.filter((c) => c.rr > 0 && c.rr < minPreferredR - 0.05);
    if (belowRange.length > 0 && !bestBelowCandidate) {
      bestBelowCandidate = belowRange[belowRange.length - 1];
      bestBelowTf = tf;
      bestBelowLevelIndex = k;
    }
  }

  // If no candidate was in [3.0, 7.0] or above, use the best structural below-range candidate found
  if (!selectedCandidate && bestBelowCandidate) {
    selectedCandidate = bestBelowCandidate;
    selectedTf = bestBelowTf;
    selectedLevelIndex = bestBelowLevelIndex;
  }

  // 4. Fallback if no structural candidate was resolved across any level
  if (!selectedCandidate) {
    let fallbackRR = horizonKey === "swing" ? 5.0 : horizonKey === "scalp" ? 3.5 : 4.0;
    // Check if targetDOL is available even without matching TF
    const dol = targetDOL || brain?.targetDOL || htfLiq?.drawOnLiquidity;
    if (dol?.price && (dir === 1 ? dol.price > entry : dol.price < entry)) {
      const dolRR = Math.round((dir * (dol.price - entry) / risk) * 100) / 100;
      if (dolRR > 0) fallbackRR = dolRR;
    }

    const fallbackPrice = Number((Number(entry) + dir * (risk * fallbackRR)).toFixed(digits));
    selectedCandidate = {
      price: fallbackPrice,
      rr: fallbackRR,
      name: `${tfLevels[0]} Macro Horizon DOL`,
      type: "MACRO_DOL",
      tf: tfLevels[0],
    };
    selectedTf = tfLevels[0];
    selectedLevelIndex = 0;
  }

  const runnerRR = selectedCandidate.rr;
  const runnerPrice = selectedCandidate.price;

  // Build institutional 3-target progressive milestone ladder (TP1: 40%, TP2: 70%, Runner: 100%)
  let tp1R = Number((runnerRR * 0.40).toFixed(2));
  let tp2R = Number((runnerRR * 0.70).toFixed(2));
  if (runnerRR >= 3.0) {
    tp1R = Math.max(1.5, tp1R);
    tp2R = Math.max(tp1R + 0.5, tp2R);
  }
  if (tp2R >= runnerRR) tp2R = Number((runnerRR * 0.75).toFixed(2));
  if (tp1R >= tp2R) tp1R = Number((tp2R * 0.55).toFixed(2));
  if (tp1R <= 0) tp1R = Number((runnerRR * 0.33).toFixed(2));
  if (tp2R <= tp1R) tp2R = Number((runnerRR * 0.66).toFixed(2));

  const tp1Price = Number((Number(entry) + dir * (risk * tp1R)).toFixed(digits));
  const tp2Price = Number((Number(entry) + dir * (risk * tp2R)).toFixed(digits));

  const targetList = [
    { id: "tp1", price: tp1Price, fraction: 0.5, r: tp1R, targetSide: dir === 1 ? "BSL" : "SSL", tf: selectedTf, source: `40% Milestone to ${selectedCandidate.name}` },
    { id: "tp2", price: tp2Price, fraction: 0.3, r: tp2R, targetSide: dir === 1 ? "BSL" : "SSL", tf: selectedTf, source: `70% Milestone to ${selectedCandidate.name}` },
    { id: "runner", price: runnerPrice, fraction: 0.2, r: runnerRR, targetSide: dir === 1 ? "BSL" : "SSL", tf: selectedTf, source: selectedCandidate.name },
  ];

  return {
    targetRR: runnerRR,
    tpPrice: runnerPrice,
    tf: selectedTf,
    source: selectedCandidate.name,
    landmarkType: selectedCandidate.type,
    levelIndex: selectedLevelIndex,
    isException,
    targets: targetList,
  };
}

/**
 * Resolves the Take-Profit level for tradeProp mode using
 * upward gradual multi-timeframe structural cascading.
 *
 * Algorithm:
 * - Preferred bracket: 1.5R - 2.5R
 * - Gradual ladder: 5M -> 15M -> 30M -> 1H -> 2H -> 4H -> 1D
 * - Starting timeframe: Scalp: 5M | Day: 15M | Swing: 1H
 * - If current timeframe < 1.5R, steps up to next higher timeframe.
 * - If a timeframe gives 1.5R - 2.5R, keeps it.
 * - If a timeframe gives > 2.5R, caps max RR to 2.5R only.
 *
 * @param {Object} params
 * @returns {Object} { targetRR, tpPrice, tf, source, landmarkType, isCapped }
 */
export function resolveDynamicPropFirmTarget({
  entry,
  sl,
  dir,
  scenario = {},
  horizon = null,
  frames = {},
  ranges = {},
  brain = {},
  htfFvg = {},
  htfLiq = {},
  evidence = {},
  targets = [],
  dealingRange = null,
  targetRR = null,
  digits = 5,
  minPropR = PROP_FIRM_TP_RANGE.minR,
  maxPropR = PROP_FIRM_TP_RANGE.maxR,
}) {
  const risk = Math.abs(Number(entry) - Number(sl));
  if (!(risk > 0) || !Number.isFinite(Number(entry))) {
    const fallbackPrice = Number(entry) || 0;
    return {
      targetRR: 2.0,
      tpPrice: fallbackPrice,
      source: "fallback_zero_risk",
      landmarkType: "FALLBACK",
      tf: "M15",
      compositeScore: 0,
      isCapped: false,
    };
  }

  // Handle explicit targetRR override if explicitly requested without horizon
  if (targetRR != null && Number.isFinite(Number(targetRR)) && !scenario?.id && (!targets || targets.length === 0)) {
    const clampedRR = Math.min(maxPropR, Math.max(minPropR, Math.round(Number(targetRR) * 100) / 100));
    return {
      targetRR: clampedRR,
      tpPrice: Number((Number(entry) + dir * (risk * clampedRR)).toFixed(digits)),
      source: "Explicit Target Clamp",
      landmarkType: "EXPLICIT_CLAMP",
      tf: "M15",
      isCapped: clampedRR !== Number(targetRR),
    };
  }

  const sId = String(scenario?.id || scenario?.horizon || horizon || "").toLowerCase();
  const isSwing = sId.includes("swing") || sId.includes("1d") || scenario?.horizonCode === 1;
  const isScalp = sId.includes("scalp") || sId.includes("30m") || sId.includes("5m") || scenario?.horizonCode === 3;
  const startTf = isScalp
    ? PROP_HORIZON_STARTING_TIMEFRAME.scalp
    : isSwing
    ? PROP_HORIZON_STARTING_TIMEFRAME.swing
    : PROP_HORIZON_STARTING_TIMEFRAME.day;

  const startIdx = Math.max(0, PROP_TIMEFRAME_LADDER.indexOf(startTf));

  // If explicit targets array was provided in params (e.g. from models or tests), evaluate them first
  if (Array.isArray(targets) && targets.length > 0) {
    const customCandidates = [];
    for (const t of targets) {
      if (t?.price && (dir === 1 ? t.price > entry : t.price < entry)) {
        const r = Math.round((dir * (t.price - entry) / risk) * 100) / 100;
        if (r > 0) {
          customCandidates.push({
            price: t.price,
            rr: r,
            name: t.source || t.id,
            type: "STRUCTURAL_TARGET",
            tf: t.tf ? normalizeTf(t.tf) : startTf,
          });
        }
      }
    }

    const inBracket = customCandidates.filter((c) => c.rr >= minPropR - 0.02 && c.rr <= maxPropR + 0.02);
    if (inBracket.length > 0) {
      // Pick target closest to 2.0R sweet spot
      inBracket.sort((a, b) => Math.abs(a.rr - 2.0) - Math.abs(b.rr - 2.0));
      const best = inBracket[0];
      const clamped = Math.min(maxPropR, Math.max(minPropR, best.rr));
      return {
        targetRR: clamped,
        tpPrice: clamped !== best.rr ? Number((Number(entry) + dir * (risk * clamped)).toFixed(digits)) : best.price,
        source: best.name,
        landmarkType: best.type,
        tf: best.tf,
        isCapped: false,
      };
    }
  }

  // Check dealingRange if provided explicitly
  const dRange = dealingRange || brain?.dealingRange;
  if (dRange?.eq && (dir === 1 ? dRange.eq > entry : dRange.eq < entry)) {
    const eqR = Math.round((dir * (dRange.eq - entry) / risk) * 100) / 100;
    if (eqR >= minPropR - 0.02 && eqR <= maxPropR + 0.02) {
      const clamped = Math.min(maxPropR, Math.max(minPropR, eqR));
      return {
        targetRR: clamped,
        tpPrice: clamped !== eqR ? Number((Number(entry) + dir * (risk * clamped)).toFixed(digits)) : dRange.eq,
        source: "Dealing Range EQ",
        landmarkType: "RANGE_EQ",
        tf: "H4",
        isCapped: false,
      };
    }
  }

  // Gradual Timeframe Ladder Upwards: 5M -> 15M -> 30M -> 1H -> 2H -> 4H -> 1D
  for (let idx = startIdx; idx < PROP_TIMEFRAME_LADDER.length; idx++) {
    const tf = PROP_TIMEFRAME_LADDER[idx];
    const candidates = getStructuralCandidatesForTf({
      tf, entry, sl, dir, frames, ranges, brain, htfFvg, htfLiq, evidence, targets, digits,
    });

    if (!candidates || candidates.length === 0) continue;
    candidates.sort((a, b) => a.rr - b.rr);

    // 1. If it gave R between 1.5 to 2.5R range, then it's good!
    const inBracket = candidates.filter((c) => c.rr >= minPropR - 0.02 && c.rr <= maxPropR + 0.02);
    if (inBracket.length > 0) {
      inBracket.sort((a, b) => Math.abs(a.rr - 2.0) - Math.abs(b.rr - 2.0));
      const best = inBracket[0];
      const clamped = Math.min(maxPropR, Math.max(minPropR, best.rr));
      return {
        targetRR: clamped,
        tpPrice: clamped !== best.rr ? Number((Number(entry) + dir * (risk * clamped)).toFixed(digits)) : best.price,
        source: best.name,
        landmarkType: best.type,
        tf,
        isCapped: false,
      };
    }

    // 2. If it gave R more than 2.5R, cap max RR to 2.5R only!
    const aboveBracket = candidates.filter((c) => c.rr > maxPropR + 0.02);
    if (aboveBracket.length > 0) {
      const lowestAbove = aboveBracket[0];
      const cappedRR = maxPropR;
      const tpPrice = Number((Number(entry) + dir * (risk * cappedRR)).toFixed(digits));
      return {
        targetRR: cappedRR,
        tpPrice,
        source: `${lowestAbove.name} (Capped at 2.5R)`,
        landmarkType: lowestAbove.type,
        tf,
        isCapped: true,
      };
    }

    // 3. If all candidates on this timeframe are < 1.5R:
    // Move to next higher timeframe of that! (Loop continues to idx + 1)
  }

  // Horizon-tailored baseline fallback if ladder exhausted
  let defaultRR = 2.0;
  if (sId.includes("scalp") || scenario?.horizonCode === 3) defaultRR = 1.75;
  else if (sId.includes("swing") || scenario?.horizonCode === 1) defaultRR = 2.5;
  else if (targetRR != null && Number.isFinite(Number(targetRR))) defaultRR = Math.min(maxPropR, Math.max(minPropR, Number(targetRR)));

  const clampedRR = Math.min(maxPropR, Math.max(minPropR, Math.round(defaultRR * 100) / 100));
  const tpPrice = Number((Number(entry) + dir * (risk * clampedRR)).toFixed(digits));
  return {
    targetRR: clampedRR,
    tpPrice,
    source: "Horizon Bracket Baseline",
    landmarkType: "HORIZON_DEFAULT",
    tf: startTf,
    isCapped: false,
  };
}
