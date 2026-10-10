// Closed-bar institutional evidence. Indices are local; identities use bar time.
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

      // Check left historical context (must be strict peak relative to preceding bars)
      let leftValid = true;
      for (let j = i - left; j < i; j++) {
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
          isAsymmetric: requiredRight < right,
        });
      }
    }
  }
  return out;
}

const volumeOf = (b) => Number(b?.v ?? b?.tick_volume ?? b?.tickVolume ?? b?.volume ?? 0);

export function displacementAt(bars, i, dir, options = {}) {
  const empty = { valid: false, bodyRatio: 0, atrRatio: 0, volumeRatio: null,
    atr10: null, volumeConfirmed: false, volumeEvidence: "UNAVAILABLE" };
  if (!bars || i < 1 || i >= bars.length || ![1, -1].includes(dir)) return empty;

  const customAvg = typeof options === "number" ? options : options?.avg;
  const minBodyRatio = typeof options === "object" && options?.minBodyRatio != null ? options.minBodyRatio : 0.50;
  const minAtrRatio = typeof options === "object" && options?.minAtrRatio != null ? options.minAtrRatio : 1.0;

  const b = bars[i];
  let tr = 0;
  let volume = 0;
  let volumes = 0;
  const lookback = Math.min(i, 10);
  for (let j = i - lookback; j < i; j++) {
    const p = bars[j - 1]?.close ?? bars[j].open;
    tr += Math.max(bars[j].high - bars[j].low, Math.abs(bars[j].high - p), Math.abs(bars[j].low - p));
    const v = volumeOf(bars[j]);
    if (v > 0) { volume += v; volumes++; }
  }
  const atr10 = lookback > 0 ? tr / lookback : 0;
  const effectiveAtr = (customAvg && customAvg > 0) ? customAvg : atr10;

  const range = b.high - b.low;
  const body = dir * (b.close - b.open);
  const bodyRatio = range > 0 ? body / range : 0;
  const atrRatio = effectiveAtr > 0 ? range / effectiveAtr : 0;
  const v = volumeOf(b);
  const volumeRatio = volumes > 0 && v > 0 ? v / (volume / volumes) : null;

  const valid = body > 0 && bodyRatio >= minBodyRatio && atrRatio >= minAtrRatio;

  return {
    valid,
    bodyRatio,
    atrRatio,
    volumeRatio,
    atr10: effectiveAtr,
    volumeConfirmed: volumeRatio != null && volumeRatio >= 1,
    volumeEvidence: volumeRatio == null ? "UNAVAILABLE" : volumeRatio >= 1.5 ? "STRONG" : volumeRatio >= 1 ? "CONFIRMED" : "THIN"
  };
}

function lifecycle(bars, zone) {
  const z = { ...zone, state: "VIRGIN", mitigatedAt: null, mitigationTime: null,
    fullyMitigatedAt: null, fullMitigationTime: null, invertedAt: null, inversionTime: null,
    invalidatedAt: null, invalidationTime: null, respectedAt: null, respectTime: null,
    tested: false, deepestPenetration: null, respectQuality: "A_PRIME_CE_DEFENDED" };
  for (let j = z.born + 1; j < bars.length; j++) {
    const b = bars[j];
    if (z.state === "INVERTED") {
      if (z.dir === 1 ? b.close < z.bottom : b.close > z.top) {
        z.state = "INVALIDATED"; z.invalidatedAt = j; z.invalidationTime = b.time;
        break;
      }
      continue;
    }
    const bull = z.originalDir === 1;
    if (bull ? b.close < z.bottom : b.close > z.top) {
      if (z.kind === "FVG") {
        z.state = "INVERTED"; z.dir = -z.originalDir; z.invertedAt = j; z.inversionTime = b.time;
      } else {
        z.state = "INVALIDATED"; z.invalidatedAt = j; z.invalidationTime = b.time;
        break;
      }
      continue;
    }
    if (b.low <= z.top && b.high >= z.bottom) {
      z.tested = true;
      if (z.mitigatedAt == null) { z.mitigatedAt = j; z.mitigationTime = b.time; }
      const extreme = bull ? b.low : b.high;
      z.deepestPenetration = z.deepestPenetration == null ? extreme : bull
        ? Math.min(z.deepestPenetration, extreme) : Math.max(z.deepestPenetration, extreme);
      if (bull ? Math.min(b.open, b.close) < z.ce : Math.max(b.open, b.close) > z.ce)
        z.respectQuality = bull ? "B_BOTTOM_DEFENDED" : "B_TOP_DEFENDED";
      if (bull ? b.low <= z.bottom : b.high >= z.top) {
        z.state = "FULLY_MITIGATED";
        if (z.fullyMitigatedAt == null) { z.fullyMitigatedAt = j; z.fullMitigationTime = b.time; }
      } else if (z.state === "VIRGIN") z.state = "PARTIALLY_MITIGATED";
    }
    if (z.tested && (bull ? b.close > z.top : b.close < z.bottom)) {
      z.respectedAt = j; z.respectTime = b.time;
    }
  }
  const last = bars[bars.length - 1];
  z.ageBars = bars.length - 1 - z.born;
  z.isCurrentlyInside = !["INVERTED", "INVALIDATED"].includes(z.state)
    && last.low <= z.top && last.high >= z.bottom && last.close >= z.bottom && last.close <= z.top;
  return z;
}

export function detectPDArrays(bars = [], { tf = "H4" } = {}) {
  const fvgs = [];
  const orderBlocks = [];
  const piv = confirmedFractals(bars);
  const used = new Set();
  const create = (kind, dir, top, bottom, born, origin, displacement) => ({
    id: `${tf}:${kind}:${dir}:${bars[origin].time}:${bars[born].time}`, tf, kind,
    type: kind === "FVG" ? dir === 1 ? "BULLISH_FVG" : "BEARISH_FVG" : "ORDER_BLOCK",
    dir, originalDir: dir, top, bottom, ce: (top + bottom) / 2,
    mt: kind === "OB" ? (bars[origin].open + bars[origin].close) / 2 : null,
    size: top - bottom, born, bornTime: bars[born].time, originTime: bars[origin].time,
    confirmedAt: born, confirmationTime: bars[born].time, displacement,
  });
  for (let i = 2; i < bars.length; i++) {
    const dir = bars[i].low > bars[i - 2].high ? 1 : bars[i].high < bars[i - 2].low ? -1 : 0;
    const d = displacementAt(bars, i - 1, dir);
    if (dir && d.valid) {
      const top = dir === 1 ? bars[i].low : bars[i - 2].low;
      const bottom = dir === 1 ? bars[i - 2].high : bars[i].high;
      fvgs.push(lifecycle(bars, create("FVG", dir, top, bottom, i, i - 1, d)));
    }
    for (const direction of [1, -1]) {
      const displacement = displacementAt(bars, i, direction);
      if (!displacement.valid) continue;
      const ps = direction === 1 ? piv.highs : piv.lows;
      const p = ps.filter((x) => x.confirmedAt < i).at(-1);
      if (!p || !(direction === 1 ? bars[i].close > p.price && bars[i - 1].close <= p.price
        : bars[i].close < p.price && bars[i - 1].close >= p.price)) continue;
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        if (direction * (bars[j].close - bars[j].open) >= 0) continue;
        const key = `${direction}:${bars[j].time}`;
        if (!used.has(key)) {
          used.add(key);
          orderBlocks.push(lifecycle(bars, create("OB", direction, bars[j].high, bars[j].low, i, j, displacement)));
        }
        break;
      }
    }
  }
  return { fvgs, orderBlocks };
}

export function detectLiquidityRaids(bars = [], { levels, maxReclaimBars = 2, atr = null } = {}) {
  if (!levels) {
    const p = confirmedFractals(bars);
    levels = [...p.highs, ...p.lows];
  }
  const out = [];
  const maxBars = Math.max(0, Math.min(6, Math.floor(maxReclaimBars)));
  for (const level of levels) {
    const confirmedAt = level.confirmedAt ?? level.formedAt;
    const confirmationTime = level.confirmationTime ?? bars[confirmedAt]?.time;
    if (confirmationTime == null || ![1, -1].includes(level.side)) continue;
    const start = bars.findIndex((b) => b.time > confirmationTime);
    if (start < 0) continue;
    for (let i = start; i < bars.length; i++) {
      const side = level.side;
      if (!(side === 1 ? bars[i].high > level.price : bars[i].low < level.price)) continue;
      let extreme = side === 1 ? bars[i].high : bars[i].low;
      for (let j = i; j <= Math.min(i + maxBars, bars.length - 1); j++) {
        // In real institutional sweeps, price must not close > 1.5x ATR beyond the raid level (which signifies a breakout)
        if (atr != null && atr > 0) {
          const penetration = side === 1 ? bars[j].close - level.price : level.price - bars[j].close;
          if (penetration > 1.5 * atr) break;
        }
        extreme = side === 1 ? Math.max(extreme, bars[j].high) : Math.min(extreme, bars[j].low);
        if (side === 1 ? bars[j].close < level.price : bars[j].close > level.price) {
          out.push({ dir: -side, i: j, raidIndex: i, reclaimIndex: j, levelPrice: level.price, extreme,
            time: bars[j].time, raidTime: bars[i].time, levelId: level.id ?? `L:${side}:${confirmationTime}`,
            confirmationTime, side, age: bars.length - 1 - j });
          break;
        }
      }
      break; // A pool is consumed by its first raid; a late reclaim is not a new sweep.
    }
  }
  return out.sort((a, b) => b.i - a.i || a.levelId.localeCompare(b.levelId));
}
