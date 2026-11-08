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
    if (bars?.length >= 5) {
      const pd = detectPDArrays(bars, { tf });
      const eligibleObs = (pd?.orderBlocks || []).filter((ob) => ob.dir === dir && ["VIRGIN", "PARTIALLY_MITIGATED", "RESPECTED"].includes(String(ob.state || "").toUpperCase()));
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
      const eligibleFvgs = (pd?.fvgs || []).filter((g) => g.dir === dir && ["VIRGIN", "PARTIALLY_MITIGATED", "RESPECTED"].includes(String(g.state || "").toUpperCase()));
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
      const eligibleBreakers = (pd?.breakers || []).filter((b) => b.dir === dir && ["ACTIVE_BREAKER", "RESPECTED"].includes(String(b.state || "").toUpperCase()));
      for (const brk of eligibleBreakers) {
        anchors.push({
          id: brk.id || `${tf}:BREAKER:${brk.dir}`,
          name: `${tf} Breaker Block`,
          price: Number(brk.mt ?? (brk.top + brk.bottom) / 2),
          top: Math.max(brk.top, brk.bottom),
          bottom: Math.min(brk.top, brk.bottom),
          side: -dir,
          major: true,
          type: "HTF_BREAKER",
          tf,
        });
      }
      const eligibleIfvgs = (pd?.ifvgs || []).filter((g) => g.dir === dir && !["INVALIDATED", "RECLAIMED"].includes(String(g.state || "").toUpperCase()));
      for (const ifvg of eligibleIfvgs) {
        anchors.push({
          id: ifvg.id || `${tf}:IFVG:${ifvg.dir}`,
          name: `${tf} Inverse Fair Value Gap (iFVG)`,
          price: Number(ifvg.ce ?? (ifvg.top + ifvg.bottom) / 2),
          top: Math.max(ifvg.top, ifvg.bottom),
          bottom: Math.min(ifvg.top, ifvg.bottom),
          side: -dir,
          major: true,
          type: "HTF_IFVG",
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
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EXTREME_SWEEP_DISCOUNT", locationScore: 20, locationTag: "EXTREME_DISCOUNT_SWEEP", isExtreme: true };
    }
    if (depthPct <= 20.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EXTREME_DISCOUNT", locationScore: 19, locationTag: "EXTREME_DISCOUNT", isExtreme: true };
    }
    if (depthPct <= 40.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "DEEP_DISCOUNT_OTE", locationScore: 18, locationTag: "DEEP_DISCOUNT_OTE", isDeep: true };
    }
    if (depthPct <= 55.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EQUILIBRIUM_FAIR_VALUE", locationScore: 16, locationTag: "EQUILIBRIUM_FAIR_VALUE", isShallow: depthPct > 40 };
    }
    return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "SHALLOW_MOMENTUM", locationScore: 14, locationTag: "SHALLOW_MOMENTUM_EXPANSION", isShallow: true };
  } else {
    depthPct = ((range.high - entry) / span) * 100;
    const extremeBreach = finite(raidExtreme) && raidExtreme >= range.high;
    const entryBreach = entry >= range.high;

    if (entryBreach || extremeBreach) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EXTREME_SWEEP_PREMIUM", locationScore: 20, locationTag: "EXTREME_PREMIUM_SWEEP", isExtreme: true };
    }
    if (depthPct <= 20.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EXTREME_PREMIUM", locationScore: 19, locationTag: "EXTREME_PREMIUM", isExtreme: true };
    }
    if (depthPct <= 40.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "DEEP_PREMIUM_OTE", locationScore: 18, locationTag: "DEEP_PREMIUM_OTE", isDeep: true };
    }
    if (depthPct <= 55.0) {
      return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "EQUILIBRIUM_FAIR_VALUE", locationScore: 16, locationTag: "EQUILIBRIUM_FAIR_VALUE", isShallow: depthPct > 40 };
    }
    return { depthPct: Math.round(depthPct * 10) / 10, depthTier: "SHALLOW_MOMENTUM", locationScore: 14, locationTag: "SHALLOW_MOMENTUM_EXPANSION", isShallow: true };
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
  let bestScore = 10;
  let anchorTag = "LOCAL_INTRADAY_ANCHOR";

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
      } else if (anchor.type === "HTF_FVG" || anchor.type === "HTF_IFVG") {
        score = 18;
        tag = anchor.type === "HTF_IFVG" ? "HTF_IFVG_ANCHOR" : "HTF_FVG_ANCHOR";
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
      fitnessScore = 18;
      fitnessTag = "TURTLE_SOUP_DEEP_POOL_RAID";
    } else {
      fitnessScore = 6;
      fitnessTag = "TURTLE_SOUP_SHALLOW_CHOP_RISK";
    }
  } else if (mId === "breaker_block") {
    // Breaker blocks are displacement flips after opposing order block failure or key level structure flip
    if ((evidence?.failedOrderBlock && evidence?.displacement?.valid) || (evidence?.raid && evidence?.displacement?.valid) || isExtreme || isDeep) {
      fitnessScore = 20;
      fitnessTag = "BREAKER_DISPLACED_STRUCTURE_FLIP";
    } else if (isShallow) {
      fitnessScore = 14;
      fitnessTag = "BREAKER_SHALLOW_RETEST";
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
      fitnessScore = 20;
      fitnessTag = "ICT2022_DEEP_VALUE_DISPLACEMENT";
    } else if (isShallow) {
      fitnessScore = 14;
      fitnessTag = "ICT2022_SHALLOW_EXPANSION";
    } else {
      fitnessScore = 8;
      fitnessTag = "ICT2022_EQUILIBRIUM_CHOP";
    }
  } else if (mId === "silver_bullet") {
    fitnessScore = 20;
    fitnessTag = "SILVER_BULLET_WINDOW_TIMING";
  } else if (mId === "displacement_breakout") {
    if (evidence?.isMomentum || evidence?.displacement?.valid) {
      fitnessScore = 20;
      fitnessTag = "DISPLACEMENT_BREAKOUT_EXPANSION";
    } else {
      fitnessScore = 15;
      fitnessTag = "DISPLACEMENT_BREAKOUT_STANDARD";
    }
  } else if (mId === "judas_swing") {
    if (evidence?.judasLevel && evidence?.displacement?.valid) {
      fitnessScore = 20;
      fitnessTag = "JUDAS_SWING_DISPLACED_REVERSAL";
    } else {
      fitnessScore = 14;
      fitnessTag = "JUDAS_SWING_STANDARD";
    }
  } else if (mId === "smt_divergence_sweep") {
    if (evidence?.smtEvidence && evidence?.displacement?.valid) {
      fitnessScore = 20;
      fitnessTag = "SMT_DIVERGENCE_PREMIER_ARBITRAGE";
    } else {
      fitnessScore = 15;
      fitnessTag = "SMT_DIVERGENCE_STANDARD";
    }
  } else if (mId === "fvg_rejection") {
    if (evidence?.fvg && evidence?.displacement?.valid) {
      fitnessScore = 20;
      fitnessTag = "FVG_RUNAWAY_TREND_REJECTION";
    } else {
      fitnessScore = 12;
      fitnessTag = "FVG_STANDARD_REJECTION";
    }
  } else if (mId === "po3_daily_cycle") {
    if (finite(evidence?.dailyOpen) && evidence?.displacement?.valid) {
      fitnessScore = 20;
      fitnessTag = "PO3_DAILY_OPEN_EXPANSION";
    } else {
      fitnessScore = 14;
      fitnessTag = "PO3_STANDARD_CYCLE";
    }
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
      extremeBonus: 5,
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
      // For Longs: Extreme lies strictly between entry and stop (sl <= a.price < entry)
      const inDangerZone = a.price < entry && a.price >= sl;
      return inDangerZone && ["PDL", "SESSION_LOW", "HTF_OB", "LIQUIDITY_POOL"].includes(a.type);
    } else {
      // For Shorts: Extreme lies strictly between entry and stop (entry < a.price <= sl)
      const inDangerZone = a.price > entry && a.price <= sl;
      return inDangerZone && ["PDH", "SESSION_HIGH", "HTF_OB", "LIQUIDITY_POOL"].includes(a.type);
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
 * Lens 7: Retracement Quality & Velocity Physics (0 to 15 pts)
 */
export function evaluateRetracementQualityAndVelocity({ brain = {}, candidate = {} }) {
  const retrace = brain.retracement?.m15 || brain.retracements?.M15;
  let retraceScore = candidate?.confluenceBreakdown?.retracementQuality ?? candidate?.positiveBreakdown?.retracementQuality ?? 10;
  if (retrace) {
    const qGrade = retrace.qualityGrade || retrace.grade;
    if (qGrade === "A+") retraceScore = 15;
    else if (qGrade === "A") retraceScore = 13;
    else if (retrace.stage === "EQUILIBRIUM_DISCOUNT") retraceScore = 11;
    else if (qGrade === "F") retraceScore = 0;
    else retraceScore = 8;
  }
  return {
    retraceScore,
    qualityGrade: retrace?.qualityGrade || retrace?.grade || "B",
    isFreightTrain: Boolean(retrace?.isFreightTrain),
  };
}

export function formatPrice(price, units = {}) {
  if (!finite(price)) return price;
  const digits = units?.digits != null ? units.digits : 5;
  return Number(Number(price).toFixed(digits));
}

/**
 * In-Depth Pairwise Structural Arbiter:
 * Handles two competing candidate setups on the same asset:
 * - Case 1: Intra-Zone Overlap (Cand 2 entry lies INSIDE Cand 1's SL path)
 *   -> Synthesizes a single 100% RPT composite trade at the average/blended entry price,
 *      with SL anchored safely below the shared structural floor.
 * - Case 2: Multi-Regime Decoupling (Cand 2 entry lies OUTSIDE / BEYOND Cand 1's SL path)
 *   -> Deep HTF Magnet Arbitration: Evaluates Magnet Authority Score (timeframe hierarchy,
 *      major 4H/Daily anchor, dealing range discount extreme, and adverse pullback velocity).
 *      If Cand 2 is an authoritative HTF Magnet, Cand 1 is suppressed as a shallow trap;
 *      otherwise, Cand 1 is retained and Cand 2 is deferred.
 */
export function arbitratePairwiseStructuralSetups({ evaluated = [], dir = 1, units = {}, range = null, brain = {}, config = {} }) {
  if (config.enablePairwiseArbitration === false || evaluated.length < 2 || ![1, -1].includes(dir)) return evaluated;

  const valid = evaluated.filter((c) => c && c.permitted !== false && finite(c.entry) && finite(c.sl) && opposite(dir, c.sl, c.entry));
  if (valid.length < 2) return evaluated;

  // Identify price arrival order from market (shallow vs deep)
  // In a Bullish setup (price coming down): Higher entry is Cand 1 (first), Lower entry is Cand 2 (second).
  // In a Bearish setup (price coming up): Lower entry is Cand 1 (first), Higher entry is Cand 2 (second).
  const sortedByArrival = [...valid].sort((a, b) => (dir === 1 ? b.entry - a.entry : a.entry - b.entry));
  const cand1 = sortedByArrival[0]; // First encountered (shallow)
  const cand2 = sortedByArrival[1]; // Second encountered (deep)

  // Check Case 1: Cand 2 entry lies strictly INSIDE Cand 1's Stop Loss range
  const isInsideSl1 = dir === 1
    ? (cand1.entry > cand2.entry && cand2.entry >= cand1.sl)
    : (cand1.entry < cand2.entry && cand2.entry <= cand1.sl);

  // Check Case 2: Cand 2 entry lies strictly OUTSIDE / DEEPER than Cand 1's Stop Loss
  const isDeeperThanSl1 = dir === 1
    ? (cand2.entry < cand1.sl)
    : (cand2.entry > cand1.sl);

  if (isInsideSl1) {
    // -----------------------------------------------------------------------
    // CASE 1: INTRA-ZONE BLENDED ENTRY (100% RPT on Averaged Entry Price)
    // -----------------------------------------------------------------------
    const blendedEntry = formatPrice((cand1.entry + cand2.entry) / 2, units);
    const blendedSl = dir === 1 ? Math.min(cand1.sl, cand2.sl) : Math.max(cand1.sl, cand2.sl);
    const riskDist = Math.abs(blendedEntry - blendedSl);

    // Pick cleaner targets (prioritizing higher expectancy / runner)
    const targets = cand1.targets || cand2.targets;
    const runnerTarget = targets?.[2]?.price ?? targets?.[0]?.price ?? (dir === 1 ? blendedEntry + riskDist * 2.5 : blendedEntry - riskDist * 2.5);
    const rawRR = riskDist > 0 ? (dir === 1 ? runnerTarget - blendedEntry : blendedEntry - runnerTarget) / riskDist : (cand1.rr || 2.0);
    const rr = Math.round(rawRR * 100) / 100;

    const blendedZoneScore = Math.round(Math.max(cand1.zoneScore || 70, cand2.zoneScore || 70));
    const blendedConfluence = Math.round(Math.max(cand1.confluenceScore || 70, cand2.confluenceScore || 70));
    const netCompositeScore = Math.round((blendedZoneScore + blendedConfluence) / 2);
    const effectiveRRMultiplier = Math.min(2.5, Math.max(1.2, rr));
    const expectancyScore = Number((blendedZoneScore * effectiveRRMultiplier).toFixed(2));

    // Suppress standalone execution of individual components to avoid redundant exposure
    cand1.permitted = false;
    cand1.mergedIntoBlended = true;
    cand1.vetoes = cand1.vetoes || [];
    cand1.vetoes.push({
      code: "MERGED_INTO_BLENDED",
      reason: `Intra-zone candidate merged into 100% RPT composite trade at blended sweet spot (${blendedEntry}) with common structural SL (${blendedSl}).`,
    });

    cand2.permitted = false;
    cand2.mergedIntoBlended = true;
    cand2.vetoes = cand2.vetoes || [];
    cand2.vetoes.push({
      code: "MERGED_INTO_BLENDED",
      reason: `Intra-zone candidate merged into 100% RPT composite trade at blended sweet spot (${blendedEntry}) with common structural SL (${blendedSl}).`,
    });

    const blendedCandidate = {
      ...cand1,
      id: `blended_${cand1.id}_${cand2.id}`,
      name: `${cand1.name || cand1.modelName} & ${cand2.name || cand2.modelName} (Blended Sweet Spot)`,
      modelId: `${cand1.modelId || cand1.id}+${cand2.modelId || cand2.id}`,
      modelName: `${cand1.name || cand1.modelName} & ${cand2.name || cand2.modelName} (Blended Sweet Spot)`,
      badge: "Blended Entry",
      modelBadge: "Blended Entry",
      entry: blendedEntry,
      price: blendedEntry,
      sl: blendedSl,
      tp: runnerTarget,
      targets,
      rr,
      targetRR: rr,
      zoneScore: blendedZoneScore,
      confluenceScore: blendedConfluence,
      netCompositeScore,
      expectancyScore,
      zoneGrade: blendedZoneScore >= 80 ? "A+" : blendedZoneScore >= 65 ? "A" : "B",
      permitted: true,
      vetoes: [],
      isBlended: true,
      allocationRpt: 1.0, // 100% Risk Per Trade
      evidence: {
        ...(cand1.evidence || {}),
        sequence: ["intra_zone_layering", "blended_entry_sweet_spot", "100pct_rpt_allocation"],
        blendedDetails: {
          cand1: { id: cand1.id, name: cand1.name || cand1.modelName, entry: cand1.entry, sl: cand1.sl },
          cand2: { id: cand2.id, name: cand2.name || cand2.modelName, entry: cand2.entry, sl: cand2.sl },
          averagePrice: blendedEntry,
          commonSl: blendedSl,
        },
      },
      label: `${cand1.modelName || cand1.name} & ${cand2.modelName || cand2.name} (Blended) limit @ ${blendedEntry}`,
    };

    return [blendedCandidate, ...evaluated];
  } else if (isDeeperThanSl1) {
    // -----------------------------------------------------------------------
    // CASE 2: MULTI-REGIME HTF MAGNET ARBITRATION (In-Depth, Non-Naive)
    // -----------------------------------------------------------------------
    let magnetAuthorityScore = 0;
    const magnetReasons = [];

    // 1. Authoritative Major HTF Anchor Check
    const cand2AnchorTag = cand2.zoneBreakdown?.anchorTag || "";
    const isMajorAnchor = cand2AnchorTag.includes("MAJOR") ||
                          cand2AnchorTag.includes("HTF_ORDER_BLOCK") ||
                          cand2AnchorTag.includes("HTF_FVG") ||
                          cand2AnchorTag.includes("HTF_BREAKER") ||
                          cand2AnchorTag.includes("RANGE_EXTREME") ||
                          cand2AnchorTag.includes("LIQUIDITY_POOL") ||
                          cand2.evidence?.majorLevel;

    if (isMajorAnchor) {
      magnetAuthorityScore += 35;
      magnetReasons.push(`Authoritative HTF anchor (${cand2AnchorTag || "Major Key Level"})`);
    }

    // 2. Timeframe Superiority Check
    const tfRanks = { M1: 1, M5: 2, M15: 3, M30: 4, H1: 5, H4: 6, D1: 7, W1: 8 };
    const rank1 = tfRanks[cand1.tf] || 3;
    const rank2 = tfRanks[cand2.tf] || 3;
    if (rank2 > rank1) {
      const tfBonus = Math.min(25, 15 + (rank2 - rank1) * 5);
      magnetAuthorityScore += tfBonus;
      magnetReasons.push(`HTF timeframe superiority (${cand2.tf} vs ${cand1.tf}, +${tfBonus} pts)`);
    }

    // 3. Dealing Range Extreme Depth
    const depth2 = Number(cand2.depthPct || cand2.zoneBreakdown?.depthPct || 50);
    const depthTier2 = cand2.depthTier || cand2.zoneBreakdown?.depthTier || "";
    if (depthTier2.includes("EXTREME") || depth2 <= 20) {
      magnetAuthorityScore += 20;
      magnetReasons.push(`Deep dealing range extreme (${depth2}% - ${depthTier2 || "EXTREME"})`);
    } else if (depthTier2.includes("DEEP") || depth2 <= 40) {
      magnetAuthorityScore += 12;
      magnetReasons.push(`Dealing range deep OTE (${depth2}% - ${depthTier2 || "DEEP"})`);
    }

    // 4. Adverse Retracement Velocity / Freight Train Physics
    const velocityDrag = Number(cand1.confluenceBreakdown?.velocityDrag || cand1.negativeBreakdown?.velocityDrag || 0);
    const retrace = brain.retracement?.m15 || brain.retracements?.M15 || brain.retracement;
    if (velocityDrag <= -10 || retrace?.isFreightTrain || (retrace?.qualityGrade || retrace?.grade) === "F") {
      magnetAuthorityScore += 20;
      magnetReasons.push(`Adverse freight train velocity plunging toward HTF anchor`);
    } else if (velocityDrag <= -6 || (retrace?.velocityRatio != null && Number(retrace.velocityRatio) >= 1.35)) {
      magnetAuthorityScore += 10;
      magnetReasons.push(`Elevated adverse retracement velocity`);
    }

    // 5. Structural Model Authority
    if (cand2.modelId === "turtle_soup" || cand2.modelId === "breaker_block") {
      magnetAuthorityScore += 15;
      magnetReasons.push(`High-conviction reversal model (${cand2.name || cand2.modelId})`);
    }

    magnetAuthorityScore = Math.min(100, magnetAuthorityScore);

    if (magnetAuthorityScore >= 50) {
      cand1.permitted = false;
      cand1.vetoes = cand1.vetoes || [];
      if (!cand1.vetoes.some((v) => v.code === "HTF_MAGNET_TRAP")) {
        cand1.vetoes.push({
          code: "HTF_MAGNET_TRAP",
          reason: `Shallow entry stop (${cand1.sl}) lies directly in the path of authoritative HTF Magnet (${cand2.modelName || cand2.name || cand2.id} @ ${cand2.entry}, Magnet Score: ${magnetAuthorityScore}/100: ${magnetReasons.join(", ")}). Suppressed to prevent premature stop-out.`,
        });
      }
      cand2.isHtfMagnetWinner = true;
      cand2.magnetAuthorityScore = magnetAuthorityScore;

      return [...evaluated].sort((a, b) => Number(b.id === cand2.id) - Number(a.id === cand2.id));
    } else {
      cand2.isDeferredSecondary = true;
      cand2.deferredReason = "Shallow trade (Cand 1) maintains momentum priority; Cand 2 deferred until Cand 1 resolves or reclaims structure.";
      return evaluated;
    }
  }

  return evaluated;
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

    // 7. Retracement Quality & Velocity Physics
    const retracement = evaluateRetracementQualityAndVelocity({
      brain,
      candidate: cand,
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

    const negativeScore = cand.negativeScore ?? cand.confluenceBreakdown?.negativeScore ?? 0;

    // Composite Structural Zone Score (0 to 100), factoring in positive structure, retracement physics, and negative friction
    const rawZoneScore =
      location.locationScore +
      anchor.anchorScore +
      fitness.fitnessScore +
      displacement.displacementScore +
      timing.timingScore +
      retracement.retraceScore +
      timeAffinityBonus +
      trap.extremeBonus -
      trap.trapPenalty +
      negativeScore;

    const zoneScore = Math.max(10, Math.min(100, Math.round(rawZoneScore)));

    // Balanced Structural Expectancy Score:
    // Balances high-probability structural zone with realistic R:R.
    // Clamped between 1.2R and 2.5R so noisy tight stops cannot overpower pristine 95-score Extreme zones!
    const effectiveRRMultiplier = Math.min(2.5, Math.max(1.2, cand.rr || 1.8));
    const expectancyScore = Number((zoneScore * effectiveRRMultiplier).toFixed(2));

    const zoneGrade =
      zoneScore >= 80 ? "A+" : zoneScore >= 65 ? "A" : zoneScore >= 45 ? "B" : "C";

    // Net Composite Score: Balances positive confluences and negative friction deductions
    // Replaces depth-only bias with true institutional net edge!
    const netCompositeScore = Math.round((zoneScore + (cand.confluenceScore || 0)) / 2);

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
      retraceScore: retracement.retraceScore,
      retraceGrade: retracement.qualityGrade,
      extremeBonus: trap.extremeBonus,
      trapPenalty: trap.trapPenalty,
      negativeScore,
      netCompositeScore,
      shallowTrap: trap.shallowTrap,
      trapWarning: trap.trapWarning,
      isExtremeSetup: trap.isExtremeSetup,
    };

    return {
      ...cand,
      zoneScore,
      netCompositeScore,
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

  // Balanced Net Institutional Ranking:
  // 1. Permitted status first (Vetoes honored)
  // 2. Net Composite Score (Positive confluences minus negative friction)
  // 3. Zone Score (Structural excellence)
  // 4. Expectancy Score (Balanced quality × R:R)
  // 5. Confluence Score
  // 6. Raw R:R (Last-resort tie-breaker only!)
  evaluated.sort(
    (a, b) =>
      Number(b.permitted) - Number(a.permitted) ||
      (b.netCompositeScore || 0) - (a.netCompositeScore || 0) ||
      (b.zoneScore || 0) - (a.zoneScore || 0) ||
      (b.expectancyScore || 0) - (a.expectancyScore || 0) ||
      (b.confluenceScore || 0) - (a.confluenceScore || 0) ||
      (b.rr || 0) - (a.rr || 0) ||
      String(a.id || "").localeCompare(String(b.id || ""))
  );

  // Dedicated Pairwise Structural Arbiter (Case 1: Intra-Zone Overlap & Case 2: Deep HTF Magnet)
  const arbitratedCandidates = arbitratePairwiseStructuralSetups({
    evaluated,
    dir,
    units,
    range,
    brain,
    config,
  });

  const primary = arbitratedCandidates[0];
  const topContenders = arbitratedCandidates.slice(0, 3).map((c, i) => ({
    rank: i + 1,
    id: c.id,
    modelId: c.modelId,
    modelName: c.modelName || c.name,
    entry: c.entry,
    sl: c.sl,
    tp: c.tp,
    rr: c.rr,
    zoneScore: c.zoneScore,
    confluenceScore: c.confluenceScore,
    netCompositeScore: c.netCompositeScore,
    zoneGrade: c.zoneGrade,
    isBlended: Boolean(c.isBlended),
    isHtfMagnetWinner: Boolean(c.isHtfMagnetWinner),
    isDeferredSecondary: Boolean(c.isDeferredSecondary),
    magnetAuthorityScore: c.magnetAuthorityScore,
    depthTier: c.depthTier,
    permitted: c.permitted !== false,
  }));

  return {
    ...primary,
    topContenders,
    allCandidates: arbitratedCandidates,
    candidateCount: arbitratedCandidates.length,
    decisionEngine: {
      arbitratedWinner: primary.id,
      winnerZoneScore: primary.zoneScore,
      winnerGrade: primary.zoneGrade,
      winnerTier: primary.depthTier,
      isBlended: Boolean(primary.isBlended),
      shallowTrapDetected: arbitratedCandidates.some(
        (c) => c.shallowTrap || c.vetoes?.some((v) => v.code === "HTF_MAGNET_TRAP")
      ),
      topContenders,
    },
  };
}

/**
 * Setup-vs-Setup Comparison & Hot-Swap Redecision Engine:
 * Continuously evaluates an active resting staged setup against the fresh champion
 * and top background contenders.
 * 
 * Returns:
 * - action: "RETAIN_CHAMPION" | "UPGRADE_BLENDED_SWEET_SPOT" | "UPGRADE_HTF_MAGNET" | "UPGRADE_SUPERIOR_MODEL" | "UPGRADE_REANCHOR"
 * - shouldUpgrade: boolean
 * - recommendedSetup: object
 * - reason: string
 * - scoreDelta: number
 */
export function evaluateSetupVsSetupComparison({
  currentTrade,
  freshChampion,
  topContenders = [],
  brain = {},
  dir = 1,
  units = {},
}) {
  if (!currentTrade || !freshChampion) {
    return { action: "RETAIN_CHAMPION", shouldUpgrade: false, reason: "Insufficient trade data for comparison", scoreDelta: 0 };
  }

  // Directional safety guard: If direction differs, do not hot-swap in-place; invalidation handles thesis flips
  if (currentTrade.dir != null && freshChampion.dir != null && currentTrade.dir !== freshChampion.dir) {
    return { action: "RETAIN_CHAMPION", shouldUpgrade: false, reason: "Directional thesis inverted; handled via thesis invalidation", scoreDelta: 0 };
  }

  // Active filled positions in the market are locked and managed by AMRE; never hot-swapped mid-flight
  const isFilledOrActive = Boolean(currentTrade.filledAt || ["active", "managing", "closing"].includes(currentTrade.status));
  if (isFilledOrActive) {
    return { action: "RETAIN_CHAMPION", shouldUpgrade: false, reason: "Trade is already filled and actively managed", scoreDelta: 0 };
  }

  const currentEntry = Number(currentTrade.entryPrice ?? currentTrade.entry);
  const currentSl = Number(currentTrade.initialSlPrice ?? currentTrade.slPrice ?? currentTrade.sl);
  const currentScore = Number(currentTrade.netCompositeScore ?? currentTrade.confluenceScore ?? 70);
  const freshScore = Number(freshChampion.netCompositeScore ?? freshChampion.confluenceScore ?? 70);
  const scoreDelta = freshScore - currentScore;

  // 1. Check Case 1: Intra-Zone Overlap Sweet Spot (Blended Entry)
  if (freshChampion.isBlended) {
    const isSameBlended = Math.abs(currentEntry - freshChampion.entry) < (units.point || 0.00001);
    if (!isSameBlended) {
      return {
        action: "UPGRADE_BLENDED_SWEET_SPOT",
        shouldUpgrade: true,
        recommendedSetup: freshChampion,
        scoreDelta,
        reason: `Intra-zone sweet spot discovered: Upgrading to blended entry @ ${freshChampion.entry} with shared structural stop @ ${freshChampion.sl} (100% RPT).`,
      };
    }
  }

  // 2. Check Case 2: HTF Magnet Emergence (Shallow Trap Suppression)
  const isHtfMagnet = freshChampion.isHtfMagnetWinner || (freshChampion.magnetAuthorityScore != null && freshChampion.magnetAuthorityScore >= 50);
  const isAlreadyThisMagnet = Math.abs(currentEntry - Number(freshChampion.entry)) < (units.point || 0.00001) &&
    (currentTrade.modelId === freshChampion.modelId || currentTrade.id === freshChampion.id || currentTrade.id === `trade_${freshChampion.id}`);
  const currentHasMagnetTrap = currentTrade.vetoes?.some((v) => v.code === "HTF_MAGNET_TRAP");

  if (isHtfMagnet && !isAlreadyThisMagnet && (currentHasMagnetTrap || currentTrade.modelId !== freshChampion.modelId)) {
    return {
      action: "UPGRADE_HTF_MAGNET",
      shouldUpgrade: true,
      recommendedSetup: freshChampion,
      scoreDelta,
      reason: `Authoritative HTF Magnet emerged (${freshChampion.modelName || freshChampion.name || freshChampion.id} @ ${freshChampion.entry}, Score: ${freshChampion.magnetAuthorityScore || 70}/100). Suppressing shallow setup to prevent stop run.`,
    };
  }

  // 3. Decisive Quality Delta (Fresh champion is >= 8 points higher than current resting trade)
  if (scoreDelta >= 8 && freshChampion.permitted !== false) {
    return {
      action: "UPGRADE_SUPERIOR_MODEL",
      shouldUpgrade: true,
      recommendedSetup: freshChampion,
      scoreDelta,
      reason: `Decisive quality upgrade (+${scoreDelta} pts): Hot-swapping to higher-conviction setup [${freshChampion.modelName || freshChampion.modelId}] (Score: ${freshScore}/100 vs ${currentScore}/100).`,
    };
  }

  // 4. Structural Re-anchoring (Same model, but order flow refined the entry/SL by > 1.5 pips)
  const isSameModel = (freshChampion.modelId === currentTrade.modelId) || (freshChampion.id === currentTrade.modelId);
  const minShift = units.pip ? units.pip * 1.5 : (units.point ? units.point * 15 : 0.00015);
  const entryShift = Math.abs(currentEntry - Number(freshChampion.entry));
  const slShift = Math.abs(currentSl - Number(freshChampion.sl));

  if (isSameModel && (entryShift >= minShift || slShift >= minShift) && freshChampion.permitted !== false) {
    return {
      action: "UPGRADE_REANCHOR",
      shouldUpgrade: true,
      recommendedSetup: freshChampion,
      scoreDelta,
      reason: `Order flow re-anchored key level: Updating entry (${currentEntry} -> ${freshChampion.entry}) and SL (${currentSl} -> ${freshChampion.sl}) to match refined institutional structure.`,
    };
  }

  return {
    action: "RETAIN_CHAMPION",
    shouldUpgrade: false,
    recommendedSetup: currentTrade,
    scoreDelta,
    reason: "Current resting setup retains institutional sovereignty; no superior setup detected.",
  };
}
