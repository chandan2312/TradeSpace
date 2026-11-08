// Closed-bar institutional evidence. Indices are local; identities use bar time.

/**
 * Enhanced Causal Confirmed Fractals Engine
 * - Strict peak/trough validation with plateau tie-break support (flat tops, double tops, EQH/EQL)
 * - Anchors plateau fractals to the right-most edge of the plateau once right confirmation is met
 * - Eliminates deletion of equal highs and lows
 * - Supports asymmetric acceleration on HTF (H4/D1) via rejection wick / displacement
 */
export function confirmedFractals(bars = [], options = 5) {
  let left = 2;
  let right = 2;
  let width = 5;
  let tf = null;
  let allowAsymmetric = true;

  if (typeof options === "number") {
    if (options !== 3 && options !== 5) throw new RangeError("Fractal width must be 3 or 5");
    width = options;
    left = (options - 1) / 2;
    right = (options - 1) / 2;
  } else if (typeof options === "object" && options !== null) {
    width = options.width ?? 5;
    left = options.left ?? Math.floor((width - 1) / 2);
    right = options.right ?? Math.floor((width - 1) / 2);
    tf = options.tf ?? null;
    allowAsymmetric = options.allowAsymmetric !== false;
  }

  const isHtf = tf === "H4" || tf === "D1";
  const out = { highs: [], lows: [] };

  for (let i = left; i < bars.length - 1; i++) {
    for (const [key, field, side] of [["highs", "high", 1], ["lows", "low", -1]]) {
      const price = bars[i][field];
      if (!Number.isFinite(price)) continue;

      // Plateau / Tie-break Handling:
      // If the immediate next bar has the exact same extreme, wait until the right-most edge
      // of the plateau to emit a single unique swing fractal.
      if (i + 1 < bars.length && bars[i + 1][field] === price) {
        continue;
      }

      // Check how far back the plateau extends (equal prices)
      let plateauStart = i;
      while (plateauStart > 0 && bars[plateauStart - 1][field] === price && (i - (plateauStart - 1)) <= left) {
        plateauStart--;
      }
      const plateauLen = i - plateauStart + 1;
      if (plateauLen > 3) {
        // Flat line > 3 bars is consolidation/stale feed, not a swing peak
        continue;
      }

      // Check left historical context strictly before the plateau start
      let leftValid = true;
      for (let j = plateauStart - left; j < plateauStart; j++) {
        if (j < 0) { leftValid = false; break; }
        if (!(side === 1 ? price > bars[j][field] : price < bars[j][field])) {
          leftValid = false;
          break;
        }
      }
      if (!leftValid) continue;

      // Determine required right confirmation bars:
      // On H4/D1, allow asymmetric acceleration (right: 1 or right: 2) when:
      // 1) The swing candle has a clean rejection wick (>= 40% of range), or
      // 2) The immediate following candle displaces strongly away from the extreme.
      let requiredRight = right;
      if (isHtf && allowAsymmetric && right > 1) {
        const b = bars[i];
        const range = b.high - b.low;
        const wick = range > 0
          ? (side === 1 ? b.high - Math.max(b.open, b.close) : Math.min(b.open, b.close) - b.low)
          : 0;
        const hasRejectionWick = range > 0 && (wick / range) >= 0.40;

        const nextBar = bars[i + 1];
        const nextRejection = nextBar && (side === 1 ? nextBar.close < b.low + range * 0.5 : nextBar.close > b.low + range * 0.5);

        if (hasRejectionWick && nextRejection) {
          requiredRight = 1;
        } else if (i + 1 < bars.length && displacementAt(bars, i + 1, -side).valid) {
          requiredRight = 1;
        } else if (right > 2) {
          requiredRight = 2;
        }
      }

      if (i + requiredRight >= bars.length) continue;

      let rightValid = true;
      for (let j = i + 1; j <= i + requiredRight; j++) {
        if (!(side === 1 ? price > bars[j][field] : price < bars[j][field])) {
          rightValid = false;
          break;
        }
      }

      if (rightValid) {
        const confirmedAt = i + requiredRight;
        out[key].push({
          id: `F${width}:${side}:${bars[i].time}`,
          side,
          i,
          price,
          time: bars[i].time,
          confirmedAt,
          confirmationTime: bars[confirmedAt].time,
          knownAt: bars[confirmedAt].time,
          isAsymmetric: requiredRight < right,
          isPlateau: plateauLen > 1,
          plateauLength: plateauLen,
        });
      }
    }
  }
  return out;
}

const volumeOf = (b) => {
  if (!b) return 0;
  for (const k of ["tick_volume", "tickVolume", "volume", "v"]) {
    const val = Number(b[k]);
    if (Number.isFinite(val) && val > 0) return val;
  }
  return 0;
};

export function displacementAt(bars, i, dir, options = {}) {
  const empty = {
    valid: false,
    bodyRatio: 0,
    atrRatio: 0,
    volumeRatio: null,
    atr10: null,
    trAtr10: null,
    effectiveAtr: null,
    closeLocationRatio: 0,
    closeInExtreme: false,
    volumeConfirmed: false,
    volumeEvidence: "UNAVAILABLE",
  };
  if (!bars || i < 1 || i >= bars.length || ![1, -1].includes(dir)) return empty;

  const customAvg = typeof options === "number" ? options : options?.avg;
  const customAtr = typeof options === "object" ? options?.atr : null;
  const minBodyRatio = typeof options === "object" && options?.minBodyRatio != null ? options.minBodyRatio : 0.50;
  const minAtrRatio = typeof options === "object" && options?.minAtrRatio != null ? options.minAtrRatio : 1.0;
  const lookbackSetting = typeof options === "object" && options?.lookback != null ? options.lookback : 10;

  const b = bars[i];
  let tr = 0;
  let volume = 0;
  let volumes = 0;
  const lookback = Math.min(i, Math.max(1, lookbackSetting));
  for (let j = i - lookback; j < i; j++) {
    const prevClose = j > 0 ? (bars[j - 1]?.close ?? bars[j].open) : bars[j].open;
    tr += Math.max(bars[j].high - bars[j].low, Math.abs(bars[j].high - prevClose), Math.abs(bars[j].low - prevClose));
    const v = volumeOf(bars[j]);
    if (v > 0) { volume += v; volumes++; }
  }
  const atr10 = lookback > 0 ? tr / lookback : 0;
  const effectiveAtr = (customAvg && customAvg > 0) ? customAvg : (customAtr && customAtr > 0) ? customAtr : atr10;

  const range = b.high - b.low;
  const body = dir * (b.close - b.open);
  const bodyRatio = range > 0 ? body / range : 0;
  const atrRatio = effectiveAtr > 0 ? range / effectiveAtr : 0;
  const v = volumeOf(b);
  const avgVol = volumes > 0 ? (volume / volumes) : 0;
  const volumeRatio = avgVol > 0 && v > 0 ? v / avgVol : null;

  const closeLocationRatio = range > 0
    ? (dir === 1 ? (b.close - b.low) / range : (b.high - b.close) / range)
    : 0;

  const valid = body > 0 && bodyRatio >= minBodyRatio && atrRatio >= minAtrRatio;

  return {
    valid,
    bodyRatio,
    atrRatio,
    volumeRatio,
    atr10: effectiveAtr,
    trAtr10: atr10,
    effectiveAtr,
    closeLocationRatio,
    closeInExtreme: closeLocationRatio >= 0.70,
    volumeConfirmed: volumeRatio != null && volumeRatio >= 1.0,
    volumeEvidence: volumeRatio == null ? "UNAVAILABLE" : volumeRatio >= 1.5 ? "STRONG" : volumeRatio >= 1.0 ? "CONFIRMED" : "THIN",
  };
}

function lifecycle(bars, zone) {
  const z = {
    ...zone,
    state: "VIRGIN",
    mitigatedAt: null,
    mitigationTime: null,
    fullyMitigatedAt: null,
    fullMitigationTime: null,
    invertedAt: null,
    inversionTime: null,
    invalidatedAt: null,
    invalidationTime: null,
    respectedAt: null,
    respectTime: null,
    tested: false,
    deepestPenetration: null,
    respectQuality: null, // Initialized to null until tested/earned!
    testedAfterInversion: false,
    respectedAfterInversion: false,
    touchCount: 0,
    fillPct: 0,
    originalLife: {
      dir: zone.originalDir ?? zone.dir,
      type: zone.type,
      state: "VIRGIN",
      tested: false,
      mitigatedAt: null,
      mitigationTime: null,
      fullyMitigatedAt: null,
      fullMitigationTime: null,
      respectedAt: null,
      respectTime: null,
      deepestPenetration: null,
      respectQuality: null,
      touchCount: 0,
    },
    invertedLife: null,
  };

  for (let j = z.born + 1; j < bars.length; j++) {
    const b = bars[j];

    // Branch 1: Inverted Zone Lifecycle (iFVG)
    if (z.state === "INVERTED" || z.state === "RESPECTED_INVERTED") {
      // Reclaim / Invalidation: close back through opposite boundary kills it
      const reclaimed = z.dir === 1 ? b.close < z.bottom : b.close > z.top;
      if (reclaimed) {
        z.state = "INVALIDATED";
        z.invalidatedAt = j;
        z.invalidationTime = b.time;
        if (z.invertedLife) {
          z.invertedLife.state = "INVALIDATED";
          z.invertedLife.invalidatedAt = j;
          z.invertedLife.invalidationTime = b.time;
        }
        break;
      }

      // Retest of inverted zone
      if (b.low <= z.top && b.high >= z.bottom) {
        z.testedAfterInversion = true;
        z.tested = true;
        z.touchCount++;
        if (z.mitigatedAt == null || z.mitigatedAt < z.invertedAt) {
          z.mitigatedAt = j;
          z.mitigationTime = b.time;
        }
        const extreme = z.dir === 1 ? b.low : b.high;
        z.deepestPenetration = z.deepestPenetration == null ? extreme : z.dir === 1
          ? Math.min(z.deepestPenetration, extreme) : Math.max(z.deepestPenetration, extreme);

        if (z.invertedLife) {
          z.invertedLife.tested = true;
          z.invertedLife.touchCount++;
          if (z.invertedLife.mitigatedAt == null) {
            z.invertedLife.mitigatedAt = j;
            z.invertedLife.mitigationTime = b.time;
          }
          z.invertedLife.deepestPenetration = z.invertedLife.deepestPenetration == null ? extreme : z.dir === 1
            ? Math.min(z.invertedLife.deepestPenetration, extreme) : Math.max(z.invertedLife.deepestPenetration, extreme);
        }

        const defenseLevel = z.ce;
        const bodyDefended = z.dir === 1
          ? Math.min(b.open, b.close) >= defenseLevel
          : Math.max(b.open, b.close) <= defenseLevel;

        if (bodyDefended) {
          z.respectQuality = "A_PRIME_CE_DEFENDED";
          if (z.invertedLife) z.invertedLife.respectQuality = "A_PRIME_CE_DEFENDED";
        } else {
          z.respectQuality = z.dir === 1 ? "B_BOTTOM_DEFENDED" : "B_TOP_DEFENDED";
          if (z.invertedLife) z.invertedLife.respectQuality = z.respectQuality;
        }
      }

      // Respect of inverted zone (expansion away in the inverted direction)
      if (z.testedAfterInversion && (z.dir === 1 ? b.close > z.top : b.close < z.bottom)) {
        z.respectedAfterInversion = true;
        // Non-drifting timestamp: record once on initial confirmation
        if (z.respectedAt == null || z.respectedAt < z.invertedAt) {
          z.respectedAt = j;
          z.respectTime = b.time;
        }
        z.state = "RESPECTED_INVERTED";
        if (z.invertedLife) {
          z.invertedLife.state = "RESPECTED_INVERTED";
          if (z.invertedLife.respectedAt == null) {
            z.invertedLife.respectedAt = j;
            z.invertedLife.respectTime = b.time;
          }
        }
      }
      continue;
    }

    // Branch 2: Natural Zone Lifecycle (FVG, Order Block)
    const bull = z.originalDir === 1;
    const violated = bull ? b.close < z.bottom : b.close > z.top;
    if (violated) {
      if (z.kind === "FVG") {
        z.state = "INVERTED";
        z.dir = -z.originalDir;
        z.invertedAt = j;
        z.inversionTime = b.time;
        // Update type to reflect inverted role
        z.type = z.dir === 1 ? "INVERTED_SUPPORT" : "INVERTED_RESISTANCE";
        z.invertedLife = {
          dir: z.dir,
          type: z.type,
          state: "INVERTED",
          tested: false,
          mitigatedAt: null,
          mitigationTime: null,
          respectedAt: null,
          respectTime: null,
          deepestPenetration: null,
          respectQuality: null,
          touchCount: 0,
        };
        if (z.originalLife) {
          z.originalLife.state = "INVERTED";
          z.originalLife.invertedAt = j;
          z.originalLife.inversionTime = b.time;
        }
      } else {
        z.state = "INVALIDATED";
        z.invalidatedAt = j;
        z.invalidationTime = b.time;
        if (z.originalLife) {
          z.originalLife.state = "INVALIDATED";
          z.originalLife.invalidatedAt = j;
          z.originalLife.invalidationTime = b.time;
        }
        break;
      }
      continue;
    }

    // Retest of natural zone
    if (b.low <= z.top && b.high >= z.bottom) {
      z.tested = true;
      z.touchCount++;
      if (z.mitigatedAt == null) {
        z.mitigatedAt = j;
        z.mitigationTime = b.time;
      }
      const extreme = bull ? b.low : b.high;
      z.deepestPenetration = z.deepestPenetration == null ? extreme : bull
        ? Math.min(z.deepestPenetration, extreme) : Math.max(z.deepestPenetration, extreme);

      const penetration = bull ? (z.top - b.low) : (b.high - z.bottom);
      const fillPct = z.size > 0 ? Math.min(100, Math.max(0, (penetration / z.size) * 100)) : 0;
      z.fillPct = Math.max(z.fillPct, fillPct);

      // Defense level: MT (Mean Threshold) for OBs, CE (Consequent Encroachment) for FVGs
      const defenseLevel = z.kind === "OB" ? (z.mt ?? z.ce) : z.ce;
      const bodyDefended = bull
        ? Math.min(b.open, b.close) >= defenseLevel
        : Math.max(b.open, b.close) <= defenseLevel;

      if (bodyDefended) {
        z.respectQuality = z.kind === "OB" ? "A_PRIME_MT_DEFENDED" : "A_PRIME_CE_DEFENDED";
      } else {
        z.respectQuality = bull ? "B_BOTTOM_DEFENDED" : "B_TOP_DEFENDED";
      }

      if (bull ? b.low <= z.bottom : b.high >= z.top) {
        z.state = "FULLY_MITIGATED";
        if (z.fullyMitigatedAt == null) {
          z.fullyMitigatedAt = j;
          z.fullMitigationTime = b.time;
        }
      } else if (z.state === "VIRGIN") {
        z.state = "PARTIALLY_MITIGATED";
      }

      if (z.originalLife) {
        z.originalLife.tested = true;
        z.originalLife.touchCount++;
        if (z.originalLife.mitigatedAt == null) {
          z.originalLife.mitigatedAt = j;
          z.originalLife.mitigationTime = b.time;
        }
        z.originalLife.deepestPenetration = z.deepestPenetration;
        z.originalLife.respectQuality = z.respectQuality;
        z.originalLife.state = z.state;
      }
    }

    // Respect of natural zone
    if (z.tested && (bull ? b.close > z.top : b.close < z.bottom)) {
      // Non-drifting timestamp: record once on initial confirmation
      if (z.respectedAt == null) {
        z.respectedAt = j;
        z.respectTime = b.time;
      }
      if (z.state !== "INVALIDATED" && z.state !== "FULLY_MITIGATED") {
        z.state = "RESPECTED";
      }
      z.respected = true;
      if (z.originalLife) {
        if (z.originalLife.respectedAt == null) {
          z.originalLife.respectedAt = j;
          z.originalLife.respectTime = b.time;
        }
        if (z.originalLife.state !== "INVALIDATED" && z.originalLife.state !== "FULLY_MITIGATED") {
          z.originalLife.state = "RESPECTED";
        }
      }
    }
  }

  const last = bars[bars.length - 1];
  z.ageBars = bars.length - 1 - z.born;
  const isInside = last.low <= z.top && last.high >= z.bottom && last.close >= z.bottom && last.close <= z.top;
  z.isCurrentlyInside = !["INVALIDATED"].includes(z.state) && isInside;
  return z;
}

export function detectPDArrays(bars = [], options = {}) {
  const tf = typeof options === "string" ? options : options?.tf ?? "H4";
  const lookback = typeof options === "object" ? options?.lookback ?? 250 : 250;
  const customAtr = typeof options === "object" ? (options?.atr ?? options?.avg) : null;
  const minGapSize = typeof options === "object" ? options?.minGapSize : null;
  const maxObSizeAtr = typeof options === "object" ? options?.maxObSizeAtr ?? 2.5 : 2.5;

  const fvgs = [];
  const orderBlocks = [];
  const breakers = [];

  // Pass tf to confirmedFractals so asymmetric HTF acceleration works
  const piv = confirmedFractals(bars, { tf });
  const used = new Set();

  // Compute causal ATR if not supplied
  let atr = customAtr;
  if (!atr || atr <= 0) {
    let trSum = 0;
    const count = Math.min(bars.length - 1, 20);
    for (let k = Math.max(1, bars.length - count); k < bars.length; k++) {
      const p = bars[k - 1].close;
      trSum += Math.max(bars[k].high - bars[k].low, Math.abs(bars[k].high - p), Math.abs(bars[k].low - p));
    }
    atr = count > 0 ? trSum / count : 1.0;
  }
  const effectiveMinGap = minGapSize ?? (atr > 0 ? 0.10 * atr : 0);

  const create = (kind, dir, top, bottom, born, origin, displacement) => ({
    id: `${tf}:${kind}:${dir}:${bars[origin].time}:${bars[born].time}`,
    tf,
    kind,
    type: kind === "FVG" ? (dir === 1 ? "BULLISH_FVG" : "BEARISH_FVG") : "ORDER_BLOCK",
    dir,
    originalDir: dir,
    top,
    bottom,
    ce: (top + bottom) / 2,
    mt: kind === "OB" ? (bars[origin].open + bars[origin].close) / 2 : null,
    size: top - bottom,
    born,
    bornTime: bars[born].time,
    originTime: bars[origin].time,
    confirmedAt: born,
    confirmationTime: bars[born].time,
    knownAt: bars[born].time,
    displacement,
  });

  const startIdx = Math.max(2, bars.length - lookback);

  for (let i = startIdx; i < bars.length; i++) {
    // 1. Fair Value Gaps
    const dir = bars[i].low > bars[i - 2].high ? 1 : bars[i].high < bars[i - 2].low ? -1 : 0;
    if (dir !== 0) {
      const rawGap = dir === 1 ? bars[i].low - bars[i - 2].high : bars[i - 2].low - bars[i].high;
      if (rawGap >= effectiveMinGap) {
        const d = displacementAt(bars, i - 1, dir, { avg: atr });
        if (d.valid) {
          const top = dir === 1 ? bars[i].low : bars[i - 2].low;
          const bottom = dir === 1 ? bars[i - 2].high : bars[i].high;
          fvgs.push(lifecycle(bars, create("FVG", dir, top, bottom, i, i - 1, d)));
        }
      }
    }

    // 2. Order Blocks & Breakers
    for (const direction of [1, -1]) {
      const displacement = displacementAt(bars, i, direction, { avg: atr });
      if (!displacement.valid) continue;
      const ps = direction === 1 ? piv.highs : piv.lows;
      const p = ps.filter((x) => x.confirmedAt < i).at(-1);
      if (!p || !(direction === 1 ? bars[i].close > p.price && bars[i - 1].close <= p.price
        : bars[i].close < p.price && bars[i - 1].close >= p.price)) continue;

      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        if (direction * (bars[j].close - bars[j].open) >= 0) continue;

        // Pre-mitigation check: did any intermediate bar close through the OB candle extreme before the break?
        let preMitigated = false;
        for (let k = j + 1; k < i; k++) {
          if (direction === 1 ? bars[k].close < bars[j].low : bars[k].close > bars[j].high) {
            preMitigated = true;
            break;
          }
        }
        if (preMitigated) continue;

        // Size cap: reject oversized candles (> maxObSizeAtr)
        const obRange = bars[j].high - bars[j].low;
        if (atr > 0 && obRange > maxObSizeAtr * atr) continue;

        const key = `${direction}:${bars[j].time}`;
        if (!used.has(key)) {
          used.add(key);
          const obZone = lifecycle(bars, create("OB", direction, bars[j].high, bars[j].low, i, j, displacement));
          orderBlocks.push(obZone);

          // Breaker Block detection: when OB is invalidated by price closure, it becomes a Breaker Block
          if (obZone.state === "INVALIDATED") {
            breakers.push({
              ...obZone,
              id: `${tf}:BREAKER:${-direction}:${bars[j].time}:${bars[obZone.invalidatedAt]?.time ?? bars[i].time}`,
              kind: "BREAKER",
              type: direction === 1 ? "BEARISH_BREAKER" : "BULLISH_BREAKER",
              dir: -direction,
              originalDir: direction,
              breakerAt: obZone.invalidatedAt,
              breakerTime: obZone.invalidationTime,
              state: "ACTIVE_BREAKER",
            });
          }
        }
        break;
      }
    }
  }

  const ifvgs = fvgs.filter((z) => ["INVERTED", "RESPECTED_INVERTED"].includes(z.state));
  return { fvgs, orderBlocks, ifvgs, breakers };
}

export function detectLiquidityRaids(bars = [], { levels, maxReclaimBars = 2, atr = null, tolerance = null } = {}) {
  if (!levels) {
    const p = confirmedFractals(bars);
    levels = [...p.highs, ...p.lows];
  }
  const out = [];
  const maxBars = Math.max(0, Math.min(6, Math.floor(Number(maxReclaimBars) || 2)));
  const eps = tolerance != null ? Math.max(0, tolerance) : (atr != null && atr > 0 ? 0.05 * atr : 0);

  for (const level of levels) {
    if (!level || !Number.isFinite(level.price) || ![1, -1].includes(level.side)) continue;
    const confirmedAt = level.confirmedAt ?? level.formedAt;
    const confirmationTime = level.confirmationTime ?? (confirmedAt != null && confirmedAt >= 0 && confirmedAt < bars.length ? bars[confirmedAt]?.time : null);
    if (confirmationTime == null) continue;
    const start = bars.findIndex((b) => b.time > confirmationTime);
    if (start < 0) continue;

    for (let i = start; i < bars.length; i++) {
      const side = level.side;
      // High swept: must pierce level.price + eps
      // Low swept: must pierce level.price - eps
      const pierced = side === 1 ? bars[i].high > level.price + eps : bars[i].low < level.price - eps;
      if (!pierced) continue;

      let extreme = side === 1 ? bars[i].high : bars[i].low;
      for (let j = i; j <= Math.min(i + maxBars, bars.length - 1); j++) {
        // Runaway breakout guard: price must not close > 1.5x ATR beyond the raid level
        if (atr != null && atr > 0) {
          const penetration = side === 1 ? bars[j].close - level.price : level.price - bars[j].close;
          if (penetration > 1.5 * atr) break;
        }
        extreme = side === 1 ? Math.max(extreme, bars[j].high) : Math.min(extreme, bars[j].low);
        if (side === 1 ? bars[j].close < level.price : bars[j].close > level.price) {
          out.push({
            dir: -side,
            i: j,
            raidIndex: i,
            reclaimIndex: j,
            levelPrice: level.price,
            extreme,
            time: bars[j].time,
            raidTime: bars[i].time,
            levelId: level.id ?? `L:${side}:${confirmationTime}`,
            confirmationTime,
            knownAt: bars[j].time,
            side,
            age: bars.length - 1 - j,
            sweepDepthAtr: atr > 0 ? Math.abs(extreme - level.price) / atr : null,
          });
          break;
        }
      }
      break; // A pool is consumed by its first raid; a late reclaim is not a new sweep.
    }
  }
  return out.sort((a, b) => b.i - a.i || a.levelId.localeCompare(b.levelId));
}
