// Entry Model Decision Engine (Cognitive Entry & Structural Zone Arbiter)
// Subsystem peer of the Market Brain dedicated strictly to Entry Model Decision,
// Dealing Range Depth Arbitration, Extreme vs Shallow Evaluation, and Anti-Shallow Trap protection.

import { confirmedFractals, displacementAt, detectPDArrays, detectLiquidityRaids } from "../bias/institutional.js";
import { getCurrentTimeSlot, getStartOfTradingDay, getEetTime } from "./timeslots.js";
import { canonOf } from "./symbols.js";

const finite = (v) => v != null && Number.isFinite(Number(v));
const side = (dir, a, b) => (dir === 1 ? a > b : a < b);
const opposite = (dir, a, b) => (dir === 1 ? a < b : a > b);
const timeOf = (b) => Number(b?.time ?? b?.t) * (Number(b?.time ?? b?.t) < 1e11 ? 1000 : 1);

export function symbolUnits(symbol, config = {}) {
  const meta = config.symbolMeta?.[symbol] || config.symbolMeta?.[canonOf(symbol)] || config.brokerMeta?.[symbol] || config.symbolMeta || {};
  const canonical = canonOf(symbol);
  const category = /^(US30|NAS100|US500|GER40|UK100|JP225)/.test(canonical)
    ? "index"
    : /^(XAUUSD|XAGUSD)/.test(canonical)
      ? "metal"
      : /^(BTC|ETH)/.test(canonical)
        ? "crypto"
        : /^[A-Z]{6}$/.test(canonical)
          ? "fx"
          : "unknown";
  const canonicalPip = category === "fx" ? (canonical.endsWith("JPY") ? 0.01 : 0.0001) : canonical === "XAUUSD" ? 0.1 : canonical === "XAGUSD" ? 0.01 : category === "index" || category === "crypto" ? 1 : null;
  const pip = Number(meta.pipSize ?? meta.pip ?? meta.analysisUnit ?? canonicalPip);
  const point = Number(meta.point ?? meta.pointSize ?? meta.tickSize ?? (meta.digits != null ? 10 ** -Number(meta.digits) : canonicalPip));
  const spread = Number(config.spreadPrice ?? meta.spreadPrice ?? (finite(meta.spreadPoints) ? meta.spreadPoints * point : 0));
  return { category, pip: pip > 0 ? pip : null, point: point > 0 ? point : null, spread: Math.max(0, spread), unitLabel: category === "fx" ? "pip" : "price point", digits: meta.digits };
}

/**
 * Extracts causal major HTF levels (PDH, PDL, Session Extremes).
 */
export function extractMajorLevels(frames = {}, now = Date.now()) {
  const levels = [];
  const today = getStartOfTradingDay(new Date(now));
  const d1 = frames.D1 || [];
  const previous = d1.filter((b) => (b.closeTime ? b.closeTime * 1000 : timeOf(b) + 86400000) <= today).at(-1);
  if (previous) {
    const confirmationTime = previous.closeTime ?? previous.time + 86400;
    levels.push(
      { id: `PDH:${previous.time}`, name: "PDH", price: previous.high, side: 1, confirmationTime, major: true, type: "PDH" },
      { id: `PDL:${previous.time}`, name: "PDL", price: previous.low, side: -1, confirmationTime, major: true, type: "PDL" }
    );
  }
  const m15 = frames.M15 || [];
  const groups = new Map();
  const sessions = [{ name: "ASIA", start: 120, end: 480 }, { name: "LONDON", start: 600, end: 900 }, { name: "NY", start: 900, end: 1380 }];
  for (const b of m15) {
    const minute = getEetTime(new Date(timeOf(b))).totalMinutes;
    const session = sessions.find((s) => minute >= s.start && minute < s.end);
    if (!session) continue;
    const day = getStartOfTradingDay(new Date(timeOf(b)));
    const key = `${day}:${session.name}`;
    if (!groups.has(key)) groups.set(key, { session, day, bars: [] });
    groups.get(key).bars.push(b);
  }
  for (const [key, group] of groups) {
    const last = group.bars.at(-1);
    const closedMinute = getEetTime(new Date((last.closeTime ?? last.time + 900) * 1000)).totalMinutes;
    const expected = (group.session.end - group.session.start) / 15;
    if (group.bars.length !== expected || getEetTime(new Date(timeOf(group.bars[0]))).totalMinutes !== group.session.start ||
      group.bars.some((b, i) => i && b.time - group.bars[i - 1].time !== 900)) continue;
    if (closedMinute !== group.session.end || (last.closeTime ?? last.time + 900) * 1000 > now) continue;
    const confirmationTime = last.closeTime ?? last.time + 900;
    levels.push(
      { id: `${key}:HIGH`, name: `${group.session.name} High`, price: Math.max(...group.bars.map((b) => b.high)), side: 1, confirmationTime, major: true, session: group.session.name, type: "SESSION_HIGH" },
      { id: `${key}:LOW`, name: `${group.session.name} Low`, price: Math.min(...group.bars.map((b) => b.low)), side: -1, confirmationTime, major: true, session: group.session.name, type: "SESSION_LOW" }
    );
  }
  return levels;
}

/**
 * Extracts all HTF Extreme and Anchor Levels across frames, dealing ranges, and liquidity pools.
 */
export function extractHtfAnchorLevels({ frames = {}, ranges = {}, brain = {}, dir = 1, config = {}, now = Date.now() }) {
  const anchors = [];
  const majors = extractMajorLevels(frames, now);
  anchors.push(...majors);

  // 1. Dealing Range Boundaries & EQ
  const range = brain.dealingRange || ranges?.ranges?.H4 || ranges?.H4 || ranges?.ranges?.D1 || ranges?.D1;
  if (range && finite(range.high) && finite(range.low) && range.high > range.low) {
    anchors.push(
      { id: "RANGE_HIGH", name: "Dealing Range High", price: Number(range.high), side: 1, major: true, type: "RANGE_EXTREME" },
      { id: "RANGE_LOW", name: "Dealing Range Low", price: Number(range.low), side: -1, major: true, type: "RANGE_EXTREME" },
      { id: "RANGE_EQ", name: "Dealing Range EQ (50%)", price: Number(range.eq ?? (range.high + range.low) / 2), side: 0, major: false, type: "RANGE_EQ" }
    );
  }

  // 2. HTF Order Blocks (H4 & D1)
  for (const tf of ["D1", "H4"]) {
    const bars = frames[tf];
    if (bars?.length >= 10) {
      const pd = detectPDArrays(bars, { tf });
      const eligibleObs = (pd?.orderBlocks || []).filter((ob) => ob.dir === dir && ["VIRGIN", "PARTIALLY_MITIGATED"].includes(String(ob.state || "").toUpperCase()));
      for (const ob of eligibleObs) {
        anchors.push({
          id: ob.id || `${tf}:OB:${ob.dir}`,
          name: `${tf} Order Block`,
          price: Number(ob.mt ?? (ob.top + ob.bottom) / 2),
          top: Math.max(ob.top, ob.bottom),
          bottom: Math.min(ob.top, ob.bottom),
          side: -dir, // Support zone for longs, Resistance zone for shorts
          major: true,
          type: "HTF_OB",
          tf,
        });
      }
      const eligibleFvgs = (pd?.fvgs || []).filter((g) => g.dir === dir && ["VIRGIN", "PARTIALLY_MITIGATED"].includes(String(g.state || "").toUpperCase()));
      for (const fvg of eligibleFvgs) {
        anchors.push({
          id: fvg.id || `${tf}:FVG:${fvg.dir}`,
          name: `${tf} Fair Value Gap`,
          price: Number(fvg.ce ?? (fvg.top + fvg.bottom) / 2),
          top: Math.max(fvg.top, fvg.bottom),
          bottom: Math.min(fvg.top, fvg.bottom),
          side: -dir,
          major: true,
          type: "HTF_FVG",
          tf,
        });
      }
    }
  }

  // 3. Liquidity Pools & Key Levels from Brain
  const rawPools = brain.htfLiquidity?.pools;
  const poolList = Array.isArray(rawPools)
    ? rawPools
    : [...(rawPools?.bsl || []), ...(rawPools?.ssl || [])];
  const eqHighs = Array.isArray(brain.htfLiquidity?.equalHighs)
    ? brain.htfLiquidity.equalHighs
    : (Array.isArray(brain.htfLiquidity?.eqh) ? brain.htfLiquidity.eqh : []);
  const eqLows = Array.isArray(brain.htfLiquidity?.equalLows)
    ? brain.htfLiquidity.equalLows
    : (Array.isArray(brain.htfLiquidity?.eql) ? brain.htfLiquidity.eql : []);

  const pools = [
    ...poolList,
    ...eqHighs.map((p) => ({ ...p, side: 1, price: p.price ?? p.level })),
    ...eqLows.map((p) => ({ ...p, side: -1, price: p.price ?? p.level })),
    ...Object.values(brain.htfLiquidity?.keyLevels || {}).map((l) => ({
      ...l,
      side: l?.side === "BSL" || l?.type === "SWING_HIGH" ? 1 : l?.side === "SSL" || l?.type === "SWING_LOW" ? -1 : l?.side,
    })),
  ].filter((p) => p && finite(p.price) && [1, -1].includes(Number(p.side)));

  for (const pool of pools) {
    anchors.push({
      id: pool.id || `POOL:${pool.side}:${pool.price}`,
      name: pool.name || (pool.side === 1 ? "Buy-Side Liquidity Pool" : "Sell-Side Liquidity Pool"),
      price: Number(pool.price),
      side: Number(pool.side),
      major: true,
      type: "LIQUIDITY_POOL",
    });
  }

  return anchors;
}

/**
 * Lens 1: Dealing Range Location & Extreme Depth Evaluator (0 to 30 pts)
 */
export function evaluateZoneDepth({ entry, sl, dir, range, evidence }) {
  if (!range || !finite(range.high) || !finite(range.low) || range.high <= range.low || !finite(entry)) {
    return { depthPct: 50, depthTier: "UNKNOWN", locationScore: 15, locationTag: "UNANCHORED_RANGE" };
  }

  const span = range.high - range.low;
  const raidExtreme = evidence?.raid?.extreme;
  let depthPct = 50;

  if (dir === 1) {
    depthPct = ((entry - range.low) / span) * 100;
    const extremeBreach = finite(raidExtreme) && raidExtreme <= range.low;
    const entryBreach = entry <= range.low;

    if (entryBreach || extremeBreach) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EXTREME_SWEEP_DISCOUNT", locationScore: 30, locationTag: "EXTREME_DISCOUNT_SWEEP", isExtreme: true };
    }
    if (depthPct <= 20.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EXTREME_DISCOUNT", locationScore: 28, locationTag: "EXTREME_DISCOUNT", isExtreme: true };
    }
    if (depthPct <= 40.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "DEEP_DISCOUNT_OTE", locationScore: 24, locationTag: "DEEP_DISCOUNT_OTE", isDeep: true };
    }
    if (depthPct <= 55.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EQUILIBRIUM_FAIR_VALUE", locationScore: 16, locationTag: "EQUILIBRIUM_FAIR_VALUE", isShallow: depthPct > 40 };
    }
    return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "PREMIUM_CHOP", locationScore: 0, locationTag: "PREMIUM_BUY_PENALTY", isPremiumChop: true };
  } else {
    depthPct = ((range.high - entry) / span) * 100;
    const extremeBreach = finite(raidExtreme) && raidExtreme >= range.high;
    const entryBreach = entry >= range.high;

    if (entryBreach || extremeBreach) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EXTREME_SWEEP_PREMIUM", locationScore: 30, locationTag: "EXTREME_PREMIUM_SWEEP", isExtreme: true };
    }
    if (depthPct <= 20.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EXTREME_PREMIUM", locationScore: 28, locationTag: "EXTREME_PREMIUM", isExtreme: true };
    }
    if (depthPct <= 40.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "DEEP_PREMIUM_OTE", locationScore: 24, locationTag: "DEEP_PREMIUM_OTE", isDeep: true };
    }
    if (depthPct <= 55.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EQUILIBRIUM_FAIR_VALUE", locationScore: 16, locationTag: "EQUILIBRIUM_FAIR_VALUE", isShallow: depthPct > 40 };
    }
    return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "DISCOUNT_CHOP", locationScore: 0, locationTag: "DISCOUNT_SELL_PENALTY", isDiscountChop: true };
  }
}

/**
 * Lens 2: HTF Anchor Confluence Evaluator (0 to 25 pts)
 */
export function evaluateHtfAnchor({ entry, zoneLow, zoneHigh, dir, anchors = [], units }) {
  const zLow = finite(zoneLow) ? zoneLow : entry;
  const zHigh = finite(zoneHigh) ? zoneHigh : entry;
  const buffer = units.pip ? units.pip * 5 : units.point ? units.point * 50 : 0.0005;

  let bestAnchor = null;
  let bestScore = 4;
  let anchorTag = "LOCAL_INTRADAY_ONLY";

  for (const anchor of anchors) {
    if (!finite(anchor.price)) continue;
    const overlaps = (anchor.price >= zLow - buffer && anchor.price <= zHigh + buffer) ||
      (anchor.top && anchor.bottom && zLow <= anchor.top + buffer && zHigh >= anchor.bottom - buffer);

    if (overlaps) {
      let score = 10;
      let tag = "STRUCTURAL_ANCHOR";

      if (anchor.type === "PDL" || anchor.type === "PDH" || anchor.type === "SESSION_LOW" || anchor.type === "SESSION_HIGH") {
        score = 25;
        tag = `MAJOR_${anchor.type}_ANCHOR`;
      } else if (anchor.type === "HTF_OB") {
        score = 22;
        tag = "HTF_ORDER_BLOCK_ANCHOR";
      } else if (anchor.type === "LIQUIDITY_POOL") {
        score = 20;
        tag = "HTF_LIQUIDITY_POOL_ANCHOR";
      } else if (anchor.type === "HTF_FVG") {
        score = 18;
        tag = "HTF_FVG_ANCHOR";
      } else if (anchor.type === "RANGE_EXTREME") {
        score = 24;
        tag = "RANGE_EXTREME_ANCHOR";
      } else if (anchor.type === "RANGE_EQ") {
        score = 12;
        tag = "RANGE_EQ_ANCHOR";
      }

      if (score > bestScore) {
        bestScore = score;
        bestAnchor = anchor;
        anchorTag = tag;
      }
    }
  }

  return { anchorScore: bestScore, bestAnchor, anchorTag };
}

/**
 * Lens 3: Model-to-Context Fitness Matrix (0 to 20 pts)
 */
export function evaluateModelFitness({ modelId, depthTier, isExtreme, isDeep, isShallow, evidence, dir }) {
  const mId = String(modelId || "").toLowerCase();
  let fitnessScore = 10;
  let fitnessTag = "STANDARD_FITNESS";

  if (mId === "turtle_soup") {
    // Turtle soup is specifically designed for external raids at extremes
    if (isExtreme || depthTier === "EXTREME_SWEEP_DISCOUNT" || depthTier === "EXTREME_SWEEP_PREMIUM") {
      fitnessScore = 20;
      fitnessTag = "TURTLE_SOUP_PREMIER_EXTREME_RAID";
    } else if (isDeep) {
      fitnessScore = 15;
      fitnessTag = "TURTLE_SOUP_DEEP_POOL_RAID";
    } else {
      fitnessScore = 6;
      fitnessTag = "TURTLE_SOUP_SHALLOW_CHOP_RISK";
    }
  } else if (mId === "breaker_block") {
    // Breaker blocks are displacement flips after opposing order block failure
    if (evidence?.failedOrderBlock && evidence?.displacement?.valid) {
      fitnessScore = 20;
      fitnessTag = "BREAKER_DISPLACED_STRUCTURE_FLIP";
    } else if (isExtreme || isDeep) {
      fitnessScore = 18;
      fitnessTag = "BREAKER_DEEP_KEYLEVEL_MITIGATION";
    } else {
      fitnessScore = 12;
      fitnessTag = "BREAKER_MID_RANGE_FLIP";
    }
  } else if (mId === "ote_continuation") {
    // OTE is specifically designed for the 0.618 - 0.786 deep discount/premium pocket
    if (isDeep || (depthTier?.includes("OTE") || depthTier === "DEEP_DISCOUNT_OTE" || depthTier === "DEEP_PREMIUM_OTE")) {
      fitnessScore = 20;
      fitnessTag = "OTE_PERFECT_FIBONACCI_POCKET";
    } else if (isExtreme) {
      fitnessScore = 16;
      fitnessTag = "OTE_EXTREME_DISCOUNT_POCKET";
    } else {
      fitnessScore = 8;
      fitnessTag = "OTE_SHALLOW_RETRACEMENT_RISK";
    }
  } else if (mId === "ict_2022") {
    // ICT 2022 Mentorship model: Sweep + displaced MSS + FVG CE
    if (isExtreme || isDeep) {
      fitnessScore = 18;
      fitnessTag = "ICT2022_DEEP_VALUE_DISPLACEMENT";
    } else if (isShallow) {
      fitnessScore = 12;
      fitnessTag = "ICT2022_SHALLOW_EXPANSION";
    } else {
      fitnessScore = 6;
      fitnessTag = "ICT2022_EQUILIBRIUM_CHOP";
    }
  } else if (mId === "silver_bullet") {
    fitnessScore = 20;
    fitnessTag = "SILVER_BULLET_WINDOW_TIMING";
  }

  return { fitnessScore, fitnessTag };
}

/**
 * Lens 4: Impending Extreme & Shallow Trap Detector (Anti-Shallow Trap Arbiter)
 * Detects if a shallow candidate is attempting to fire right ahead of an unmitigated HTF extreme.
 */
export function detectShallowTrap({ candidate, anchors = [], dir, isShallow, isExtreme, units, config = {} }) {
  if (isExtreme) {
    return {
      shallowTrap: false,
      trapWarning: null,
      trapPenalty: 0,
      extremeBonus: 15,
      isExtremeSetup: true,
      sovereigntyTag: "EXTREME_ZONE_SOVEREIGNTY",
    };
  }

  const entry = candidate.entry;
  const sl = candidate.sl;
  const risk = Math.abs(entry - sl);

  // Look for unmitigated HTF extremes lying in the retracement path between entry and stop
  const impendingExtremes = anchors.filter((a) => {
    if (!a.major || !finite(a.price)) return false;
    if (dir === 1) {
      // For Longs: Extreme lies BELOW entry and in danger path before/at stop
      const belowEntry = a.price < entry;
      const inDangerZone = (a.price >= sl - (risk * 0.25) && a.price <= entry) || (Math.abs(entry - a.price) <= risk * 1.5 && a.price >= sl);
      return belowEntry && inDangerZone && ["PDL", "SESSION_LOW", "RANGE_EXTREME", "HTF_OB", "LIQUIDITY_POOL"].includes(a.type);
    } else {
      // For Shorts: Extreme lies ABOVE entry and in danger path before/at stop
      const aboveEntry = a.price > entry;
      const inDangerZone = (a.price <= sl + (risk * 0.25) && a.price >= entry) || (Math.abs(a.price - entry) <= risk * 1.5 && a.price <= sl);
      return aboveEntry && inDangerZone && ["PDH", "SESSION_HIGH", "RANGE_EXTREME", "HTF_OB", "LIQUIDITY_POOL"].includes(a.type);
    }
  });

  if (isShallow && impendingExtremes.length > 0) {
    const primaryLooming = impendingExtremes[0];
    const distPips = units.pip ? Math.round(Math.abs(entry - primaryLooming.price) / units.pip) : null;
    const trapWarning = `Impending HTF Extreme (${primaryLooming.name} @ ${primaryLooming.price}${distPips ? ` - ${distPips} pips deeper` : ""}) lies in retracement path before stop`;

    return {
      shallowTrap: true,
      trapWarning,
      trapPenalty: 25, // -25 pts penalty to avoid shallow traps
      impendingExtreme: primaryLooming,
      extremeBonus: 0,
      isExtremeSetup: false,
      sovereigntyTag: "SHALLOW_TRAP_AHEAD_OF_EXTREME",
    };
  }

  return {
    shallowTrap: false,
    trapWarning: null,
    trapPenalty: 0,
    extremeBonus: 0,
    isExtremeSetup: false,
    sovereigntyTag: "CLEAN_PATH_RETRACEMENT",
  };
}

/**
 * Lens 5: Displacement & Rejection Anatomy (0 to 15 pts)
 */
export function evaluateDisplacementAndRejection({ evidence, dir }) {
  let score = 5;
  const disp = evidence?.displacement || evidence?.mss?.displacement || evidence?.impulse?.displacement;
  if (disp?.valid) {
    score = 10;
    if (disp?.bodyRatio > 0.65) score += 3;
  }
  const raid = evidence?.raid;
  if (raid?.extreme && raid?.levelPrice) {
    score = Math.min(15, score + 2);
  }
  return { displacementScore: Math.min(15, score) };
}

/**
 * Lens 6: Timing & SMT Confluence (0 to 10 pts)
 */
export function evaluateTimingAndSmt({ brain = {}, now = Date.now(), dir }) {
  const slot = getCurrentTimeSlot(new Date(now));
  let score = 0;
  if (slot?.isKillzone) score += 5;
  const smt = brain?.smtEvidence?.some((x) => x.dir === dir && x.confirmed !== false);
  if (smt) score += 5;
  return { timingScore: score, isKillzone: Boolean(slot?.isKillzone), hasSmt: Boolean(smt) };
}

/**
 * Entry Model Decision Engine Core: Evaluates, scores, ranks, and arbitrates competing entry models.
 */
export function evaluateEntryModelDecisionEngine({
  candidates = [],
  symbol,
  dir,
  scenario,
  frames = {},
  ranges = {},
  targetDOL,
  brain = {},
  config = {},
  now = Date.now(),
}) {
  if (!candidates.length || ![1, -1].includes(dir)) return null;

  const units = symbolUnits(symbol, config);
  const range = brain.dealingRange || ranges?.ranges?.H4 || ranges?.H4 || ranges?.ranges?.D1 || ranges?.D1;
  const anchors = extractHtfAnchorLevels({ frames, ranges, brain, dir, config, now });

  const evaluated = candidates.map((cand) => {
    // 1. Zone Depth & Location
    const location = evaluateZoneDepth({
      entry: cand.entry,
      sl: cand.sl,
      dir,
      range,
      evidence: cand.evidence,
    });

    // 2. HTF Anchor Confluence
    const anchor = evaluateHtfAnchor({
      entry: cand.entry,
      zoneLow: cand.evidence?.zoneLow ?? cand.entry,
      zoneHigh: cand.evidence?.zoneHigh ?? cand.entry,
      dir,
      anchors,
      units,
    });

    // 3. Model-to-Context Fitness
    const fitness = evaluateModelFitness({
      modelId: cand.modelId || cand.id,
      depthTier: location.depthTier,
      isExtreme: location.isExtreme,
      isDeep: location.isDeep,
      isShallow: location.isShallow,
      evidence: cand.evidence,
      dir,
    });

    // 4. Impending Extreme & Shallow Trap Detector
    const trap = detectShallowTrap({
      candidate: cand,
      anchors,
      dir,
      isShallow: location.isShallow,
      isExtreme: location.isExtreme,
      units,
      config,
    });

    // 5. Displacement & Rejection Anatomy
    const displacement = evaluateDisplacementAndRejection({
      evidence: cand.evidence,
      dir,
    });

    // 6. Timing & SMT
    const timing = evaluateTimingAndSmt({
      brain,
      now,
      dir,
    });

    // Veto check for shallow trap under strict extreme mode
    if (config.strictExtremePreference === true && trap.shallowTrap) {
      cand.permitted = false;
      cand.vetoes = cand.vetoes || [];
      if (!cand.vetoes.some((v) => v.code === "SHALLOW_AHEAD_OF_EXTREME")) {
        cand.vetoes.push({
          code: "SHALLOW_AHEAD_OF_EXTREME",
          reason: trap.trapWarning,
        });
      }
    }

    const timeAffinityBonus = Number(cand.timeSlotAffinity || 0) > 0 ? Math.min(15, Math.round(Number(cand.timeSlotAffinity) * 0.3)) : 0;

    // Composite Structural Zone Score (0 to 100)
    const rawZoneScore =
      location.locationScore +
      anchor.anchorScore +
      fitness.fitnessScore +
      displacement.displacementScore +
      timing.timingScore +
      timeAffinityBonus +
      trap.extremeBonus -
      trap.trapPenalty;

    const zoneScore = Math.max(5, Math.min(100, Math.round(rawZoneScore)));

    // Balanced Structural Expectancy Score:
    // Balances high-probability structural zone with realistic R:R.
    // Clamped between 1.2R and 2.5R so noisy tight stops cannot overpower pristine 95-score Extreme zones!
    const effectiveRRMultiplier = Math.min(2.5, Math.max(1.2, cand.rr || 1.8));
    const expectancyScore = Number((zoneScore * effectiveRRMultiplier).toFixed(2));

    const zoneGrade =
      zoneScore >= 85 ? "A+" : zoneScore >= 70 ? "A" : zoneScore >= 55 ? "B" : "C";

    const zoneBreakdown = {
      locationScore: location.locationScore,
      depthTier: location.depthTier,
      depthPct: location.depthPct,
      anchorScore: anchor.anchorScore,
      anchorTag: anchor.anchorTag,
      fitnessScore: fitness.fitnessScore,
      fitnessTag: fitness.fitnessTag,
      displacementScore: displacement.displacementScore,
      timingScore: timing.timingScore,
      extremeBonus: trap.extremeBonus,
      trapPenalty: trap.trapPenalty,
      shallowTrap: trap.shallowTrap,
      trapWarning: trap.trapWarning,
      isExtremeSetup: trap.isExtremeSetup,
    };

    return {
      ...cand,
      zoneScore,
      expectancyScore,
      zoneGrade,
      zoneBreakdown,
      depthTier: location.depthTier,
      depthPct: location.depthPct,
      isExtremeSetup: trap.isExtremeSetup,
      shallowTrap: trap.shallowTrap,
      trapWarning: trap.trapWarning,
    };
  });

  // Structural Zone Arbitration Ranking:
  // 1. Permitted status first (Vetoes honored)
  // 2. Zone Score (Structural excellence & Extreme vs Shallow depth)
  // 3. Expectancy Score (Balanced quality × R:R)
  // 4. Confluence Score
  // 5. Raw R:R (Last-resort tie-breaker only!)
  evaluated.sort(
    (a, b) =>
      Number(b.permitted) - Number(a.permitted) ||
      (b.zoneScore || 0) - (a.zoneScore || 0) ||
      (b.expectancyScore || 0) - (a.expectancyScore || 0) ||
      (b.confluenceScore || 0) - (a.confluenceScore || 0) ||
      (b.rr || 0) - (a.rr || 0) ||
      String(a.id || "").localeCompare(String(b.id || ""))
  );

  const primary = evaluated[0];
  return {
    ...primary,
    allCandidates: evaluated,
    candidateCount: evaluated.length,
    decisionEngine: {
      arbitratedWinner: primary.id,
      winnerZoneScore: primary.zoneScore,
      winnerGrade: primary.zoneGrade,
      winnerTier: primary.depthTier,
      shallowTrapDetected: evaluated.some((c) => c.shallowTrap),
    },
  };
}
