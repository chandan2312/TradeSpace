// Autonomous Pre-Entry Validation Engine (APVE)
// Lightweight pre-entry thesis verification executed right before arming, limit order placement,
// and tick entry trigger to ensure that structural or market changes during the staged window
// have not invalidated the trade idea.

import { avgRange } from "../patterns/core.js";
import { getCurrentTimeSlot, getEetTime } from "./timeslots.js";
import { canonOf } from "./symbols.js";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const finite = (v) => v != null && Number.isFinite(Number(v));
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

/**
 * Pillar 1: Level Geometry & Structural Lifecycle
 * Lightweight checks: Stop Loss breach, Target already achieved, or Dealing Range extreme blowout.
 */
export function evaluateLevelGeometry(trade, currentPrice, frames = {}) {
  const vetoes = [];
  const entry = Number(trade.entryPrice);
  const sl = Number(trade.initialSlPrice ?? trade.slPrice);
  const tp = Number(trade.fullTp ?? trade.targetDOL?.price ?? trade.targets?.at(-1)?.price ?? trade.tpPrice);
  const dir = Number(trade.dir);

  if (!positive(entry) || !positive(sl)) {
    return { pass: true, score: 25, details: { note: "Missing geometry bounds, bypassed" } };
  }

  // Gracefully fallback to latest candle close or entry if currentPrice is not a positive quote
  const price = positive(currentPrice)
    ? Number(currentPrice)
    : Number(frames?.M15?.at(-1)?.close ?? frames?.M5?.at(-1)?.close ?? entry);

  // 1. Structural stop breach before fill
  if (dir === 1 && price <= sl) {
    vetoes.push({
      code: "STOP_ALREADY_BREACHED",
      reason: `Structural stop level (${sl}) was breached prior to entry fill (current: ${price})`,
      pillar: "geometry",
    });
  } else if (dir === -1 && price >= sl) {
    vetoes.push({
      code: "STOP_ALREADY_BREACHED",
      reason: `Structural stop level (${sl}) was breached prior to entry fill (current: ${price})`,
      pillar: "geometry",
    });
  }

  // 2. Full target already achieved before entry (move completed, chasing exhausted move)
  if (positive(tp)) {
    if (dir === 1 && price >= tp) {
      vetoes.push({
        code: "TARGET_ALREADY_REACHED",
        reason: `Target price (${tp}) was already reached prior to entry fill (move already played out)`,
        pillar: "geometry",
      });
    } else if (dir === -1 && price <= tp) {
      vetoes.push({
        code: "TARGET_ALREADY_REACHED",
        reason: `Target price (${tp}) was already reached prior to entry fill (move already played out)`,
        pillar: "geometry",
      });
    }
  }

  // 3. Dealing range structural extreme break (if dealingRange is recorded and stop was inside range)
  const range = trade.dealingRange || trade.brain?.dealingRange;
  const isRaidModel = String(trade.modelId || trade.entryModel?.id).toLowerCase() === "turtle_soup";
  if (!isRaidModel && range && finite(range.high) && finite(range.low) && range.high > range.low) {
    const slInside = dir === 1 ? sl >= range.low : sl <= range.high;
    if (slInside) {
      const bars = frames?.M15 || frames?.H1 || [];
      const lastBar = bars.at(-1);
      if (lastBar) {
        if (dir === 1 && lastBar.close < range.low) {
          vetoes.push({
            code: "DEALING_RANGE_BLOWN",
            reason: `Dealing range low (${range.low}) broken with candle close (${lastBar.close}); range invalidated`,
            pillar: "geometry",
          });
        } else if (dir === -1 && lastBar.close > range.high) {
          vetoes.push({
            code: "DEALING_RANGE_BLOWN",
            reason: `Dealing range high (${range.high}) broken with candle close (${lastBar.close}); range invalidated`,
            pillar: "geometry",
          });
        }
      }
    }
  }

  const pass = vetoes.length === 0;
  return {
    pass,
    score: pass ? 25 : 0,
    vetoes,
    details: { entry, sl, tp, price, rangeVerified: Boolean(range) },
  };
}

/**
 * Pillar 2: Adverse Freight Train / Momentum Expansion
 * Differentiates healthy gradual retracements from violent multi-candle marubozu expansions
 * crashing straight through the POI without deceleration.
 */
export function evaluateAdverseVelocity(trade, frames = {}) {
  const vetoes = [];
  const dir = Number(trade.dir);
  const tf = trade.tf || "M15";
  const canonTf = tf === "5M" ? "M5" : tf === "15M" ? "M15" : tf === "30M" ? "M30" : tf === "1H" ? "H1" : tf === "4H" ? "H4" : tf === "1D" ? "D1" : tf;
  const bars = frames?.[tf] || frames?.[canonTf] || frames?.M15 || frames?.M5 || [];

  if (bars.length < 5) {
    return { pass: true, score: 25, vetoes: [], details: { state: "INSUFFICIENT_BARS_PASS" } };
  }

  const aRange = avgRange(bars, 30);
  const recent = bars.slice(-3); // Last 3 completed candles approaching the zone

  // Check if ALL 3 recent candles are strongly adverse (bearish for buy, bullish for sell)
  const allAdverse = recent.every((b) => (dir === 1 ? b.close < b.open : b.close > b.open));

  if (allAdverse) {
    const avgBody = recent.reduce((sum, b) => sum + Math.abs(b.close - b.open), 0) / 3;
    const avgCandleRange = recent.reduce((sum, b) => sum + (b.high - b.low), 0) / 3;
    const bodyRatio = avgCandleRange > 0 ? avgBody / avgCandleRange : 0;
    const atrMultiplier = aRange > 0 ? avgCandleRange / aRange : 1;

    // Freight train: 3 consecutive adverse candles, > 75% body ratio (marubozu), and > 2.0x average ATR
    if (bodyRatio >= 0.75 && atrMultiplier >= 2.0) {
      vetoes.push({
        code: "ADVERSE_FREIGHT_TRAIN",
        reason: `Violent adverse momentum expansion (${atrMultiplier.toFixed(1)}x ATR, ${(bodyRatio * 100).toFixed(0)}% body) crashing towards entry without deceleration`,
        pillar: "velocity",
      });
    }
  }

  const pass = vetoes.length === 0;
  return {
    pass,
    score: pass ? 25 : 0,
    vetoes,
    details: { allAdverse, avgRange: aRange },
  };
}

/**
 * Pillar 3: Model-Specific Entry Integrity
 * Tailored lightweight structural checks for each distinct entry model.
 */
export function evaluateModelSpecificIntegrity(trade, frames = {}, currentPrice = null) {
  const vetoes = [];
  const modelId = String(trade.modelId || trade.entryModel?.id || trade.stagedLevel?.modelId || "ict_2022").toLowerCase();
  const dir = Number(trade.dir);
  const tf = trade.tf || "M15";
  const canonTf = tf === "5M" ? "M5" : tf === "15M" ? "M15" : tf === "30M" ? "M30" : tf === "1H" ? "H1" : tf === "4H" ? "H4" : tf === "1D" ? "D1" : tf;
  const bars = frames?.[tf] || frames?.[canonTf] || frames?.M15 || frames?.H1 || frames?.M5 || [];

  switch (modelId) {
    // -------------------------------------------------------------
    // MODEL 1: ICT 2022 (Displacement + MSS + FVG CE)
    // -------------------------------------------------------------
    case "ict_2022": {
      const fvg = trade.stagedLevel?.fvg || trade.levelDetails?.fvg || trade.fvg;
      const lastBar = bars.at(-1);

      // Check A: FVG Inversion / Complete Collapse
      // If a candle body closes completely beyond the far edge of the FVG, it has failed as support/resistance
      if (fvg && finite(fvg.bottom) && finite(fvg.top) && lastBar) {
        if (dir === 1 && lastBar.close < fvg.bottom) {
          vetoes.push({
            code: "FVG_INVERTED_FAILURE",
            reason: `${tf} candle closed (${lastBar.close}) below virgin FVG floor (${fvg.bottom}); FVG inverted into resistance`,
            pillar: "modelSpecific",
          });
        } else if (dir === -1 && lastBar.close > fvg.top) {
          vetoes.push({
            code: "FVG_INVERTED_FAILURE",
            reason: `${tf} candle closed (${lastBar.close}) above virgin FVG ceiling (${fvg.top}); FVG inverted into support`,
            pillar: "modelSpecific",
          });
        }
      }
      break;
    }

    // -------------------------------------------------------------
    // MODEL 2: Turtle Soup (External Liquidity Purge & Reversal)
    // -------------------------------------------------------------
    case "turtle_soup": {
      const sweptLevel = trade.stagedLevel?.sweptLevel ?? trade.levelDetails?.sweptLevel ?? trade.entryPrice;
      const riskDist = trade.initialRiskDistance || Math.abs(Number(trade.entryPrice) - Number(trade.slPrice));
      const sl = Number(trade.initialSlPrice ?? trade.slPrice);
      const lastBar = bars.at(-1);

      // Check A: Runaway Breakout instead of Sweep Reclaim
      // Only veto if price closed beyond the raid buffer AND at/beyond the stop loss boundary
      if (finite(sweptLevel) && lastBar) {
        const threshold = dir === 1
          ? (positive(sl) ? Math.min(sl, sweptLevel - (riskDist || 0.001) * 1.2) : sweptLevel - (riskDist || 0.001) * 1.2)
          : (positive(sl) ? Math.max(sl, sweptLevel + (riskDist || 0.001) * 1.2) : sweptLevel + (riskDist || 0.001) * 1.2);

        if (dir === 1 && lastBar.close < threshold) {
          vetoes.push({
            code: "SWEEP_FAILED_BREAKOUT",
            reason: `Market accepted below raid level (${sweptLevel}) with closed bar (${lastBar.close}); false breakout thesis invalidated`,
            pillar: "modelSpecific",
          });
        } else if (dir === -1 && lastBar.close > threshold) {
          vetoes.push({
            code: "SWEEP_FAILED_BREAKOUT",
            reason: `Market accepted above raid level (${sweptLevel}) with closed bar (${lastBar.close}); false breakout thesis invalidated`,
            pillar: "modelSpecific",
          });
        }
      }
      break;
    }

    // -------------------------------------------------------------
    // MODEL 3: Breaker Block (Failed Opposing OB Mitigation Retest)
    // -------------------------------------------------------------
    case "breaker_block": {
      const breaker = trade.stagedLevel?.breaker || trade.levelDetails?.breaker;
      const lastBar = bars.at(-1);

      // Check A: Candle close through breaker structural boundary
      if (breaker && finite(breaker.bottom) && finite(breaker.top) && lastBar) {
        if (dir === 1 && lastBar.close < breaker.bottom) {
          vetoes.push({
            code: "BREAKER_STRUCTURE_BROKEN",
            reason: `Candle closed (${lastBar.close}) below breaker block boundary (${breaker.bottom}); mitigation structure failed`,
            pillar: "modelSpecific",
          });
        } else if (dir === -1 && lastBar.close > breaker.top) {
          vetoes.push({
            code: "BREAKER_STRUCTURE_BROKEN",
            reason: `Candle closed (${lastBar.close}) above breaker block boundary (${breaker.top}); mitigation structure failed`,
            pillar: "modelSpecific",
          });
        }
      }
      break;
    }

    // -------------------------------------------------------------
    // MODEL 4: OTE Continuation (0.618 - 0.786 Fibonacci Retracement)
    // -------------------------------------------------------------
    case "ote_continuation": {
      const ote = trade.stagedLevel?.ote || trade.levelDetails?.ote;
      const swingOrigin = ote?.swingOrigin ?? trade.stagedLevel?.swingLow ?? trade.initialSlPrice;
      const lastBar = bars.at(-1);

      // Check A: Swing Anchor Breached (100% Retracement violation)
      // If price breached the swing origin, the swing leg is broken
      if (finite(swingOrigin) && lastBar) {
        if (dir === 1 && lastBar.close < swingOrigin) {
          vetoes.push({
            code: "OTE_SWING_ANCHOR_BREACHED",
            reason: `Price closed (${lastBar.close}) beyond 100% retracement (${swingOrigin}); impulse anchor invalidated`,
            pillar: "modelSpecific",
          });
        } else if (dir === -1 && lastBar.close > swingOrigin) {
          vetoes.push({
            code: "OTE_SWING_ANCHOR_BREACHED",
            reason: `Price closed (${lastBar.close}) beyond 100% retracement (${swingOrigin}); impulse anchor invalidated`,
            pillar: "modelSpecific",
          });
        }
      }
      break;
    }

    // -------------------------------------------------------------
    // MODEL 5: Silver Bullet (Time & Liquidity Window)
    // -------------------------------------------------------------
    case "silver_bullet": {
      const now = new Date();
      const slot = getCurrentTimeSlot(now);
      if (slot && !["london_open", "ny_silver_bullet", "ny_am", "ny_open"].includes(slot.id)) {
        vetoes.push({
          code: "SILVER_BULLET_WINDOW_EXPIRED",
          reason: `Silver Bullet execution window (${slot.name}) has elapsed`,
          pillar: "modelSpecific",
        });
      }
      break;
    }

    default:
      break;
  }

  const pass = vetoes.length === 0;
  return {
    pass,
    score: pass ? 25 : 0,
    vetoes,
    details: { modelId },
  };
}

/**
 * Pillar 4: External Market & Macro Regime
 * Lightweight checks for macro trend inversion and toxic spread rollover dead zones.
 */
export function evaluateExternalRegime(trade, brain = null, config = {}, now = new Date()) {
  const vetoes = [];
  const dir = Number(trade.dir);

  // 1. Toxic Rollover Dead Zone Check (00:00 - 02:00 EET spread spikes)
  const { h } = getEetTime(new Date(now));
  const isDeadZone = h >= 0 && h < 2;
  const allowDeadZone = config.allowedTimeSlots?.dead_zone === true;

  if (isDeadZone && !allowDeadZone) {
    vetoes.push({
      code: "DEAD_ZONE_RESTRICTION",
      reason: "Entry triggered inside 00:00–02:00 EET daily rollover window (high spread friction)",
      pillar: "externalRegime",
    });
  }

  // 2. Macro Directional Thesis Inversion
  // If higher-timeframe brain bias has flipped completely opposing the trade with high conviction (>= 60)
  if (brain) {
    const macroDir = brain.macroDir ?? (brain.macroBias === "BULLISH" ? 1 : brain.macroBias === "BEARISH" ? -1 : 0);
    const conviction = Number(brain.conviction || brain.macroConviction || 50);

    if (macroDir !== 0 && dir !== 0 && macroDir !== dir && conviction >= 60) {
      vetoes.push({
        code: "MACRO_BIAS_INVERTED",
        reason: `Higher timeframe macro bias inverted to ${brain.macroBias} (${conviction}% conviction) against trade`,
        pillar: "externalRegime",
      });
    }
  }

  const pass = vetoes.length === 0;
  return {
    pass,
    score: pass ? 25 : 0,
    vetoes,
    details: { isDeadZone, macroVerified: Boolean(brain) },
  };
}

/**
 * Master Coordinator: Autonomous Pre-Entry Validation Engine (APVE)
 * Synthesizes all 4 pillars to deliver a definitive, non-restrictive go/no-go verdict on entry.
 */
export async function validatePreEntrySetup({
  trade,
  frames = {},
  currentPrice = null,
  brain = null,
  config = {},
  now = new Date(),
} = {}) {
  if (!trade) {
    return { ok: false, action: "VETO", score: 0, vetoes: [{ code: "MISSING_TRADE", reason: "No trade provided" }] };
  }

  const geometry = evaluateLevelGeometry(trade, currentPrice, frames);
  const velocity = evaluateAdverseVelocity(trade, frames);
  const modelSpecific = evaluateModelSpecificIntegrity(trade, frames, currentPrice);
  const externalRegime = evaluateExternalRegime(trade, brain || trade.brain, config, now);

  const allVetoes = [
    ...geometry.vetoes,
    ...velocity.vetoes,
    ...modelSpecific.vetoes,
    ...externalRegime.vetoes,
  ];

  const totalScore = geometry.score + velocity.score + modelSpecific.score + externalRegime.score;
  const ok = allVetoes.length === 0;

  return {
    ok,
    action: ok ? "PROCEED" : "VETO",
    score: totalScore,
    modelId: trade.modelId || trade.entryModel?.id || "ict_2022",
    horizon: trade.horizon || "day",
    vetoes: allVetoes,
    reasons: allVetoes.map((v) => v.reason),
    pillars: {
      geometry,
      velocity,
      modelSpecific,
      externalRegime,
    },
    evaluatedAt: new Date(now),
  };
}
