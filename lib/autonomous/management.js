import { confirmedFractals } from "../bias/institutional.js";

const quote = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
export function entryQuote(dir, tick) { return quote(dir === 1 ? tick?.ask : tick?.bid); }
export function exitQuote(dir, tick) { return quote(dir === 1 ? tick?.bid : tick?.ask); }

export function validateTargetLadder(trade) {
  if (!trade.targets) return true; // Existing documents retain their single target.
  if (!Array.isArray(trade.targets) || trade.targets.length === 0) return false;
  // Support 3-tier [0.5, 0.3, 0.2] or 2-tier [1/3, 2/3] fractional booking ladder or custom targets
  let last = Number(trade.entryPrice);
  const totalFraction = trade.targets.reduce((s, t) => s + (Number(t.fraction) || 0), 0);
  if (Math.abs(totalFraction - 1.0) > 0.05) return false;
  return trade.targets.every((target) => {
    const valid = Number.isFinite(target.price) && target.fraction > 0 && trade.dir * (target.price - last) > 0;
    last = target.price;
    return valid;
  });
}

export function initialTradeRisk(trade) {
  const entry = Number(trade.filledPrice || trade.entryPrice);
  const oldDistance = Number(trade.targetRR) > 0 && Number(trade.tpPrice) > 0 ? Math.abs(Number(trade.tpPrice) - Number(trade.entryPrice)) / Number(trade.targetRR) : null;
  const sourceSl = trade.initialSlPrice ?? trade.levelDetails?.sl ?? trade.stagedLevel?.sl ?? trade.events?.find((e) => Number(e.initialSlPrice))?.initialSlPrice;
  const fallbackSl = (trade.isBreakeven || trade.isTrailing || trade.isRiskFree) ? null : trade.slPrice;
  const distance = Number(trade.initialRiskDistance ?? (sourceSl != null ? Math.abs(entry - Number(sourceSl)) : oldDistance ?? (fallbackSl != null ? Math.abs(entry - Number(fallbackSl)) : null)));
  const sl = sourceSl != null ? Number(sourceSl) : (fallbackSl != null ? Number(fallbackSl) : entry - trade.dir * (distance || 0));
  return { entry, sl, distance: distance > 0 ? distance : 0, riskUsd: Number(trade.initialRiskUsd ?? trade.riskUsd) || 0, volume: Number(trade.initialVolume ?? trade.brokerVolume ?? trade.lotSize) || 0 };
}

export function markToMarket(trade, price) {
  const risk = initialTradeRisk(trade);
  // Ideal R (IR): 100% full lot size held from start to finish without partials
  const idealR = risk.distance > 0 ? trade.dir * (price - risk.entry) / risk.distance : 0;
  const fraction = Number(trade.remainingFraction ?? 1);
  const realizedR = Number(trade.realizedR ?? 0);
  const realizedPnl = Number(trade.realizedPnl ?? 0);
  // Floating on remaining active runner fraction
  const floatingR = idealR * fraction;
  const unrealizedPnl = idealR * risk.riskUsd * fraction;
  // Actual R (AR): Realized R already booked from partials + Floating R on remaining runner
  const actualR = realizedR + floatingR;
  const actualPnl = realizedPnl + unrealizedPnl;

  return {
    idealR,
    actualR,
    priceR: idealR,
    unrealizedR: idealR,
    floatingR,
    unrealizedPnl,
    actualPnl,
  };
}

export function partialExitLedger(trade, { id, price, volume, dealTicket = null, pnl, time = new Date() }) {
  const risk = initialTradeRisk(trade);
  if (![risk.volume, volume, price].every((n) => Number.isFinite(n) && n > 0)) return null;
  const existing = trade.partialExits || [];
  if (dealTicket && existing.some((e) => String(e.dealTicket) === String(dealTicket))) return null;
  const remaining = Number(trade.remainingVolume ?? risk.volume);
  if (volume > remaining + 1e-8) return null;
  const fraction = volume / risk.volume;
  const r = risk.distance > 0 ? trade.dir * (price - risk.entry) / risk.distance : 0;
  const openingCosts = Number(trade.openingCosts) || 0;
  const exit = { id, price, volume, fraction, r, weightedR: r * fraction, pnl: (Number.isFinite(pnl) ? pnl : r * risk.riskUsd * fraction) + openingCosts * fraction, dealTicket, time };
  const partialExits = [...existing, exit];
  const remainingVolume = Math.max(0, Number((remaining - volume).toFixed(8)));
  return { partialExits, remainingVolume, remainingFraction: remainingVolume / risk.volume, realizedR: partialExits.reduce((sum, e) => sum + e.weightedR, 0), realizedPnl: partialExits.reduce((sum, e) => sum + e.pnl, 0) };
}

export function breakevenPrice(trade, spec = {}) {
  const point = Number(spec?.point);
  const pip = Number(spec?.pip_size) || (point > 0 ? point * ([3, 5].includes(Number(spec?.digits)) ? 10 : 1) : 0);
  const risk = initialTradeRisk(trade);
  const entry = risk.entry;
  const digits = Number(spec?.digits) || (String(entry).split(".")[1]?.length || 5);
  const spreadDelta = Number(trade?.spreadPrice || 0) > 0 ? Number(trade.spreadPrice) * 0.5 : 0;
  const standardDelta = pip > 0 ? pip * 0.5 : (point > 0 ? point * 5 : Math.pow(10, -digits) * 5);
  const delta = Math.max(standardDelta, spreadDelta);
  return Number((entry + trade.dir * delta).toFixed(digits));
}

// Internal engine: finds optimal risk-free level between 1.0R and 1.5R.
// Checks recent candle structure/fractals inside [1.0R, 1.5R]; defaults to 1.25R institutional midpoint.
export function calculateOptimalRiskFreeLevel(trade, bars = []) {
  const risk = initialTradeRisk(trade);
  if (!risk.distance || risk.distance <= 0) {
    return { optimalR: 1.25, price: risk.entry + trade.dir * (risk.distance || 0) * 1.25, reason: "fallback_midpoint" };
  }
  const minR = 1.0;
  const maxR = 1.5;
  const minPrice = risk.entry + trade.dir * (risk.distance * minR);
  const maxPrice = risk.entry + trade.dir * (risk.distance * maxR);
  const lowBound = Math.min(minPrice, maxPrice);
  const highBound = Math.max(minPrice, maxPrice);

  if (Array.isArray(bars) && bars.length >= 5) {
    try {
      const fractals = confirmedFractals(bars, 5);
      const points = trade.dir === 1 ? (fractals.highs || []) : (fractals.lows || []);
      const candidates = points.filter((p) => p.price >= lowBound && p.price <= highBound);
      if (candidates.length > 0) {
        const best = trade.dir === 1
          ? candidates.sort((a, b) => a.price - b.price)[0]
          : candidates.sort((a, b) => b.price - a.price)[0];
        const rVal = trade.dir * (best.price - risk.entry) / risk.distance;
        const clampedR = Math.min(maxR, Math.max(minR, Math.round(rVal * 100) / 100));
        return {
          optimalR: clampedR,
          price: Number((risk.entry + trade.dir * (risk.distance * clampedR)).toFixed(trade.symbolSpec?.digits || 5)),
          reason: `structural_fractal_${best.time || "swing"}`,
        };
      }
    } catch {}
  }

  const optimalR = 1.25;
  const price = Number((risk.entry + trade.dir * (risk.distance * optimalR)).toFixed(trade.symbolSpec?.digits || 5));
  return { optimalR, price, reason: "institutional_midpoint_1.25R" };
}

// Trails SL 2/3 of the way towards entry, leaving remaining SL distance at 33.3% (risk-free).
export function calculateRiskFreeStop(trade, spec = {}) {
  const risk = initialTradeRisk(trade);
  if (!risk.distance || risk.distance <= 0) return trade.slPrice;
  const digits = Number(spec?.digits) || (String(risk.entry).split(".")[1]?.length || 5);
  const remainingDistance = risk.distance * (1 / 3);
  const newSl = risk.entry - trade.dir * remainingDistance;
  return Number(newSl.toFixed(digits));
}

// Model 2: Prop-Firm Safe Management Engine
// The TP is short in the range of 1.5R to 2.5R.
// Progression:
// 1. On reaching 1.0R: move SL to half of the original risk (-0.5R risk remaining).
// 2. On reaching 1.5R: move SL to breakeven (entry price).
//    (If TP itself is 1.5R, book full quantity at 1.5R).
// 3. At TP (1.5R to 2.5R): book full quantity.
export function calculatePropFirmTp(entry, sl, dir, preferredRR = 2.0, digits = 5) {
  const risk = Math.abs(entry - sl);
  const targetRR = Math.min(2.5, Math.max(1.5, Number(preferredRR) || 2.0));
  const tp = entry + dir * (risk * targetRR);
  return {
    targetRR,
    tpPrice: Number(tp.toFixed(digits)),
  };
}

/**
 * Master Market Bias Target Resolver.
 * Extracts ALL institutional landmarks analyzed by the Market Bias Engine:
 * 1. Opposing FVGs (Fair Value Gaps): Boundary & Consequent Encroachment (CE = 50% midpoint)
 * 2. Opposing Order Blocks (OBs) & Breaker Blocks: Entry Boundary & Mean Threshold (50% midpoint)
 * 3. HTF Liquidity Pools & Magnets: PDH, PDL, PWH, PWL, 4H EQH (BSL), 4H EQL (SSL), Session Pools
 * 4. Multi-Timeframe Dealing Ranges: H4, H1, M15 Equilibrium (50% EQ), OTE (0.62 / 0.705), Extremes
 * 5. Macro Draw on Liquidity (DOL): Trajectory milestones (50% to DOL, 75% to DOL, 100% DOL)
 *
 * Provides:
 * - allCandidates: Complete institutional target ladder with weights, types, and R-multiples
 * - optimalPropTarget: Highest-probability institutional target strictly within [1.5R, 2.5R]
 */
export function resolveMasterBiasTargetLevels({
  entry,
  sl,
  dir,
  brain = {},
  ranges = {},
  htfFvg = {},
  htfLiq = {},
  evidence = {},
  targets = [],
  dealingRange = null,
  scenario = {},
  targetRR = null,
  digits = 5,
} = {}) {
  const risk = Math.abs(Number(entry) - Number(sl));
  if (!(risk > 0)) {
    const fallbackPrice = Number(entry) || 0;
    return {
      allCandidates: [],
      optimalPropTarget: { targetRR: 2.0, tpPrice: fallbackPrice, source: "fallback_zero_risk", landmarkType: "FALLBACK", tf: "15M", compositeScore: 0 },
      macroRunnerTarget: { targetRR: 5.0, tpPrice: fallbackPrice, source: "fallback_zero_risk" },
    };
  }

  const isProfit = (price) => dir === 1 ? Number(price) > Number(entry) : Number(price) < Number(entry);
  const computeR = (price) => dir * (Number(price) - Number(entry)) / risk;
  const candidates = [];

  const addCandidate = (price, name, type, weight, tf = "4H") => {
    if (!Number.isFinite(Number(price)) || !isProfit(price)) return;
    const r = Math.round(computeR(price) * 100) / 100;
    if (r <= 0) return;
    candidates.push({
      price: Number(Number(price).toFixed(digits)),
      rr: r,
      name,
      type,
      weight,
      tf,
    });
  };

  // 1. OPPOSING FAIR VALUE GAPS (FVGs) & CONSEQUENT ENCROACHMENT (CE 50%)
  const fvgs = [
    ...(htfFvg?.all || []),
    ...(htfFvg?.unmitigated || []),
    ...(brain?.htfFvg?.unmitigated || []),
    ...(evidence?.pd?.fvgs || []),
    ...(evidence?.fvgs || []),
  ];
  for (const f of fvgs) {
    if (f && (f.dir === -dir || f.originalDir === -dir || (f.type && f.type.includes(dir === 1 ? "BEAR" : "BULL")))) {
      const boundary = dir === 1 ? Math.min(Number(f.top), Number(f.bottom)) : Math.max(Number(f.top), Number(f.bottom));
      const ce = Number.isFinite(Number(f.ce)) ? Number(f.ce) : (Number(f.top) + Number(f.bottom)) / 2;
      const tf = f.tf || "4H";
      addCandidate(ce, `${tf} FVG Consequent Encroachment (CE 50%)`, "FVG_CE", 100, tf);
      addCandidate(boundary, `${tf} FVG Entry Boundary`, "FVG_BOUNDARY", 85, tf);
    }
  }

  // 2. OPPOSING ORDER BLOCKS & BREAKER BLOCKS
  const obs = [
    ...(evidence?.pd?.orderBlocks || []),
    ...(evidence?.orderBlocks || []),
    ...(brain?.pd?.orderBlocks || []),
    ...(evidence?.breakers || []),
  ];
  for (const ob of obs) {
    if (ob && (ob.dir === -dir || ob.originalDir === -dir || ob.state === "INVALIDATED")) {
      const obEntry = dir === 1 ? Math.min(Number(ob.top), Number(ob.bottom)) : Math.max(Number(ob.top), Number(ob.bottom));
      const meanThreshold = (Number(ob.top) + Number(ob.bottom)) / 2;
      const isBreaker = ob.state === "INVALIDATED" || ob.type === "BREAKER";
      const tf = ob.tf || "4H";
      const label = isBreaker ? "Breaker Block" : "Order Block";
      addCandidate(meanThreshold, `${tf} ${label} Mean Threshold (50%)`, "OB_MT", 95, tf);
      addCandidate(obEntry, `${tf} ${label} Entry`, "OB_ENTRY", 90, tf);
    }
  }

  // 3. HTF LIQUIDITY POOLS & MAGNETS (PDH, PDL, PWH, PWL, EQH, EQL)
  const liq = htfLiq || brain?.htfLiquidity || {};
  const keyLevels = liq.keyLevels || {};

  if (dir === 1) {
    if (keyLevels.PDH?.price) addCandidate(keyLevels.PDH.price, "PDH (Previous Day High BSL)", "HTF_LIQUIDITY", 95, "D1");
    if (keyLevels.PWH?.price) addCandidate(keyLevels.PWH.price, "PWH (Previous Week High BSL)", "HTF_LIQUIDITY", 98, "W1");
    for (const eq of (liq.eqh || [])) {
      if (eq?.price) addCandidate(eq.price, "4H EQH (Equal Highs Buyside Magnet)", "LIQUIDITY_MAGNET", 96, "H4");
    }
    for (const pool of (liq.pools?.bsl || [])) {
      if (pool?.price) addCandidate(pool.price, pool.name || "Buyside Liquidity Pool", "LIQUIDITY_POOL", 90, pool.tf || "4H");
    }
  } else {
    if (keyLevels.PDL?.price) addCandidate(keyLevels.PDL.price, "PDL (Previous Day Low SSL)", "HTF_LIQUIDITY", 95, "D1");
    if (keyLevels.PWL?.price) addCandidate(keyLevels.PWL.price, "PWL (Previous Week Low SSL)", "HTF_LIQUIDITY", 98, "W1");
    for (const eq of (liq.eql || [])) {
      if (eq?.price) addCandidate(eq.price, "4H EQL (Equal Lows Sellside Magnet)", "LIQUIDITY_MAGNET", 96, "H4");
    }
    for (const pool of (liq.pools?.ssl || [])) {
      if (pool?.price) addCandidate(pool.price, pool.name || "Sellside Liquidity Pool", "LIQUIDITY_POOL", 90, pool.tf || "4H");
    }
  }

  // 4. MULTI-TIMEFRAME DEALING RANGE MILESTONES (EQ, OTE, EXTREMES)
  const rangeMap = ranges?.ranges || ranges || {};
  const tfs = ["M15", "H1", "H4", "D1"];
  for (const tf of tfs) {
    const r = rangeMap[tf] || (tf === "H4" ? dealingRange : null);
    if (!r) continue;
    if (Number.isFinite(r.eq)) {
      addCandidate(r.eq, `${tf} Dealing Range Equilibrium (50% EQ)`, "RANGE_EQ", 92, tf);
    }
    if (Number.isFinite(r.high) && Number.isFinite(r.low)) {
      const ote062 = dir === 1 ? r.low + (r.high - r.low) * 0.62 : r.high - (r.high - r.low) * 0.62;
      const ote0705 = dir === 1 ? r.low + (r.high - r.low) * 0.705 : r.high - (r.high - r.low) * 0.705;
      addCandidate(ote062, `${tf} Range OTE 0.62 Retracement`, "RANGE_OTE", 80, tf);
      addCandidate(ote0705, `${tf} Range OTE 0.705 Sweet Spot`, "RANGE_OTE", 82, tf);
      const extreme = dir === 1 ? r.high : r.low;
      addCandidate(extreme, `${tf} Dealing Range External High/Low`, "RANGE_EXTREME", 88, tf);
    }
  }

  // 5. DRAW ON LIQUIDITY (DOL) TRAJECTORY & MILESTONES
  const dol = brain?.targetDOL || htfLiq?.drawOnLiquidity;
  if (dol?.price != null && isProfit(dol.price)) {
    const dolPrice = Number(dol.price);
    const dolDist = Math.abs(dolPrice - Number(entry));
    addCandidate(dolPrice, `Draw on Liquidity (${dol.name || 'Macro DOL'})`, "MACRO_DOL", 95, dol.tf || "4H");
    addCandidate(Number((Number(entry) + dir * (dolDist * 0.50)).toFixed(digits)), "50% Milestone to Macro DOL", "DOL_MILESTONE", 89, dol.tf || "4H");
    addCandidate(Number((Number(entry) + dir * (dolDist * 0.75)).toFixed(digits)), "75% Milestone to Macro DOL", "DOL_MILESTONE", 87, dol.tf || "4H");
  }

  // 6. TARGETS FROM ENTRY MODELS
  if (Array.isArray(targets)) {
    for (const t of targets) {
      if (t?.price && isProfit(t.price)) {
        addCandidate(t.price, t.source || t.name || t.id || "Structural Target", "STRUCTURAL_LADDER", 85, t.tf || "15M");
      }
    }
  }

  // Deduplicate candidates by point proximity (collapse levels within 0.05R)
  const uniqueCandidates = [];
  candidates.sort((a, b) => dir === 1 ? a.price - b.price : b.price - a.price);
  for (const c of candidates) {
    const existing = uniqueCandidates.find((u) => Math.abs(u.rr - c.rr) <= 0.05);
    if (!existing) {
      uniqueCandidates.push(c);
    } else if (c.weight > existing.weight) {
      Object.assign(existing, c);
    }
  }

  // 7. RESOLVE OPTIMAL PROP-FIRM SAFE TP WITHIN [1.5R, 2.5R]
  const propQualifiers = uniqueCandidates.filter((c) => c.rr >= 1.48 && c.rr <= 2.52);

  let optimalProp = null;
  if (propQualifiers.length > 0) {
    const scored = propQualifiers.map((c) => {
      const proximityPenalty = Math.abs(c.rr - 2.0) * 15;
      return {
        ...c,
        compositeScore: c.weight - proximityPenalty,
      };
    });
    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    const best = scored[0];
    const clampedRR = Math.min(2.5, Math.max(1.5, best.rr));
    const tpPrice = clampedRR !== best.rr
      ? Number((Number(entry) + dir * (risk * clampedRR)).toFixed(digits))
      : best.price;
    optimalProp = {
      targetRR: clampedRR,
      tpPrice,
      source: best.name,
      landmarkType: best.type,
      tf: best.tf,
      compositeScore: Math.round(best.compositeScore),
    };
  } else {
    // Horizon-tailored fallback
    let baseRR = 2.0;
    const horizonId = String(scenario?.id || scenario?.horizon || "").toLowerCase();
    if (horizonId.includes("scalp") || horizonId.includes("1m") || scenario?.horizonCode === 3) baseRR = 1.75;
    else if (horizonId.includes("swing") || horizonId.includes("1d") || scenario?.horizonCode === 1) baseRR = 2.5;
    else if (targetRR != null && Number.isFinite(Number(targetRR))) baseRR = Math.min(2.5, Math.max(1.5, Number(targetRR)));

    const clampedRR = Math.min(2.5, Math.max(1.5, Math.round(baseRR * 100) / 100));
    const tpPrice = Number((Number(entry) + dir * (risk * clampedRR)).toFixed(digits));
    optimalProp = {
      targetRR: clampedRR,
      tpPrice,
      source: "Horizon Bracket Baseline",
      landmarkType: "HORIZON_DEFAULT",
      tf: scenario?.tf || "15M",
      compositeScore: 70,
    };
  }

  return {
    allCandidates: uniqueCandidates,
    optimalPropTarget: optimalProp,
  };
}

export function resolveDynamicPropFirmTarget(params = {}) {
  const resolved = resolveMasterBiasTargetLevels(params);
  return resolved.optimalPropTarget;
}

export function evaluatePropFirmSafeAction(trade, currentPrice, unrealizedR, spec = {}) {
  const risk = initialTradeRisk(trade);
  if (!risk.distance || risk.distance <= 0) return null;
  const digits = Number(spec?.digits) || (String(risk.entry).split(".")[1]?.length || 5);
  const r = Number(unrealizedR ?? (markToMarket(trade, currentPrice).unrealizedR || 0));
  const targetRR = Math.min(2.5, Math.max(1.5, Number(trade.targetRR || 2.0)));

  // Stage 3: Target Hit (1.5R - 2.5R) -> Full Exit
  const tpPrice = trade.tpPrice || Number((risk.entry + trade.dir * (risk.distance * targetRR)).toFixed(digits));
  const hitTp = trade.dir === 1 ? currentPrice >= tpPrice : currentPrice <= tpPrice;
  if (hitTp || r >= targetRR) {
    return {
      action: "exit_full_tp",
      rule: "prop_firm_target_exit",
      reason: `Target reached at ${targetRR}R: booked full quantity`,
    };
  }

  // Stage 2: At 1.5R -> Move SL to Breakeven (or full exit if TP is 1.5R)
  if (r >= 1.5) {
    if (targetRR <= 1.55) {
      return {
        action: "exit_full_tp",
        rule: "prop_firm_1.5R_full_tp",
        reason: "Reaching 1.5R: TP target reached, booked full quantity",
      };
    }
    if (!trade.isBreakeven) {
      const beSl = breakevenPrice(trade, spec);
      const isBetter = trade.dir === 1 ? beSl > trade.slPrice : beSl < trade.slPrice;
      if (isBetter) {
        return {
          action: "breakeven",
          newSl: beSl,
          targetR: 1.5,
          rule: "prop_firm_1.5R_breakeven",
          reason: "Reaching 1.5R: moved stop-loss to Breakeven",
        };
      }
    }
  }

  // Stage 1: At 1.0R -> Move SL to half of original risk (reduce risk by 50% to -0.5R)
  if (r >= 1.0 && !trade.slHalfMoved && !trade.isBreakeven) {
    const halfRiskDistance = risk.distance * 0.5;
    const newSl = Number((risk.entry - trade.dir * halfRiskDistance).toFixed(digits));
    const isBetter = trade.dir === 1 ? newSl > trade.slPrice : newSl < trade.slPrice;
    if (isBetter) {
      return {
        action: "reduce_sl_half",
        newSl,
        targetR: 1.0,
        rule: "prop_firm_1R_half_risk",
        reason: "Reaching 1.0R: reduced stop-loss risk by 50% (-0.5R risk remaining)",
      };
    }
  }

  return null;
}

// Simplified Trade Management Engine:
// Calculates the 50% target milestone for any trade setup (whatever the target is).
// When price reaches 50% of the target distance / R:
// Books 40% quantity, moves Stop Loss to Breakeven, leaves 60% runner to main TP.
export function calculateHalfTargetLevel(trade) {
  const entry = Number(trade.filledPrice || trade.entryPrice);
  const risk = initialTradeRisk(trade);
  const targetRR = Number(trade.targetRR || (risk.distance > 0 && trade.tpPrice ? Math.abs(trade.tpPrice - entry) / risk.distance : 2.0));
  const halfRR = Number((targetRR * 0.5).toFixed(2));

  let halfPrice = null;
  if (Number.isFinite(trade.tpPrice) && Number.isFinite(entry)) {
    halfPrice = entry + trade.dir * Math.abs(trade.tpPrice - entry) * 0.5;
  } else if (risk.distance > 0) {
    halfPrice = entry + trade.dir * (risk.distance * halfRR);
  }
  const digits = Number(trade.symbolSpec?.digits || 5);
  return {
    halfRR,
    price: halfPrice != null ? Number(halfPrice.toFixed(digits)) : null,
  };
}

// Split position into partial booking (default 40%) and runner (default 60%)
export function planFractionalVolumes(initialVolume, spec = {}, fraction = 0.40) {
  const step = Number(spec?.volume_step) || Number(spec?.lot_step) || 0.01;
  const minLot = Number(spec?.volume_min) || Number(spec?.min_lot) || 0.01;
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const vol = Number(initialVolume);
  if (!(vol > 0)) return null;

  let partial = Math.floor((vol * fraction + 1e-8) / step) * step;
  partial = Number(partial.toFixed(digits));
  if (partial < minLot) partial = minLot;

  const runner = Number((vol - partial).toFixed(digits));
  if (runner < minLot) {
    return { tp1: 0, runner: vol };
  }
  return { tp1: partial, runner };
}

// Precise classification for terminal status (including closed_be for breakeven trades)
export function determineTerminalStatus(trade, realizedR, exitReason = "") {
  const r = Number.isFinite(realizedR) ? realizedR : Number(trade.realizedR || 0);
  if (exitReason === "tp" || exitReason === "target" || exitReason === "runner" || exitReason === "legacy_target" || exitReason === "full_tp_5R") {
    return r >= -0.05 ? "closed_tp" : "closed_sl";
  }
  if (r >= -0.05 && (exitReason === "breakeven" || exitReason === "risk_free" || ((trade.isBreakeven || trade.isRiskFree || trade.halfTargetBooked) && ["stop", "sl", "breakeven"].includes(exitReason)))) {
    return "closed_be";
  }
  if (trade.isBreakeven || trade.isRiskFree) {
    if (Math.abs(r) <= 0.05 || (r >= -0.05 && r <= 1.5)) {
      return "closed_be";
    }
  }
  if (Math.abs(r) <= 0.05) {
    return "closed_be";
  }
  if (r > 0.05) {
    return "closed_tp";
  }
  return "closed_sl";
}

export function confirmedTrailPrice(trade, bars, now = Date.now(), tfSeconds = 300) {
  // Exclude the forming candle before applying a symmetric five-bar fractal.
  const closed = (bars || []).filter((b) => Number(b.time) * 1000 + tfSeconds * 1000 <= Number(now));
  const fractals = confirmedFractals(closed, 5);
  const points = trade.dir === 1 ? fractals.lows : fractals.highs;
  const price = points?.at(-1)?.price;
  if (!Number.isFinite(price)) return null;
  return trade.dir === 1 ? (price > trade.slPrice ? price : null) : (price < trade.slPrice ? price : null);
}
