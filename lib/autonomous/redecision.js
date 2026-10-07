import { findPivots, avgRange } from "../patterns/core.js";
import { analyzeStructure } from "../bias/structure.js";
import { detectOrderBlocks, fvgZones } from "../bias/zones.js";
import { analyzeHTFLiquidity } from "../bias/htfLiquidity.js";
import { detectTrendlineLiquidity } from "../bias/buildup.js";
import { smtDivergence, SMT_PAIRS } from "../bias/context.js";
import { initialTradeRisk } from "./management.js";

/**
 * Autonomous Milestone Redecision Engine (AMRE) - Horizon-Adaptive Edition
 *
 * Dedicated multi-pillar quantitative decision engine triggered strictly ONCE
 * when an active trade reaches the 50% target milestone (+0.5 * targetRR).
 *
 * Specializes computation, noise filtering, and timeframe hierarchies across 3 distinct horizons:
 * 1. SWING (1D-1H): D1 compass, 4H roadmap, 1H gatekeeper. Macro obstacles (D1/H4), high wick tolerance,
 *    multi-day session neutrality (holds through Asian session), expanded targets up to 10.0R.
 * 2. DAY TRADE (4H-15M): 4H compass, 1H roadmap, 15M gatekeeper. Intraday session lifecycle (London/NY),
 *    H4/H1 roadblocks, workhorse target brackets (2.0R - 5.0R).
 * 3. SCALP (15M-1M): 15M compass, 5M roadmap, 1M precision trigger. Fast M5/M1 momentum & micro MSS,
 *    M15/M5 roadblocks, strict killzone timing (prohibitive in Asian/dead zones), tight cap at 2.5R max.
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * Horizon Profiles Specification
 */
export const HORIZON_PROFILES = {
  SWING: {
    id: "swing",
    horizonCode: 1,
    tag: "SWG",
    label: "Swing Expansion (1D-1H)",
    primaryTf: "H1",
    secondaryTf: "H4",
    obstacleTfs: ["D1", "H4", "H1"],
    rangeTf: "D1",
    dolKeys: ["PWH", "PWL", "PDH", "PDL"],
    minObstacleBufferRR: 2.0,      // Swings ignore micro 1.5R obstacles
    obstacleBufferRatio: 0.25,     // Front-run macro obstacles by 0.25R
    minReducedRR: 2.0,             // Never compress a swing below 2.0R
    maxAllowedRR: 10.0,            // Swing runner ceiling
    expandStep: 1.5,
    sessionFilter: "SWING_MACRO",  // Neutral to Asian/dead zone; Friday weekend close matters
    opposingWickTolerance: 0.45,   // Higher tolerance for wicks on H1 bars
    weights: { momentum: 0.25, obstacles: 0.35, dol: 0.25, smt: 0.10, session: 0.05 },
    closeThreshold: -55,           // Higher conviction hold for swings
  },
  DAY: {
    id: "day",
    horizonCode: 2,
    tag: "DAY",
    label: "Day Trade Expansion (4H-15M)",
    primaryTf: "M15",
    secondaryTf: "H1",
    obstacleTfs: ["H4", "H1"],
    rangeTf: "H4",
    dolKeys: ["PDH", "PDL", "PWH", "PWL"],
    minObstacleBufferRR: 1.5,
    obstacleBufferRatio: 0.15,
    minReducedRR: 1.5,
    maxAllowedRR: 5.0,
    expandStep: 1.0,
    sessionFilter: "INTRADAY_WORKHORSE", // Standard London/NY/Dead Zone checks
    opposingWickTolerance: 0.38,
    weights: { momentum: 0.30, obstacles: 0.30, dol: 0.20, smt: 0.10, session: 0.10 },
    closeThreshold: -45,
  },
  SCALP: {
    id: "scalp",
    horizonCode: 3,
    tag: "SCP",
    label: "Intraday Scalp (15M-1M)",
    primaryTf: "M5",
    secondaryTf: "M1",
    obstacleTfs: ["M15", "M5", "H1"],
    rangeTf: "M15",
    dolKeys: ["EQH", "EQL", "SESSION_HIGH", "SESSION_LOW", "ASIAN_HIGH", "ASIAN_LOW", "PDH", "PDL"],
    minObstacleBufferRR: 1.2,      // Micro roadblocks matter starting at 1.2R
    obstacleBufferRatio: 0.10,     // Tight buffer front-run
    minReducedRR: 1.2,             // Quick bank for scalps
    maxAllowedRR: 2.5,             // Strictly capped at 2.5R to prevent overholding
    expandStep: 0.5,
    sessionFilter: "KILLZONE_STRICT", // Must be active killzone; off-hours are heavily penalized
    opposingWickTolerance: 0.28,   // Zero tolerance for absorption wicks on M5
    weights: { momentum: 0.35, session: 0.25, obstacles: 0.20, dol: 0.15, smt: 0.05 },
    closeThreshold: -35,           // Fast exit trigger: scalps cannot afford adverse drift
  },
};

/**
 * Resolves Horizon Profile from a Trade Document
 */
export function resolveTradeHorizon(trade = {}) {
  const raw = (
    trade.horizon ||
    trade.scenario?.id ||
    (trade.horizonCode === 1 ? "swing" : trade.horizonCode === 3 ? "scalp" : trade.horizonCode === 2 ? "day" : null) ||
    trade.horizonMode ||
    (trade.scenario?.horizonCode === 1 ? "swing" : trade.scenario?.horizonCode === 3 ? "scalp" : trade.scenario?.horizonCode === 2 ? "day" : null) ||
    (trade.tf === "1D" || trade.tf === "4H" ? "swing" : trade.tf === "1M" || trade.tf === "5M" ? "scalp" : null) ||
    "day"
  ).toString().toLowerCase().trim();

  if (raw === "swing" || raw === "swg" || raw === "1" || trade.horizonCode === 1 || trade.scenario?.horizonCode === 1) {
    return HORIZON_PROFILES.SWING;
  }
  if (raw === "scalp" || raw === "scp" || raw === "3" || trade.horizonCode === 3 || trade.scenario?.horizonCode === 3) {
    return HORIZON_PROFILES.SCALP;
  }
  return HORIZON_PROFILES.DAY;
}

/**
 * Pillar 1: Velocity & Structural Momentum Engine (Horizon & Noise-Filtered)
 */
export function evaluateMomentumVelocity(bars = [], trade = {}, currentPrice = null, horizonConfig = null) {
  const profile = (horizonConfig && HORIZON_PROFILES[horizonConfig.id?.toUpperCase()]) || resolveTradeHorizon(trade);

  if (!Array.isArray(bars) || bars.length < 5) {
    return {
      score: 20,
      opposingMss: false,
      mssAge: null,
      trendIntegrity: "NEUTRAL",
      expansionBodyRatio: 0.5,
      opposingWickRatio: 0.2,
      arrivalVelocity: "STABLE",
      horizon: profile.id,
      horizonLabel: profile.label,
      horizonTag: profile.tag,
      reason: `[${profile.tag}] Insufficient candle history; defaulting to neutral momentum`,
    };
  }

  const n = bars.length;
  const recentCount = Math.min(15, n);
  const recentBars = bars.slice(n - recentCount);
  const dir = trade.dir || 1;
  const avg = avgRange(bars);

  // 1. Analyze candle bodies and opposing wicks with noise filtering & recency weighting
  let directionalBodySum = 0;
  let opposingWickSum = 0;
  let totalRangeSum = 0;
  let consecutiveDirectional = 0;
  let maxConsecutive = 0;

  // Arrival window (last 4 bars) vs baseline window
  let arrivalDirectionalBodySum = 0;
  let arrivalTotalRangeSum = 0;

  for (let i = 0; i < recentBars.length; i++) {
    const b = recentBars[i];
    const totalRange = Math.max(1e-8, b.high - b.low);

    // Recency weighting: recent bars carry higher weight than older bars
    const recencyWeight = i >= recentBars.length - 4 ? 1.4 : 1.0;
    totalRangeSum += totalRange * recencyWeight;

    const isDirectional = dir === 1 ? b.close > b.open : b.close < b.open;
    const bodySize = Math.abs(b.close - b.open);

    if (isDirectional) {
      consecutiveDirectional++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveDirectional);
      directionalBodySum += bodySize * recencyWeight;
    } else {
      consecutiveDirectional = 0;
    }

    if (i >= recentBars.length - 4) {
      arrivalTotalRangeSum += totalRange;
      if (isDirectional) arrivalDirectionalBodySum += bodySize;
    }

    // Noise Filter: Opposing wick is only evaluated if candle range is meaningful (> 0.35 * avg)
    // Filters out tiny 1-2 pip dojis where 50% wick is meaningless noise
    if (avg > 0 && totalRange >= 0.35 * avg) {
      const opposingWick = dir === 1 ? b.high - Math.max(b.open, b.close) : Math.min(b.open, b.close) - b.low;
      opposingWickSum += Math.max(0, opposingWick) * recencyWeight;
    }
  }

  const expansionBodyRatio = totalRangeSum > 0 ? directionalBodySum / totalRangeSum : 0.5;
  const opposingWickRatio = totalRangeSum > 0 ? opposingWickSum / totalRangeSum : 0.2;
  const arrivalRatio = arrivalTotalRangeSum > 0 ? arrivalDirectionalBodySum / arrivalTotalRangeSum : 0.5;

  // 2. Market Structure Analysis (MSS Check with confirmation tailored to horizon)
  let opposingMss = false;
  let mssDetails = null;
  let mssAge = null;
  try {
    const pivotSpan = profile.id === "swing" ? 3 : 2;
    const st = analyzeStructure(bars, avg, { left: pivotSpan, right: pivotSpan, tf: profile.primaryTf });
    if (st && Array.isArray(st.events)) {
      // Look at recent events within the last 4 bars
      const recentEvents = st.events.filter((ev) => ev.age <= 4);
      for (const ev of recentEvents) {
        // Displaced MSS opposing trade direction
        if (ev.type === "MSS" && ev.dir === -dir && ev.displaced) {
          opposingMss = true;
          mssDetails = ev;
          mssAge = ev.age;
          break;
        }
      }
    }
  } catch {}

  // 3. Compute Momentum Score [-100, +100]
  let score = 0;

  if (opposingMss) {
    score -= profile.id === "scalp" ? 85 : 75; // Confirmed displaced structural break against trade
  }

  if (expansionBodyRatio >= 0.55) {
    score += Math.round((expansionBodyRatio - 0.5) * 120); // +6 to +60
  } else if (expansionBodyRatio < 0.35) {
    score -= Math.round((0.35 - expansionBodyRatio) * 150); // Sluggish / compression
  }

  const wickTolerance = profile.opposingWickTolerance;
  if (opposingWickRatio > wickTolerance) {
    score -= Math.round((opposingWickRatio - (wickTolerance - 0.08)) * 140); // Severe absorption wicks
  } else if (opposingWickRatio < (wickTolerance - 0.15)) {
    score += 25; // Clean institutional candles
  }

  if (maxConsecutive >= 4) {
    score += 20; // Strong institutional order flow sequence
  }

  // Arrival velocity bonus/penalty
  if (arrivalRatio >= 0.65) {
    score += 15; // Accelerating into milestone
  } else if (arrivalRatio < 0.25 && !opposingMss) {
    score -= 15; // Slowing down at milestone
  }

  score = clamp(score, -100, 100);

  const trendIntegrity = opposingMss
    ? "BROKEN"
    : score >= 40
    ? "EXPANDING"
    : score >= 0
    ? "HEALTHY"
    : "EXHAUSTING";

  const arrivalVelocity = arrivalRatio >= 0.60 ? "ACCELERATING" : arrivalRatio <= 0.30 ? "DECELERATING" : "STABLE";

  return {
    score,
    opposingMss,
    mssAge,
    expansionBodyRatio: Number(expansionBodyRatio.toFixed(3)),
    opposingWickRatio: Number(opposingWickRatio.toFixed(3)),
    arrivalRatio: Number(arrivalRatio.toFixed(3)),
    arrivalVelocity,
    maxConsecutive,
    trendIntegrity,
    horizon: profile.id,
    horizonLabel: profile.label,
    horizonTag: profile.tag,
    reason: opposingMss
      ? `[${profile.tag}] Opposing displaced Market Structure Shift confirmed (${mssAge ?? 1} bars ago)`
      : trendIntegrity === "EXPANDING"
      ? `[${profile.tag}] Strong expansion bodies with minimal opposing wicks`
      : trendIntegrity === "EXHAUSTING"
      ? `[${profile.tag}] Waning body size and elevated opposing rejection wicks`
      : `[${profile.tag}] Normal healthy trend progression`,
  };
}

/**
 * Pillar 2: Opposing Structural Roadblocks & Obstacle Engine (Horizon-Tailored Active Zones)
 */
export function evaluateOpposingObstacles(frames = {}, trade = {}, currentPrice = null, horizonConfig = null) {
  const profile = (horizonConfig && HORIZON_PROFILES[horizonConfig.id?.toUpperCase()]) || resolveTradeHorizon(trade);
  const risk = initialTradeRisk(trade);
  const entry = Number(trade.filledPrice || trade.entryPrice);
  const tpPrice = Number(trade.tpPrice);
  const dir = trade.dir || 1;
  const digits = Number(trade.symbolSpec?.digits || 5);

  if (!risk.distance || risk.distance <= 0 || !Number.isFinite(entry) || !Number.isFinite(tpPrice)) {
    return {
      score: 0,
      obstacles: [],
      nearestObstacle: null,
      suggestedReducedTp: null,
      suggestedReducedRR: null,
      horizon: profile.id,
      horizonTag: profile.tag,
    };
  }

  const markPrice = currentPrice ?? (entry + dir * (risk.distance * 1.5));
  const isObstacleInPath = (price) => {
    if (!Number.isFinite(price)) return false;
    return dir === 1 ? price > markPrice && price <= tpPrice : price < markPrice && price >= tpPrice;
  };

  const obstacles = [];

  // Helper to add obstacle
  const registerObstacle = (price, name, type, tf, weight = 1.0) => {
    if (!isObstacleInPath(price)) return;
    const rFromEntry = dir * (price - entry) / risk.distance;
    if (rFromEntry <= 0) return;

    // Buffer safe exit price: slightly before obstacle boundary front-run
    const bufferDistance = Math.min(risk.distance * profile.obstacleBufferRatio, Math.abs(price - markPrice) * 0.3);
    const safeBufferPrice = Number((price - dir * bufferDistance).toFixed(digits));
    const safeBufferRR = Number((dir * (safeBufferPrice - entry) / risk.distance).toFixed(2));

    // Filter out micro-noise obstacles: must meet minimum buffer threshold for this horizon
    if (safeBufferRR < profile.minObstacleBufferRR) return;

    obstacles.push({
      price: Number(price.toFixed(digits)),
      rFromEntry: Number(rFromEntry.toFixed(2)),
      safeBufferPrice,
      safeBufferRR,
      name,
      type,
      tf,
      weight,
    });
  };

  // 1. Scan Opposing Order Blocks over horizon-specific timeframe hierarchy
  for (const tf of profile.obstacleTfs) {
    const bars = frames[tf];
    if (!Array.isArray(bars) || bars.length < 20) continue;
    try {
      const avg = avgRange(bars);
      const obs = detectOrderBlocks(bars, avg, 80);
      for (const ob of obs) {
        if (ob.dir === -dir && !ob.tapped && (ob.age == null || ob.age <= 100)) {
          const barrierPrice = dir === 1 ? ob.bottom : ob.top;
          const weight = tf === "D1" ? 1.8 : tf === "H4" ? 1.5 : tf === "H1" ? 1.0 : tf === "M15" ? 0.9 : 0.8;
          registerObstacle(barrierPrice, `Opposing ${tf} Order Block`, "ORDER_BLOCK", tf, weight);
        }
      }
    } catch {}
  }

  // 2. Scan Opposing Fair Value Gaps over horizon-specific timeframe hierarchy
  for (const tf of profile.obstacleTfs) {
    const bars = frames[tf];
    if (!Array.isArray(bars) || bars.length < 20) continue;
    try {
      const avg = avgRange(bars);
      const fvgs = fvgZones(bars, avg, 60);
      for (const fvg of fvgs) {
        if (fvg.dir === -dir && fvg.state === "open") {
          const barrierPrice = dir === 1 ? fvg.bottom : fvg.top;
          const weight = tf === "D1" ? 1.6 : tf === "H4" ? 1.3 : tf === "H1" ? 0.9 : 0.7;
          registerObstacle(barrierPrice, `Opposing ${tf} FVG Boundary`, "FVG", tf, weight);
        }
      }
    } catch {}
  }

  // 3. Scan Dealing Range Equilibrium (50% EQ) tailored to horizon
  let rangeBars = null;
  let rangeTf = profile.rangeTf;
  if (profile.id === "swing") {
    rangeBars = frames.D1 || frames.H4 || frames.H1;
  } else if (profile.id === "scalp") {
    rangeBars = frames.M15 || frames.M5 || frames.H1;
  } else {
    rangeBars = frames.H4 || frames.H1;
  }

  if (Array.isArray(rangeBars) && rangeBars.length >= 20) {
    try {
      const rangeSlice = rangeBars.slice(-40);
      const rHigh = Math.max(...rangeSlice.map((b) => b.high));
      const rLow = Math.min(...rangeSlice.map((b) => b.low));
      const eq = (rHigh + rLow) / 2;
      if (isObstacleInPath(eq)) {
        registerObstacle(eq, `${rangeTf} Dealing Range Equilibrium (50% EQ)`, "RANGE_EQ", rangeTf, 1.2);
      }
    } catch {}
  }

  // Sort obstacles by proximity to current price
  obstacles.sort((a, b) => {
    const distA = Math.abs(a.price - markPrice);
    const distB = Math.abs(b.price - markPrice);
    return distA - distB;
  });

  const nearestObstacle = obstacles[0] || null;

  // Compute Obstacle Score [-100, +100]
  let score = 50;

  if (obstacles.length > 0) {
    const distInR = nearestObstacle ? Math.abs(nearestObstacle.rFromEntry - (dir * (markPrice - entry) / risk.distance)) : 2.0;
    if (profile.id === "scalp") {
      if (distInR <= 0.4) score = -90;
      else if (distInR <= 0.8) score = -65;
      else score = -30;
    } else if (profile.id === "swing") {
      if (distInR <= 0.8) score = -85;
      else if (distInR <= 1.5) score = -60;
      else score = -30;
    } else {
      if (distInR <= 0.6) score = -85;
      else if (distInR <= 1.2) score = -60;
      else score = -30;
    }
  } else {
    score = 75; // Clean runway
  }

  return {
    score: clamp(score, -100, 100),
    obstacles,
    nearestObstacle,
    suggestedReducedTp: nearestObstacle?.safeBufferPrice || null,
    suggestedReducedRR: nearestObstacle?.safeBufferRR || null,
    horizon: profile.id,
    horizonTag: profile.tag,
  };
}

/**
 * Pillar 3: Draw on Liquidity (DOL) Health: Sweep vs Acceptance (Horizon-Tailored)
 */
export function evaluateDrawOnLiquidity(frames = {}, trade = {}, currentPrice = null, horizonConfig = null) {
  const profile = (horizonConfig && HORIZON_PROFILES[horizonConfig.id?.toUpperCase()]) || resolveTradeHorizon(trade);
  const dir = trade.dir || 1;
  const entry = Number(trade.filledPrice || trade.entryPrice);
  const tpPrice = Number(trade.tpPrice);
  const price = currentPrice ?? entry;

  let htfLiq = null;
  try {
    htfLiq = analyzeHTFLiquidity(frames);
  } catch {}

  const keyLevels = htfLiq?.keyLevels || {};
  let score = 25;
  let status = "CLEAR_RUNWAY";
  let targetPool = null;

  // Relevant keys based on horizon
  let relevantKeys = [];
  if (profile.id === "swing") {
    relevantKeys = dir === 1 ? ["PWH", "PWL", "PDH"] : ["PWL", "PWH", "PDL"];
  } else if (profile.id === "scalp") {
    relevantKeys = dir === 1 ? ["EQH", "SESSION_HIGH", "ASIAN_HIGH", "PDH"] : ["EQL", "SESSION_LOW", "ASIAN_LOW", "PDL"];
  } else {
    relevantKeys = dir === 1 ? ["PDH", "PWH"] : ["PDL", "PWL"];
  }

  let poolSweptRecently = false;
  let poolAcceptedBeyond = false;
  let unreachedPoolAhead = false;

  let primaryBars = null;
  if (profile.id === "swing") primaryBars = frames.H1 || frames.H4 || [];
  else if (profile.id === "scalp") primaryBars = frames.M5 || frames.M15 || [];
  else primaryBars = frames.M15 || frames.H1 || [];

  const lastClosedBar = primaryBars.length > 0 ? primaryBars[primaryBars.length - 1] : null;

  for (const k of relevantKeys) {
    const lvl = keyLevels[k];
    if (!lvl || !Number.isFinite(lvl.price)) continue;

    const hasBreached = dir === 1 ? price >= lvl.price : price <= lvl.price;
    const isPastEntry = dir === 1 ? lvl.price > entry : lvl.price < entry;

    if (hasBreached && isPastEntry) {
      // Check causal sweeps: Did price wick through and close back inside? (Sweep / Purge)
      const causalSweep = Array.isArray(htfLiq?.sweeps) && htfLiq.sweeps.some(
        (s) => s.name === lvl.name && s.reversalDir === -dir && s.age <= 3
      );

      // Check acceptance: Did the latest candle close firmly BEYOND the level? (Expansion Breakout)
      const bodyClosedBeyond = lastClosedBar
        ? (dir === 1 ? lastClosedBar.close > lvl.price : lastClosedBar.close < lvl.price)
        : false;

      if (causalSweep && !bodyClosedBeyond) {
        poolSweptRecently = true;
        targetPool = { name: lvl.name, price: lvl.price, state: "SWEPT_REJECTED" };
        break;
      } else if (bodyClosedBeyond) {
        poolAcceptedBeyond = true;
        targetPool = { name: lvl.name, price: lvl.price, state: "EXPANDED_BEYOND" };
      }
    } else if (!hasBreached && (dir === 1 ? lvl.price <= tpPrice * 1.05 : lvl.price >= tpPrice * 0.95)) {
      unreachedPoolAhead = true;
      targetPool = { name: lvl.name, price: lvl.price, state: "UNREACHED_AHEAD" };
    }
  }

  // Check Trendline Liquidity / Buildups on horizon primary timeframe
  try {
    if (primaryBars.length >= 20) {
      const tl = detectTrendlineLiquidity(primaryBars);
      if (Array.isArray(tl.draws) && tl.draws.length > 0) {
        const pool = tl.draws.find((d) => (dir === 1 ? d.type === "EQH" && d.price > price : d.type === "EQL" && d.price < price));
        if (pool) {
          unreachedPoolAhead = true;
          if (!targetPool) targetPool = { name: pool.type, price: pool.price, state: "UNREACHED_BUILDUP" };
        }
      }
    }
  } catch {}

  if (poolSweptRecently) {
    score = profile.id === "scalp" ? -75 : -65;
    status = "ALREADY_SWEPT";
  } else if (poolAcceptedBeyond) {
    score = 65;
    status = "EXPANDING_ACCEPTANCE";
  } else if (unreachedPoolAhead) {
    score = 75;
    status = "UNREACHED_MAGNET";
  } else {
    score = 30;
    status = "CLEAR_RUNWAY";
  }

  return {
    score: clamp(score, -100, 100),
    status,
    targetPool,
    keyLevels: Object.keys(keyLevels),
    horizon: profile.id,
    horizonTag: profile.tag,
  };
}

/**
 * Pillar 4: Lead-Lag SMT & Multi-Timeframe Trend Alignment Engine (Horizon-Tailored)
 */
export function evaluateLeadLagSMT(trade = {}, frames = {}, ticks = {}, extras = {}, horizonConfig = null) {
  const profile = (horizonConfig && HORIZON_PROFILES[horizonConfig.id?.toUpperCase()]) || resolveTradeHorizon(trade);
  const symbol = trade.symbol;
  const partners = SMT_PAIRS[symbol] || [];
  const partnerSymbol = partners[0];

  // 1. Check partner SMT divergence on horizon timeframe
  const partnerFrames = extras.partnerFrames?.[partnerSymbol] || extras.allFrames?.[partnerSymbol];
  let localBars = null;
  let partnerBars = null;

  if (profile.id === "swing") {
    localBars = frames.H1 || frames.H4 || frames.M15;
    partnerBars = partnerFrames?.H1 || partnerFrames?.H4 || partnerFrames?.M15;
  } else if (profile.id === "scalp") {
    localBars = frames.M5 || frames.M15;
    partnerBars = partnerFrames?.M5 || partnerFrames?.M15;
  } else {
    localBars = frames.M15;
    partnerBars = partnerFrames?.M15;
  }

  if (partnerSymbol && Array.isArray(localBars) && Array.isArray(partnerBars)) {
    let smt = null;
    try {
      smt = smtDivergence(localBars, partnerBars, partnerSymbol);
    } catch {}

    if (smt) {
      const dir = trade.dir || 1;
      if (smt.dir === -dir) {
        return {
          score: -50,
          smtSignal: dir === 1 ? "DIVERGENT_BEARISH" : "DIVERGENT_BULLISH",
          partnerSymbol,
          horizon: profile.id,
          reason: `[${profile.tag}] SMT divergence detected opposing trade: ${smt.note}`,
        };
      }
      return {
        score: 60,
        smtSignal: "SUPPORTING",
        partnerSymbol,
        horizon: profile.id,
        reason: `[${profile.tag}] Supporting SMT divergence confirmed: ${smt.note}`,
      };
    }

    return {
      score: 15,
      smtSignal: "CONFIRMING",
      partnerSymbol,
      horizon: profile.id,
      reason: `[${profile.tag}] Symbiotic structure with ${partnerSymbol} intact`,
    };
  }

  // 2. Fallback: Check Higher Timeframe Trend Alignment tailored to horizon
  const dir = trade.dir || 1;
  let macroBarsA = null;
  let macroBarsB = null;

  if (profile.id === "swing") {
    macroBarsA = frames.D1 || frames.H4;
    macroBarsB = frames.H4 || frames.H1;
  } else if (profile.id === "scalp") {
    macroBarsA = frames.H1 || frames.M15;
    macroBarsB = frames.M15 || frames.M5;
  } else {
    macroBarsA = frames.H4;
    macroBarsB = frames.H1;
  }

  if (Array.isArray(macroBarsA) && macroBarsA.length >= 10 && Array.isArray(macroBarsB) && macroBarsB.length >= 10) {
    const trendA = macroBarsA[macroBarsA.length - 1].close > macroBarsA[macroBarsA.length - 10].close ? 1 : -1;
    const trendB = macroBarsB[macroBarsB.length - 1].close > macroBarsB[macroBarsB.length - 10].close ? 1 : -1;
    if (trendA === dir && trendB === dir) {
      return {
        score: 25,
        smtSignal: "HTF_ALIGNED",
        partnerSymbol: null,
        horizon: profile.id,
        reason: `[${profile.tag}] Macro structural momentum aligned with trade`,
      };
    }
  }

  return {
    score: 0,
    smtSignal: "NEUTRAL",
    partnerSymbol: partnerSymbol || null,
    horizon: profile.id,
    reason: `[${profile.tag}] No cross-asset or HTF divergence detected; neutral alignment`,
  };
}

/**
 * Pillar 5: Session Lifecycle, Weekend Gap & Volatility Regime (Horizon-Tailored)
 */
export function evaluateSessionVolatility(trade = {}, frames = {}, horizonConfig = null, nowTime = null) {
  const profile = (horizonConfig && HORIZON_PROFILES[horizonConfig.id?.toUpperCase()]) || resolveTradeHorizon(trade);
  const now = nowTime ? new Date(nowTime) : new Date();
  const utcHours = now.getUTCHours();
  const utcMins = now.getUTCMinutes();
  const utcDay = now.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
  const totalMin = utcHours * 60 + utcMins;

  let sessionScore = 0;
  let sessionPhase = "MID_SESSION";

  // 1. Session Filter based on Horizon
  if (profile.id === "swing") {
    // SWING: Holds across multiple days and sessions.
    // Asian session dead zone does NOT penalize swings! Only Friday market close carries weekend gap risk.
    if (utcDay === 5 && totalMin >= 1110) {
      sessionScore = -50;
      sessionPhase = "WEEKEND_APPROACH";
    } else if (totalMin >= 420 && totalMin <= 930) {
      sessionScore = 20;
      sessionPhase = "ACTIVE_MACRO_SESSION";
    } else {
      sessionScore = 0; // Neutral overnight / Asian hold
      sessionPhase = "SWING_HOLD_NEUTRAL";
    }
  } else if (profile.id === "scalp") {
    // SCALP: Ultra-strict killzone timing. Scalps MUST be executed in active killzones.
    // Off-hours / Asian consolidation / dead zone heavily penalized (-70) due to spread widen and chop.
    if (utcDay === 5 && totalMin >= 1020) {
      sessionScore = -60;
      sessionPhase = "WEEKEND_APPROACH";
    } else if (totalMin >= 750 && totalMin <= 930) {
      sessionScore = 70; // NY AM prime expansion killzone
      sessionPhase = "PRIME_KILLZONE";
    } else if (totalMin >= 420 && totalMin <= 600) {
      sessionScore = 65; // London Open prime killzone
      sessionPhase = "PRIME_KILLZONE";
    } else if (totalMin >= 1050 && totalMin <= 1170) {
      sessionScore = 30; // NY PM session
      sessionPhase = "PRIME_KILLZONE";
    } else if (totalMin >= 930 && totalMin <= 1005) {
      sessionScore = -35; // London close fix chop
      sessionPhase = "LONDON_CLOSE_CHOP";
    } else {
      sessionScore = -70; // Off-hours / dead zone / Asian chop
      sessionPhase = "DEAD_ZONE_PROHIBITIVE";
    }
  } else {
    // DAY TRADE: Standard institutional day trading schedule
    if (utcDay === 5 && totalMin >= 1110) {
      sessionScore = -40;
      sessionPhase = "WEEKEND_APPROACH";
    } else if (totalMin >= 750 && totalMin <= 930) {
      sessionScore = 60; // NY AM prime expansion
      sessionPhase = "PRIME_EXPANSION";
    } else if (totalMin >= 420 && totalMin <= 660) {
      sessionScore = 50; // London open trend window
      sessionPhase = "PRIME_EXPANSION";
    } else if (totalMin >= 930 && totalMin <= 1005) {
      sessionScore = -25; // London close fix
      sessionPhase = "LONDON_CLOSE_FIX";
    } else if (totalMin >= 1050 && totalMin <= 1200) {
      sessionScore = 20; // NY PM session
      sessionPhase = "NY_PM_TREND";
    } else if (totalMin >= 1200 || totalMin < 360) {
      sessionScore = -50; // Dead zone
      sessionPhase = "DEAD_ZONE";
    } else {
      sessionScore = 0;
      sessionPhase = "MID_SESSION";
    }
  }

  // 2. Volatility ATR check tailored to horizon
  let atrRatio = 1.0;
  let volBars = null;
  if (profile.id === "swing") volBars = frames.H4 || frames.H1 || frames.M15;
  else if (profile.id === "scalp") volBars = frames.M5 || frames.M15;
  else volBars = frames.M15;

  if (Array.isArray(volBars) && volBars.length >= 25) {
    const recentAtr = avgRange(volBars.slice(-6));
    const baseAtr = avgRange(volBars.slice(-24));
    if (baseAtr > 0) {
      atrRatio = recentAtr / baseAtr;
      if (profile.id === "scalp") {
        if (atrRatio < 0.70) sessionScore -= 35; // Low volatility is fatal for scalps
        else if (atrRatio > 1.30) sessionScore += 25;
      } else {
        if (atrRatio < 0.65) sessionScore -= 20;
        else if (atrRatio > 1.25) sessionScore += 20;
      }
    }
  }

  return {
    score: clamp(sessionScore, -100, 100),
    sessionPhase,
    atrRatio: Number(atrRatio.toFixed(2)),
    horizon: profile.id,
    horizonTag: profile.tag,
  };
}

/**
 * Composite Redecision Synthesis Engine (Horizon-Adaptive Hysteresis & Brackets)
 */
export function synthesizeRedecision({
  momentum = {},
  obstacles = {},
  dol = {},
  smt = {},
  session = {},
  trade = {},
  currentPrice = null,
  horizonConfig = null,
}) {
  const profile = (horizonConfig && HORIZON_PROFILES[horizonConfig.id?.toUpperCase()]) || resolveTradeHorizon(trade);
  const risk = initialTradeRisk(trade);
  const entry = Number(trade.filledPrice || trade.entryPrice);
  const currentTp = Number(trade.tpPrice);
  const currentRR = Number(trade.targetRR || (profile.id === "swing" ? 4.0 : profile.id === "scalp" ? 1.8 : 2.5));
  const dir = trade.dir || 1;
  const digits = Number(trade.symbolSpec?.digits || 5);
  const isSwing = profile.id === "swing";
  const isScalp = profile.id === "scalp";
  const isDay = profile.id === "day";

  // Weighted Composite Redecision Score based on Horizon Profile
  const w = profile.weights;
  const compositeScore = Math.round(
    w.momentum * (momentum.score || 0) +
    w.obstacles * (obstacles.score || 0) +
    w.dol * (dol.score || 0) +
    w.smt * (smt.score || 0) +
    w.session * (session.score || 0)
  );

  const clampedScore = clamp(compositeScore, -100, 100);

  // DECISION MATRIX

  // 1. RULE: CLOSE_FULL_NOW
  const fatalOpposingMss = momentum.opposingMss === true && (momentum.mssAge == null || momentum.mssAge <= 4);
  const sweptDolWithRejection = dol.status === "ALREADY_SWEPT" && momentum.opposingWickRatio >= profile.opposingWickTolerance;
  const severeCompositeFailure = clampedScore <= profile.closeThreshold;
  const scalpDeadZoneAbort = isScalp && session.sessionPhase === "DEAD_ZONE_PROHIBITIVE" && clampedScore <= 0;

  if (fatalOpposingMss || sweptDolWithRejection || severeCompositeFailure || scalpDeadZoneAbort) {
    const primaryReason = fatalOpposingMss
      ? `Opposing displaced Market Structure Shift confirmed on ${profile.primaryTf} (${momentum.mssAge ?? 1} bars ago)`
      : sweptDolWithRejection
      ? `Primary Draw on Liquidity already swept with heavy rejection wicks`
      : scalpDeadZoneAbort
      ? `Scalp session expired into dead zone / off-hours with deteriorating liquidity`
      : `Composite Redecision Score collapsed to ${clampedScore}/100`;

    return {
      action: "CLOSE_FULL_NOW",
      score: clampedScore,
      confidence: Math.abs(clampedScore),
      reason: `Redecision [${profile.tag}]: Close remaining runner immediately at market (${primaryReason})`,
      newTpPrice: null,
      newTargetRR: null,
      oldTpPrice: currentTp,
      oldTargetRR: currentRR,
      horizon: profile.id,
      horizonLabel: profile.label,
      horizonTag: profile.tag,
      isSwing,
      isScalp,
      isDay,
    };
  }

  // 2. RULE: REDUCE_TP
  const nearestObstacle = obstacles.nearestObstacle;
  const hasObstacleInRunway = nearestObstacle && nearestObstacle.safeBufferRR >= profile.minReducedRR && nearestObstacle.safeBufferRR <= currentRR - 0.15;
  const isWeekendRisk = session.sessionPhase === "WEEKEND_APPROACH";
  const isSluggishDecay = clampedScore < 0 && (momentum.score < 0 || session.score < 0);

  if (hasObstacleInRunway || isWeekendRisk || isSluggishDecay) {
    let targetRR = null;
    let targetPrice = null;

    if (hasObstacleInRunway) {
      targetRR = nearestObstacle.safeBufferRR;
      targetPrice = nearestObstacle.safeBufferPrice;
    } else if (isWeekendRisk) {
      targetRR = Math.min(currentRR - 0.3, Math.max(profile.minReducedRR, Number((currentRR * 0.7).toFixed(1))));
      targetPrice = Number((entry + dir * (risk.distance * targetRR)).toFixed(digits));
    } else {
      targetRR = Math.min(currentRR - 0.3, Math.max(profile.minReducedRR, Number((currentRR * 0.7).toFixed(1))));
      targetPrice = Number((entry + dir * (risk.distance * targetRR)).toFixed(digits));
    }

    // Ensure reduced TP is strictly in profit direction, above min horizon threshold, and less than old TP
    targetRR = clamp(targetRR, profile.minReducedRR, currentRR - 0.10);
    targetPrice = Number((entry + dir * (risk.distance * targetRR)).toFixed(digits));

    const reason = hasObstacleInRunway
      ? `Trimmed target to ${targetRR}R before ${nearestObstacle.name} at ${nearestObstacle.price}`
      : isWeekendRisk
      ? `Trimmed target to ${targetRR}R before Friday weekend market close`
      : `Target conserved to ${targetRR}R due to decelerating volume and session transition`;

    return {
      action: "REDUCE_TP",
      score: clampedScore,
      confidence: Math.max(50, Math.min(95, 80 - clampedScore)),
      reason: `Redecision [${profile.tag}]: ${reason}`,
      newTpPrice: targetPrice,
      newTargetRR: targetRR,
      oldTpPrice: currentTp,
      oldTargetRR: currentRR,
      horizon: profile.id,
      horizonLabel: profile.label,
      horizonTag: profile.tag,
      isSwing,
      isScalp,
      isDay,
    };
  }

  // 3. RULE: EXPAND_TP
  const maxAllowedRR = profile.maxAllowedRR;
  const canExpand = currentRR < maxAllowedRR - 0.2;
  const minExpansionScore = isScalp ? 70 : 65;
  const isExpansionRegime = clampedScore >= minExpansionScore && momentum.score >= 40 && (!obstacles.obstacles || obstacles.obstacles.length === 0);
  const hasExpansionBacking = dol.status === "UNREACHED_MAGNET" || dol.status === "EXPANDING_ACCEPTANCE";

  if (isExpansionRegime && canExpand && hasExpansionBacking) {
    let targetRR = null;

    // If an unreached macro magnet price exists, anchor target directly to it
    if (dol.targetPool?.price && dol.status === "UNREACHED_MAGNET") {
      const poolDistRR = Number((dir * (dol.targetPool.price - entry) / risk.distance).toFixed(1));
      if (poolDistRR > currentRR + 0.3 && poolDistRR <= maxAllowedRR + 0.5) {
        targetRR = Math.min(maxAllowedRR, poolDistRR);
      }
    }

    if (!targetRR) {
      targetRR = Math.min(maxAllowedRR, Number((currentRR + profile.expandStep).toFixed(1)));
    }

    const targetPrice = Number((entry + dir * (risk.distance * targetRR)).toFixed(digits));

    return {
      action: "EXPAND_TP",
      score: clampedScore,
      confidence: Math.min(95, clampedScore),
      reason: `Redecision [${profile.tag}]: Target expanded to ${targetRR}R (Runaway expansion momentum with clean runway to macro DOL)`,
      newTpPrice: targetPrice,
      newTargetRR: targetRR,
      oldTpPrice: currentTp,
      oldTargetRR: currentRR,
      horizon: profile.id,
      horizonLabel: profile.label,
      horizonTag: profile.tag,
      isSwing,
      isScalp,
      isDay,
    };
  }

  // 4. RULE: HOLD_FULL_TP (Default Conviction Hold)
  return {
    action: "HOLD_FULL_TP",
    score: clampedScore,
    confidence: Math.max(50, Math.min(90, 50 + clampedScore / 2)),
    reason: `Redecision [${profile.tag}]: Conviction hold for full ${currentRR}R target (Trajectory and institutional runway remain intact)`,
    newTpPrice: currentTp,
    newTargetRR: currentRR,
    oldTpPrice: currentTp,
    oldTargetRR: currentRR,
    horizon: profile.id,
    horizonLabel: profile.label,
    horizonTag: profile.tag,
    isSwing,
    isScalp,
    isDay,
  };
}

/**
 * High-Level Coordinator
 * Evaluates live trade redecision at the 50% milestone tailored to the trade's horizon.
 */
export async function evaluateMilestoneRedecision({
  trade = {},
  currentPrice = null,
  frames = {},
  ticks = {},
  extras = {},
} = {}) {
  const profile = resolveTradeHorizon(trade);
  const risk = initialTradeRisk(trade);
  const entry = Number(trade.filledPrice || trade.entryPrice);
  const targetRR = Number(trade.targetRR || (profile.id === "swing" ? 4.0 : profile.id === "scalp" ? 1.8 : 2.5));
  const halfRR = Number((targetRR * 0.5).toFixed(2));

  // Select momentum candle series tailored to the horizon
  let momentumBars = [];
  if (profile.id === "swing") {
    momentumBars = frames.H1 || frames.H4 || frames.M15 || [];
  } else if (profile.id === "scalp") {
    momentumBars = frames.M5 || frames.M15 || frames.M1 || [];
  } else {
    // Day trade
    momentumBars = frames.M15 || frames.H1 || [];
  }

  // Evaluate the 5 analytical pillars using the horizon profile
  const momentum = evaluateMomentumVelocity(momentumBars, trade, currentPrice, profile);
  const obstacles = evaluateOpposingObstacles(frames, trade, currentPrice, profile);
  const dol = evaluateDrawOnLiquidity(frames, trade, currentPrice, profile);
  const smt = evaluateLeadLagSMT(trade, frames, ticks, extras, profile);
  const session = evaluateSessionVolatility(trade, frames, profile, extras.now);

  // Synthesize into final verdict
  const verdict = synthesizeRedecision({
    momentum,
    obstacles,
    dol,
    smt,
    session,
    trade,
    currentPrice,
    horizonConfig: profile,
  });

  return {
    ok: true,
    ...verdict,
    horizon: profile.id,
    horizonLabel: profile.label,
    horizonTag: profile.tag,
    milestoneR: halfRR,
    entryPrice: entry,
    currentPrice,
    riskDistance: risk.distance,
    pillars: {
      momentum,
      obstacles: {
        score: obstacles.score,
        count: obstacles.obstacles.length,
        nearestObstacle: obstacles.nearestObstacle,
      },
      dol: {
        score: dol.score,
        status: dol.status,
        targetPool: dol.targetPool,
      },
      smt: {
        score: smt.score,
        smtSignal: smt.smtSignal,
        partnerSymbol: smt.partnerSymbol,
      },
      session: {
        score: session.score,
        sessionPhase: session.sessionPhase,
        atrRatio: session.atrRatio,
      },
    },
    evaluatedAt: new Date().toISOString(),
  };
}
