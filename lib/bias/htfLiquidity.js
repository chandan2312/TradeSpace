import { findPivots, avgRange } from "../patterns/core.js";

// HTF Liquidity Intelligence Engine (4H & D1 Only)
// Focuses strictly on macro liquidity to eliminate lower-timeframe noise:
//   1. External Range Liquidity (ERL) vs Internal Range Liquidity (IRL)
//   2. Active Delivery Cycle: IRL → ERL vs ERL → IRL
//   3. HTF Liquidity Sweeps (PDH, PDL, PWH, PWL, 4H EQH, 4H EQL, 4H Swings)
//   4. Macro Equal Highs / Lows (4H EQH / EQL magnets)
//   5. Definitive Institutional Draw on Liquidity (DOL)

const DAY = 86400;

/**
 * Analyzes HTF liquidity exclusively from 4H and D1 candlestick data.
 * @param {Object} frames - { H4, D1 }
 */
export function analyzeHTFLiquidity(frames) {
  const h4 = frames.H4;
  const d1 = frames.D1;

  if (!h4 || h4.length < 3) {
    return {
      activeCycle: "UNKNOWN",
      drawOnLiquidity: null,
      sweeps: [],
      pools: { bsl: [], ssl: [] },
      eqh: [],
      eql: [],
      keyLevels: {},
    };
  }

  const n = h4.length;
  const avgH4 = avgRange(h4);
  const currentPrice = h4[n - 1].close;

  // 1. Calculate PDH / PDL and PWH / PWL from Daily bars (D1)
  let pdh = null;
  let pdl = null;
  let pwh = null;
  let pwl = null;
  const keyLevels = {};

  if (d1 && d1.length >= 2) {
    const lastD1 = d1[d1.length - 1];
    const prevD1 = d1[d1.length - 2];
    pdh = prevD1.high;
    pdl = prevD1.low;
    keyLevels.PDH = { price: pdh, name: "PDH", side: 1, type: "ERL" };
    keyLevels.PDL = { price: pdl, name: "PDL", side: -1, type: "ERL" };

    // ISO Week Calculation for PWH / PWL
    const week = (t) => Math.floor((Math.floor(t / 86400) + 3) / 7);
    const curW = week(lastD1.time);
    const prevWeekBars = d1.filter((b) => week(b.time) === curW - 1);
    if (prevWeekBars.length > 0) {
      pwh = Math.max(...prevWeekBars.map((b) => b.high));
      pwl = Math.min(...prevWeekBars.map((b) => b.low));
      keyLevels.PWH = { price: pwh, name: "PWH", side: 1, type: "ERL" };
      keyLevels.PWL = { price: pwl, name: "PWL", side: -1, type: "ERL" };
    }
  }

  // 2. Find 4H Swings & Equal Highs/Lows (4H EQH / EQL)
  const { highs, lows } = findPivots(h4, 3, 3);
  const tol = 0.25 * avgH4;

  const eqh = [];
  const eql = [];

  // Cluster 4H Highs for EQH
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i].price - highs[j].price) <= tol && highs[j].i - highs[i].i >= 4) {
        const poolPx = Math.max(highs[i].price, highs[j].price);
        eqh.push({
          name: "4H EQH",
          price: poolPx,
          side: 1,
          i1: highs[i].i,
          i2: highs[j].i,
          age: n - 1 - highs[j].i,
        });
      }
    }
  }

  // Cluster 4H Lows for EQL
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) <= tol && lows[j].i - lows[i].i >= 4) {
        const poolPx = Math.min(lows[i].price, lows[j].price);
        eql.push({
          name: "4H EQL",
          price: poolPx,
          side: -1,
          i1: lows[i].i,
          i2: lows[j].i,
          age: n - 1 - lows[j].i,
        });
      }
    }
  }

  // 3. Detect HTF Sweeps (Raids / Turtle Soups on 4H candles)
  const sweeps = [];
  const sweepCandidates = [
    ...(pdh ? [{ name: "PDH", price: pdh, side: 1 }] : []),
    ...(pdl ? [{ name: "PDL", price: pdl, side: -1 }] : []),
    ...(pwh ? [{ name: "PWH", price: pwh, side: 1 }] : []),
    ...(pwl ? [{ name: "PWL", price: pwl, side: -1 }] : []),
    ...eqh.slice(-3).map((e) => ({ name: "4H EQH", price: e.price, side: 1 })),
    ...eql.slice(-3).map((e) => ({ name: "4H EQL", price: e.price, side: -1 })),
  ];

  // Also include the last 2 prominent 4H swing highs/lows
  if (highs.length >= 2) {
    const sh = highs[highs.length - 2];
    sweepCandidates.push({ name: "4H Swing High", price: sh.price, side: 1 });
  }
  if (lows.length >= 2) {
    const sl = lows[lows.length - 2];
    sweepCandidates.push({ name: "4H Swing Low", price: sl.price, side: -1 });
  }

  const lookbackBars = Math.min(n, 24); // Last 24 4H bars (~4 days)
  for (const cand of sweepCandidates) {
    for (let i = n - lookbackBars; i < n; i++) {
      const b = h4[i];
      if (cand.side === 1) {
        // High wicked above level, but candle closed below level!
        if (b.high > cand.price && b.close < cand.price) {
          sweeps.push({
            name: cand.name,
            levelPrice: cand.price,
            sweptPrice: b.high,
            side: 1, // Swept BSL -> Reversal fuel is BEARISH (-1)
            age: n - 1 - i,
            time: b.time,
            reversalDir: -1,
          });
        }
      } else {
        // Low wicked below level, but candle closed above level!
        if (b.low < cand.price && b.close > cand.price) {
          sweeps.push({
            name: cand.name,
            levelPrice: cand.price,
            sweptPrice: b.low,
            side: -1, // Swept SSL -> Reversal fuel is BULLISH (+1)
            age: n - 1 - i,
            time: b.time,
            reversalDir: 1,
          });
        }
      }
    }
  }

  // De-duplicate sweeps by name and freshness
  const uniqueSweeps = [];
  const seenSweep = new Set();
  sweeps.sort((a, b) => a.age - b.age);
  for (const s of sweeps) {
    if (!seenSweep.has(s.name)) {
      seenSweep.add(s.name);
      uniqueSweeps.push(s);
    }
  }

  // 4. Untapped HTF Liquidity Pools (BSL above price vs SSL below price)
  const bsl = [];
  const ssl = [];

  const addPool = (name, price, side, type) => {
    if (side === 1 && price > currentPrice) {
      bsl.push({ name, price, distance: price - currentPrice, type });
    } else if (side === -1 && price < currentPrice) {
      ssl.push({ name, price, distance: currentPrice - price, type });
    }
  };

  if (pdh) addPool("PDH", pdh, 1, "ERL");
  if (pdl) addPool("PDL", pdl, -1, "ERL");
  if (pwh) addPool("PWH", pwh, 1, "ERL");
  if (pwl) addPool("PWL", pwl, -1, "ERL");

  for (const e of eqh) addPool("4H EQH", e.price, 1, "MAGNET_BSL");
  for (const e of eql) addPool("4H EQL", e.price, -1, "MAGNET_SSL");

  for (const h of highs.slice(-4)) {
    if (h.price > currentPrice && !bsl.some((p) => Math.abs(p.price - h.price) < tol)) {
      addPool("4H Swing High", h.price, 1, "ERL");
    }
  }
  for (const l of lows.slice(-4)) {
    if (l.price < currentPrice && !ssl.some((p) => Math.abs(p.price - l.price) < tol)) {
      addPool("4H Swing Low", l.price, -1, "ERL");
    }
  }

  bsl.sort((a, b) => a.distance - b.distance);
  ssl.sort((a, b) => a.distance - b.distance);

  // 5. Active Delivery Cycle: ERL → IRL vs IRL → ERL
  // If price freshly swept ERL (within last 6 4H bars = 24 hours), market is in ERL → IRL retracement
  // If price did NOT sweep ERL recently and is moving towards external pools, market is in IRL → ERL expansion
  const freshSweep = uniqueSweeps.find((s) => s.age <= 6);
  let activeCycle = "IRL_TO_ERL"; // Default institutional expansion state
  let cycleNote = "Expanding towards External Range Liquidity targets";

  if (freshSweep) {
    activeCycle = "ERL_TO_IRL";
    cycleNote = `Fresh ${freshSweep.name} sweep ${freshSweep.age * 4}h ago; rotating into internal liquidity`;
  }

  // 6. Draw on Liquidity (DOL): Primary Target
  let drawOnLiquidity = null;
  if (activeCycle === "ERL_TO_IRL") {
    // If ERL was swept, target rotates towards opposite internal/external side
    if (freshSweep.side === 1 && ssl[0]) {
      drawOnLiquidity = { ...ssl[0], targetSide: "SSL", catalyst: `Rotation following ${freshSweep.name} sweep` };
    } else if (freshSweep.side === -1 && bsl[0]) {
      drawOnLiquidity = { ...bsl[0], targetSide: "BSL", catalyst: `Rotation following ${freshSweep.name} sweep` };
    }
  } else {
    // In IRL to ERL expansion, the nearest clean untapped pool is the magnet
    if (bsl[0] && (!ssl[0] || bsl[0].distance < ssl[0].distance)) {
      drawOnLiquidity = { ...bsl[0], targetSide: "BSL", catalyst: "Clean Buy-Side Liquidity draw above" };
    } else if (ssl[0]) {
      drawOnLiquidity = { ...ssl[0], targetSide: "SSL", catalyst: "Clean Sell-Side Liquidity draw below" };
    }
  }

  return {
    activeCycle,
    cycleNote,
    drawOnLiquidity,
    sweeps: uniqueSweeps,
    pools: { bsl, ssl },
    eqh,
    eql,
    keyLevels,
    currentPrice,
  };
}
