// Autonomous Stop-Loss Engine (ASLE)
// Dedicated micro-engine for high-precision, noise-free, structure-anchored Stop Loss computations,
// model-specific invalidation arbitrations, volatility noise filtering, and dynamic SL lifecycle management.

import { avgRange, findPivots } from "../patterns/core.js";
import { confirmedFractals } from "../bias/institutional.js";
import { symbolUnits } from "./models.js";

const finite = (v) => v != null && Number.isFinite(Number(v));
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

/**
 * Institutional Horizon Stop-Loss Profiles
 * Defines the structural timeframe, buffer weighting, and asset-specific noise floors.
 */
export const HORIZON_SL_PROFILES = {
  SWING: {
    id: "swing",
    horizonCode: 1,
    tag: "SWG",
    label: "Macro Swing Structure (D1/H4)",
    macroTf: "D1",
    sessionTf: "H4",
    triggerTf: "H1",
    bufferAtrMult: 1.25,
    maxRangeRatio: 0.40, // SL cannot exceed 40% of macro dealing range
    noiseFloorUnits: {
      index: 80.0,   // e.g. NAS100 min 80 pts
      metal: 12.0,   // e.g. Gold min $12.00
      crypto: 800.0, // e.g. BTC min $800
      fx: 35.0,      // e.g. EURUSD min 35 pips
      default: 30.0,
    },
  },
  DAY: {
    id: "day",
    horizonCode: 2,
    tag: "DAY",
    label: "Session Deal Range Structure (H4/H1/15M)",
    macroTf: "H4",
    sessionTf: "H1",
    triggerTf: "M15",
    bufferAtrMult: 0.75,
    maxRangeRatio: 0.35, // SL cannot exceed 35% of session dealing range
    noiseFloorUnits: {
      index: 25.0,   // e.g. NAS100 min 25 pts
      metal: 4.5,    // e.g. Gold min $4.50
      crypto: 250.0, // e.g. BTC min $250
      fx: 12.0,      // e.g. EURUSD min 12 pips
      default: 12.0,
    },
  },
  SCALP: {
    id: "scalp",
    horizonCode: 3,
    tag: "SCP",
    label: "Intraday Scalp Structure (30M/15M/5M)",
    macroTf: "M30",
    sessionTf: "15M",
    triggerTf: "M5",
    bufferAtrMult: 0.45,
    maxRangeRatio: 0.30, // SL cannot exceed 30% of intraday dealing range
    noiseFloorUnits: {
      index: 10.0,   // e.g. NAS100 min 10 pts
      metal: 1.5,    // e.g. Gold min $1.50
      crypto: 80.0,  // e.g. BTC min $80
      fx: 4.0,       // e.g. EURUSD min 4 pips
      default: 4.0,
    },
  },
};

/**
 * Resolves active horizon profile from scenario / config
 */
export function resolveHorizonProfile(scenario = {}, config = {}) {
  const sId = String(scenario?.id || config.horizonMode || "").toLowerCase();
  const code = Number(scenario?.horizonCode);
  if (sId === "swing" || code === 1) return HORIZON_SL_PROFILES.SWING;
  if (sId === "scalp" || code === 3) return HORIZON_SL_PROFILES.SCALP;
  return HORIZON_SL_PROFILES.DAY;
}

/**
 * Calculates asset-class noise floor in price units
 */
export function calculateAssetNoiseFloor(symbol, category, horizonProfile, units = {}) {
  const floorInUnits = horizonProfile.noiseFloorUnits[category] || horizonProfile.noiseFloorUnits.default;
  const unitSize = units.pip || units.point || 1.0;
  return floorInUnits * unitSize;
}

/**
 * Computes asymmetric spread and wick noise clearance buffer.
 * Short positions exit on Ask price (Bid + Spread). If SL sits directly at a swing high,
 * an Ask wick stopout will trigger even if the bar never breached the swing high.
 */
export function calculateSpreadNoiseBuffer({ dir, spread, avgBarRange, units, horizonProfile }) {
  const spreadPrice = Number(spread) || 0;
  const avg = Number(avgBarRange) || (units.pip ? units.pip * 10 : 1.0);

  // 1. Asymmetric spread compensation:
  // Short positions get 1.25x spread buffer; long positions get 0.5x spread buffer.
  const spreadComponent = dir === -1 ? spreadPrice * 1.25 : spreadPrice * 0.5;

  // 2. Structural volatility buffer: scaled by horizon profile
  const volatilityComponent = avg * horizonProfile.bufferAtrMult;

  // 3. Minimum tick quantization buffer (at least 2 pips / points)
  const minTickBuffer = Math.max(
    (units.pip ? units.pip * 2 : 0),
    (units.point ? units.point * 2 : 0)
  );

  const totalBuffer = Math.max(volatilityComponent + spreadComponent, minTickBuffer);

  return {
    totalBuffer: Number(totalBuffer.toFixed(units.digits || 5)),
    spreadComponent: Number(spreadComponent.toFixed(units.digits || 5)),
    volatilityComponent: Number(volatilityComponent.toFixed(units.digits || 5)),
  };
}

/**
 * Resolves model-specific invalidation anchor price
 * Every institutional model has a strictly defined point where its thesis ceases to exist.
 */
export function resolveModelInvalidationAnchor({
  modelId = "",
  dir,
  entry,
  zoneLow,
  zoneHigh,
  extreme,
  evidence = {},
  bars = [],
  dealingRange = null,
  horizonProfile,
}) {
  const id = String(modelId).toLowerCase();
  const validEntry = Number(entry);

  // 1. Model-Specific Structural Anchors
  switch (id) {
    case "ict_2022": {
      // Invalidation: The swing extreme that launched the displacement leg through the MSS pivot
      const raidExtreme = Number(evidence.raid?.extreme ?? extreme);
      const mssPivotPrice = Number(evidence.mss?.brokenPivot?.price);
      if (finite(raidExtreme)) {
        return {
          anchorPrice: raidExtreme,
          anchorType: "ICT_2022_SWEEP_ORIGIN",
          rationale: `Displacement origin of MSS raid @ ${raidExtreme}`,
        };
      }
      break;
    }

    case "turtle_soup": {
      // Invalidation: Peak/trough of the liquidity raid candle (reclaim failure)
      const raidExtreme = Number(evidence.raid?.extreme ?? evidence.rejectionBar?.bar?.low ?? evidence.rejectionBar?.bar?.high ?? extreme);
      if (finite(raidExtreme)) {
        return {
          anchorPrice: raidExtreme,
          anchorType: "TURTLE_SOUP_RAID_WICK",
          rationale: `Extreme wick of the liquidity raid @ ${raidExtreme}`,
        };
      }
      break;
    }

    case "ote_continuation": {
      // Invalidation:
      // For Swing: Macro impulse origin / Dealing range boundary (100% retracement)
      // For Day/Scalp: Outer boundary of the OTE zone (beyond 79% - 88.6% pocket)
      const useMacroOrigin = horizonProfile?.id === "swing";
      const impulseOrigin = dir === 1
        ? (useMacroOrigin
            ? (evidence.impulse?.low?.price ?? evidence.impulse?.low ?? dealingRange?.low ?? zoneLow ?? extreme)
            : (zoneLow ?? evidence.impulse?.low?.price ?? evidence.impulse?.low ?? extreme))
        : (useMacroOrigin
            ? (evidence.impulse?.high?.price ?? evidence.impulse?.high ?? dealingRange?.high ?? zoneHigh ?? extreme)
            : (zoneHigh ?? evidence.impulse?.high?.price ?? evidence.impulse?.high ?? extreme));

      const parsedOrigin = Number(impulseOrigin);
      if (finite(parsedOrigin)) {
        return {
          anchorPrice: parsedOrigin,
          anchorType: useMacroOrigin ? "OTE_IMPULSE_ORIGIN_100" : "OTE_ZONE_BOUNDARY_79",
          rationale: useMacroOrigin
            ? `100% Fibonacci origin / Macro range boundary @ ${parsedOrigin}`
            : `Outer boundary of OTE pocket @ ${parsedOrigin}`,
        };
      }
      break;
    }

    case "fvg_ce": {
      // Invalidation: Opposing boundary of the Fair Value Gap zone
      const opposingBoundary = dir === 1
        ? (zoneLow ?? evidence.fvg?.bottom ?? extreme)
        : (zoneHigh ?? evidence.fvg?.top ?? extreme);
      const parsedBoundary = Number(opposingBoundary);
      if (finite(parsedBoundary)) {
        return {
          anchorPrice: parsedBoundary,
          anchorType: "FVG_BOUNDARY_EXTREME",
          rationale: `Opposing boundary of Fair Value Gap @ ${parsedBoundary}`,
        };
      }
      break;
    }

    case "order_block": {
      // Invalidation: Mean Threshold (50%) or candle extreme of Order Block
      const obBoundary = dir === 1
        ? (zoneLow ?? evidence.ob?.bottom ?? extreme)
        : (zoneHigh ?? evidence.ob?.top ?? extreme);
      const parsedOb = Number(obBoundary);
      if (finite(parsedOb)) {
        return {
          anchorPrice: parsedOb,
          anchorType: "ORDER_BLOCK_EXTREME",
          rationale: `Structural boundary of institutional Order Block @ ${parsedOb}`,
        };
      }
      break;
    }

    case "breaker_block": {
      // Invalidation: The stop-run peak before structure broke through the order block
      const raidExtreme = Number(evidence.raid?.extreme ?? extreme);
      if (finite(raidExtreme)) {
        return {
          anchorPrice: raidExtreme,
          anchorType: "BREAKER_STOP_RUN_EXTREME",
          rationale: `Liquidity sweep extreme prior to breaker displacement @ ${raidExtreme}`,
        };
      }
      break;
    }

    case "silver_bullet": {
      // Invalidation: Killzone in-window swing extreme
      const windowExtreme = dir === 1
        ? Math.min(Number(zoneLow), Number(evidence.displacement?.extreme ?? extreme ?? zoneLow))
        : Math.max(Number(zoneHigh), Number(evidence.displacement?.extreme ?? extreme ?? zoneHigh));
      if (finite(windowExtreme)) {
        return {
          anchorPrice: windowExtreme,
          anchorType: "SILVER_BULLET_WINDOW_EXTREME",
          rationale: `Killzone in-window structural base @ ${windowExtreme}`,
        };
      }
      break;
    }

    default:
      break;
  }

  // 2. Fallback to Local Confirmed Swing Fractal (3-bar / 5-bar pivot)
  if (Array.isArray(bars) && bars.length >= 5) {
    try {
      const fractals = confirmedFractals(bars, 5);
      const relevantPivots = dir === 1 ? fractals.lows : fractals.highs;
      const validPivots = relevantPivots.filter((p) => (dir === 1 ? p.price < validEntry : p.price > validEntry));
      if (validPivots.length > 0) {
        const closestPivot = validPivots.at(-1);
        return {
          anchorPrice: Number(closestPivot.price),
          anchorType: "CONFIRMED_FRACTAL_SWING",
          rationale: `Confirmed 5-bar fractal pivot @ ${closestPivot.price}`,
        };
      }
    } catch {
      // Graceful fallback if fractals detection fails
    }
  }

  // 3. Fallback to Horizon Dealing Range Boundary
  if (dealingRange && finite(dealingRange.low) && finite(dealingRange.high)) {
    const rangeBoundary = dir === 1 ? Number(dealingRange.low) : Number(dealingRange.high);
    if ((dir === 1 && rangeBoundary < validEntry) || (dir === -1 && rangeBoundary > validEntry)) {
      return {
        anchorPrice: rangeBoundary,
        anchorType: `${horizonProfile.tag}_DEALING_RANGE_BOUNDARY`,
        rationale: `${horizonProfile.label} Dealing Range boundary @ ${rangeBoundary}`,
      };
    }
  }

  // 4. Default Fallback: Zone/Extreme Anchor
  const defaultAnchor = dir === 1
    ? Math.min(Number(zoneLow ?? validEntry), Number(extreme ?? validEntry))
    : Math.max(Number(zoneHigh ?? validEntry), Number(extreme ?? validEntry));

  return {
    anchorPrice: defaultAnchor,
    anchorType: "ZONE_EXTREMA_BASE",
    rationale: `Zone structural base @ ${defaultAnchor}`,
  };
}

/**
 * Primary ASLE Computation Engine
 * Computes high-precision, noise-free, structure-anchored Stop Loss with complete audit diagnostics.
 */
export function calculateStructuralStopLoss({
  dir,
  entry,
  modelId = "",
  zoneLow,
  zoneHigh,
  extreme,
  evidence = {},
  scenario = {},
  frames = {},
  ranges = {},
  brain = {},
  symbol = "",
  config = {},
  tf = null,
}) {
  const units = symbolUnits(symbol, { ...config, symbolMeta: frames?.symbolMeta || config?.symbolMeta });
  const horizonProfile = resolveHorizonProfile(scenario, config);
  const entryPrice = Number(entry);

  if (!finite(entryPrice) || !positive(entryPrice) || ![1, -1].includes(dir)) {
    return null;
  }

  // 1. Resolve Horizon Bars & Local Volatility (ATR)
  const sessionTf = horizonProfile.sessionTf;
  const triggerTf = horizonProfile.triggerTf;
  const resolveTfBars = (targetTf) => {
    if (!targetTf) return null;
    const canon = targetTf === "5M" ? "M5" : targetTf === "15M" ? "M15" : targetTf === "30M" ? "M30" : targetTf === "1H" ? "H1" : targetTf === "4H" ? "H4" : targetTf === "1D" ? "D1" : targetTf;
    return frames?.[targetTf] || frames?.[canon] || null;
  };

  const setupBars = (
    resolveTfBars(sessionTf)
    || resolveTfBars(triggerTf)
    || resolveTfBars(tf)
    || (horizonProfile.id === "swing" ? (frames?.H4 || frames?.H1 || frames?.D1) :
        horizonProfile.id === "day" ? (frames?.H1 || frames?.M15 || frames?.H4) :
        (frames?.M5 || frames?.M15 || frames?.M30 || frames?.["30M"]))
    || []
  );

  const avgBarRange = (setupBars.length >= 3 ? avgRange(setupBars) : null)
    || (units.pip ? units.pip * 10 : units.point ? units.point * 10 : 1.0);

  // 2. Resolve Active Dealing Range
  const dealingRange = brain?.dealingRange || (
    horizonProfile.id === "swing" ? (ranges?.D1 || ranges?.H4) :
    horizonProfile.id === "day" ? (ranges?.H4 || ranges?.H1) :
    (ranges?.M30 || ranges?.["30M"] || ranges?.M15 || ranges?.M5)
  );

  // 3. Resolve Structural Invalidation Anchor
  const { anchorPrice, anchorType, rationale } = resolveModelInvalidationAnchor({
    modelId,
    dir,
    entry: entryPrice,
    zoneLow,
    zoneHigh,
    extreme,
    evidence,
    bars: setupBars,
    dealingRange,
    horizonProfile,
  });

  // 4. Calculate Asymmetric Spread & Wick Noise Buffer
  const spreadVal = Number(units.spread || config.spreadPrice || 0);
  const { totalBuffer, spreadComponent, volatilityComponent } = calculateSpreadNoiseBuffer({
    dir,
    spread: spreadVal,
    avgBarRange,
    units,
    horizonProfile,
  });

  // 5. Initial Stop Loss Placement: Anchor ± Buffer
  let rawSl = dir === 1
    ? Number((anchorPrice - totalBuffer).toFixed(units.digits || 5))
    : Number((anchorPrice + totalBuffer).toFixed(units.digits || 5));

  // 6. Strict Directional Sanity Check: SL must be strictly opposite of entry
  if (dir === 1 && rawSl >= entryPrice) {
    rawSl = Number((entryPrice - totalBuffer).toFixed(units.digits || 5));
  }
  if (dir === -1 && rawSl <= entryPrice) {
    rawSl = Number((entryPrice + totalBuffer).toFixed(units.digits || 5));
  }

  // 7. Asset-Class Noise Floor Verification
  const assetNoiseFloor = calculateAssetNoiseFloor(symbol, units.category, horizonProfile, units);
  let finalRisk = Math.abs(entryPrice - rawSl);

  let noiseFloorApplied = false;
  const isVerifiedStructuralAnchor = Boolean(
    anchorType &&
    anchorType !== "ZONE_EXTREMA_BASE" &&
    anchorType !== "FALLBACK" &&
    finite(anchorPrice)
  );

  // If there is no genuine structural anchor, enforce the asset noise floor.
  // If a verified structural anchor exists (sweep wick, raid extreme, breaker extreme, FVG boundary, swing pivot),
  // NEVER push the stop into empty space! Only ensure it clears minimum broker execution friction.
  const minExecutionFloor = Math.max(
    spreadComponent * 1.5,
    (units.pip ? units.pip * 2 : units.point ? units.point * 4 : 1.0)
  );

  if (config.enforceNoiseFloor === true || !isVerifiedStructuralAnchor) {
    if (finalRisk < assetNoiseFloor) {
      rawSl = dir === 1
        ? Number((entryPrice - assetNoiseFloor).toFixed(units.digits || 5))
        : Number((entryPrice + assetNoiseFloor).toFixed(units.digits || 5));
      finalRisk = Math.abs(entryPrice - rawSl);
      noiseFloorApplied = true;
    }
  } else if (finalRisk < minExecutionFloor) {
    // Ensure tight structural stops clear bid-ask spread to prevent immediate execution friction stopout
    rawSl = dir === 1
      ? Number((entryPrice - minExecutionFloor).toFixed(units.digits || 5))
      : Number((entryPrice + minExecutionFloor).toFixed(units.digits || 5));
    finalRisk = Math.abs(entryPrice - rawSl);
    noiseFloorApplied = true;
  }

  // 8. Structural Balance & Dealing Range Proportionality Verification
  const dRangeSpan = (dealingRange && finite(dealingRange.high) && finite(dealingRange.low))
    ? Math.abs(dealingRange.high - dealingRange.low)
    : (avgBarRange * 10);

  const riskToRangeRatio = dRangeSpan > 0 ? finalRisk / dRangeSpan : 0.25;
  const isBalanced = riskToRangeRatio <= horizonProfile.maxRangeRatio * 1.25; // 25% tolerance

  const digits = Number(units.digits || 5);
  const finalSl = Number(rawSl.toFixed(digits));
  const riskPips = units.pip > 0 ? Number((finalRisk / units.pip).toFixed(1)) : null;

  return {
    sl: finalSl,
    riskDistance: Number(finalRisk.toFixed(digits)),
    riskPips,
    anchorPrice: Number(anchorPrice.toFixed(digits)),
    anchorType,
    anchorRationale: rationale,
    horizon: horizonProfile.id,
    horizonLabel: horizonProfile.label,
    bufferApplied: totalBuffer,
    spreadBuffer: spreadComponent,
    volatilityBuffer: volatilityComponent,
    noiseFloorApplied,
    assetNoiseFloor: Number(assetNoiseFloor.toFixed(digits)),
    isNoiseFree: isVerifiedStructuralAnchor || finalRisk >= assetNoiseFloor,
    isBalanced,
    riskToRangeRatio: Number(riskToRangeRatio.toFixed(3)),
    dealingRangeSpan: Number(dRangeSpan.toFixed(digits)),
    units,
  };
}

/**
 * Deep Structural Stop Loss Audit & Veto Gatekeeper
 * Evaluates whether an SL is safe, noise-free, and structurally sound prior to arming or execution.
 */
export function auditStopLossIntegrity({
  dir,
  entry,
  sl,
  symbol,
  currentPrice = null,
  scenario = {},
  config = {},
  spreadPrice = 0,
}) {
  const vetoes = [];
  const entryVal = Number(entry);
  const slVal = Number(sl);
  const dirVal = Number(dir);

  if (!finite(entryVal) || !finite(slVal) || ![1, -1].includes(dirVal)) {
    return {
      pass: false,
      vetoes: [{ code: "INVALID_GEOMETRY", reason: "Non-finite entry or stop-loss values" }],
    };
  }

  const risk = Math.abs(entryVal - slVal);
  const horizonProfile = resolveHorizonProfile(scenario, config);
  const units = symbolUnits(symbol, config);
  const noiseFloor = calculateAssetNoiseFloor(symbol, units.category, horizonProfile, units);

  // 1. Directional Geometry
  if (dirVal === 1 && slVal >= entryVal) {
    vetoes.push({ code: "INVERTED_SL_LONG", reason: `Long Stop Loss (${slVal}) is above or equal to Entry (${entryVal})` });
  }
  if (dirVal === -1 && slVal <= entryVal) {
    vetoes.push({ code: "INVERTED_SL_SHORT", reason: `Short Stop Loss (${slVal}) is below or equal to Entry (${entryVal})` });
  }

  // 2. Noise Floor Clearance
  const cand = config.candidate;
  const hasStructuralAnchor = Boolean(
    cand?.structuralStop ||
    cand?.evidence?.raid ||
    cand?.evidence?.fvg ||
    cand?.evidence?.mss ||
    cand?.evidence?.impulse ||
    cand?.evidence?.failedOrderBlock ||
    cand?.evidence?.majorLevel ||
    cand?.slAudit?.anchorType ||
    config.isStructuralTrade
  );
  const minFloor = hasStructuralAnchor
    ? Math.max(spreadPrice * 1.5, (units.pip ? units.pip * 1.5 : units.point ? units.point * 2 : 1.0))
    : (noiseFloor * 0.7);

  const displayDigits = units.digits != null ? units.digits : (units.pip && units.pip < 0.01 ? 5 : 2);
  if (risk < minFloor) {
    vetoes.push({
      code: "SL_IN_NOISE_ZONE",
      reason: `Risk distance (${risk.toFixed(displayDigits)}) is inside market noise zone (min floor: ${minFloor.toFixed(displayDigits)})`,
    });
  }

  // 3. Spread-to-Risk Sanity (Friction Gate)
  const spread = Number(spreadPrice || units.spread || 0);
  const maxSpreadRatio = Number(config.maxSpreadToRisk || 0.25);
  if (risk > 0 && (spread / risk) > maxSpreadRatio + 1e-6) {
    vetoes.push({
      code: "SPREAD_EATS_SL",
      reason: `Spread (${spread.toFixed(4)}) exceeds ${(maxSpreadRatio * 100).toFixed(0)}% of Stop Loss distance (${risk.toFixed(4)})`,
    });
  }

  // 4. Pre-Entry Market Breach Check
  if (positive(currentPrice)) {
    const cur = Number(currentPrice);
    if (dirVal === 1 && cur <= slVal) {
      vetoes.push({ code: "SL_ALREADY_BREACHED", reason: `Current price (${cur}) has already breached Long SL (${slVal})` });
    }
    if (dirVal === -1 && cur >= slVal) {
      vetoes.push({ code: "SL_ALREADY_BREACHED", reason: `Current price (${cur}) has already breached Short SL (${slVal})` });
    }
  }

  return {
    pass: vetoes.length === 0,
    vetoes,
    risk,
    noiseFloor,
    horizon: horizonProfile.id,
    isNoiseFree: risk >= noiseFloor,
  };
}
