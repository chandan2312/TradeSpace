import { findPivots, avgRange } from "../patterns/core.js";

// HTF Liquidity Intelligence Engine (4H & D1 Only)
// Focuses strictly on macro liquidity to eliminate lower-timeframe noise:
//   1. External Range Liquidity (ERL) vs Internal Range Liquidity (IRL)
//   2. Active Delivery Cycle: IRL → ERL vs ERL → IRL
//   3. HTF Liquidity Sweeps (PDH, PDL, PWH, PWL, 4H EQH, 4H EQL, 4H Swings)
//   4. Macro Equal Highs / Lows (4H EQH / EQL magnets)
//   5. Definitive Institutional Draw on Liquidity (DOL) governed by macro trend, never nearest pips

const DAY = 86400;

export function analyzeHTFLiquidity(frames, options = {}) {
  const h4 = frames?.H4;
  const d1 = frames?.D1;

  if (!h4 || h4.length < 3) {
    return {
      activeCycle: "UNKNOWN",
      drawOnLiquidity: null,
      sweeps: [],
      pools: { bsl: [], ssl: [] },
      eqh: [],
      eql: [],
      keyLevels: {},
      macroDir: 0,
      macroBias: "NEUTRAL",
    };
  }

  const n = h4.length;
  const avgH4 = avgRange(h4);
  const currentPrice = h4[n - 1].close;
  const structures = options.structures || {};

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
    const pdConfirmation = prevD1.time + DAY;
    keyLevels.PDH = { price: pdh, name: "PDH", side: 1, type: "ERL", causal: true, confirmationTime: pdConfirmation, id: `D1:PDH:${prevD1.time}` };
    keyLevels.PDL = { price: pdl, name: "PDL", side: -1, type: "ERL", causal: true, confirmationTime: pdConfirmation, id: `D1:PDL:${prevD1.time}` };

    // ISO Week Calculation for PWH / PWL
    const week = (t) => Math.floor((Math.floor(t / 86400) + 3) / 7);
    const curW = week(lastD1.time);
    const prevWeekBars = d1.filter((b) => week(b.time) === curW - 1);
    if (prevWeekBars.length > 0) {
      pwh = Math.max(...prevWeekBars.map((b) => b.high));
      pwl = Math.min(...prevWeekBars.map((b) => b.low));
      const pwConfirmation = (curW * 7 - 3) * DAY;
      keyLevels.PWH = { price: pwh, name: "PWH", side: 1, type: "ERL", causal: true, confirmationTime: pwConfirmation, id: `D1:PWH:${curW - 1}` };
      keyLevels.PWL = { price: pwl, name: "PWL", side: -1, type: "ERL", causal: true, confirmationTime: pwConfirmation, id: `D1:PWL:${curW - 1}` };
    }
  }

  // 2. Detect 4H Equal Highs (EQH) and Equal Lows (EQL)
  const lookbackH4 = Math.min(n, 80);
  const winH4 = h4.slice(n - lookbackH4);
  const { highs, lows } = findPivots(winH4, 3, 3);

  const eqh = [];
  const eql = [];
  const tol = 0.20 * avgH4;

  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i].price - highs[j].price) <= tol && highs[j].i - highs[i].i >= 3) {
        const eqPrice = Math.max(highs[i].price, highs[j].price);
        if (!h4.slice(highs[j].i).some((b) => b.high > eqPrice + tol)) {
          eqh.push({ name: "4H EQH", price: eqPrice, side: 1, type: "MAGNET_BSL", time: highs[j].time, causal: true, confirmationTime: highs[j].time, id: `H4:EQH:${highs[i].time}:${highs[j].time}` });
        }
      }
    }
  }

  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) <= tol && lows[j].i - lows[i].i >= 3) {
        const eqPrice = Math.min(lows[i].price, lows[j].price);
        if (!h4.slice(lows[j].i).some((b) => b.low < eqPrice - tol)) {
          eql.push({ name: "4H EQL", price: eqPrice, side: -1, type: "MAGNET_SSL", time: lows[j].time, causal: true, confirmationTime: lows[j].time, id: `H4:EQL:${lows[i].time}:${lows[j].time}` });
        }
      }
    }
  }

  // 3. Detect HTF Liquidity Sweeps
  const sweeps = [];
  const trackedLevels = [
    ...(pdh ? [{ name: "PDH", price: pdh, side: 1 }] : []),
    ...(pdl ? [{ name: "PDL", price: pdl, side: -1 }] : []),
    ...(pwh ? [{ name: "PWH", price: pwh, side: 1 }] : []),
    ...(pwl ? [{ name: "PWL", price: pwl, side: -1 }] : []),
    ...eqh.map((e) => ({ name: "4H EQH", price: e.price, side: 1 })),
    ...eql.map((e) => ({ name: "4H EQL", price: e.price, side: -1 })),
  ];

  for (const lv of trackedLevels) {
    for (let i = Math.max(0, n - 24); i < n; i++) {
      const b = h4[i];
      if (lv.side === 1) {
        if (b.high > lv.price && b.close < lv.price) {
          sweeps.push({
            name: lv.name,
            levelPrice: lv.price,
            sweptPrice: b.high,
            side: 1,
            age: n - 1 - i,
            time: b.time,
            reversalDir: -1,
            causal: true,
          });
        }
      } else {
        if (b.low < lv.price && b.close > lv.price) {
          sweeps.push({
            name: lv.name,
            levelPrice: lv.price,
            sweptPrice: b.low,
            side: -1,
            age: n - 1 - i,
            time: b.time,
            reversalDir: 1,
            causal: true,
          });
        }
      }
    }
  }

  const uniqueSweeps = [];
  const seenSweep = new Set();
  sweeps.sort((a, b) => a.age - b.age);
  for (const s of sweeps) {
    if (!seenSweep.has(s.name)) {
      seenSweep.add(s.name);
      uniqueSweeps.push(s);
    }
  }

  // 4. Untapped HTF Liquidity Pools
  const bsl = [];
  const ssl = [];

  const addPool = (name, price, side, type, id = null, time = null) => {
    if (side === 1 && price > currentPrice) {
      bsl.push({ id: id || `BSL:${name}:${price}`, name, price, side: 1, targetSide: "BSL", distance: price - currentPrice, type, causal: true, state: "UNCONSUMED", time });
    } else if (side === -1 && price < currentPrice) {
      ssl.push({ id: id || `SSL:${name}:${price}`, name, price, side: -1, targetSide: "SSL", distance: currentPrice - price, type, causal: true, state: "UNCONSUMED", time });
    }
  };

  if (pdh) addPool("PDH", pdh, 1, "ERL", `D1:PDH:${pdh}`);
  if (pdl) addPool("PDL", pdl, -1, "ERL", `D1:PDL:${pdl}`);
  if (pwh) addPool("PWH", pwh, 1, "ERL", `D1:PWH:${pwh}`);
  if (pwl) addPool("PWL", pwl, -1, "ERL", `D1:PWL:${pwl}`);

  for (const e of eqh) addPool("4H EQH", e.price, 1, "MAGNET_BSL", e.id, e.time);
  for (const e of eql) addPool("4H EQL", e.price, -1, "MAGNET_SSL", e.id, e.time);

  for (const h of highs.slice(-4)) {
    if (h.price > currentPrice && !bsl.some((p) => Math.abs(p.price - h.price) < tol)) {
      addPool("4H Swing High", h.price, 1, "ERL", `H4:SWING:H:${h.time}`, h.time);
    }
  }
  for (const l of lows.slice(-4)) {
    if (l.price < currentPrice && !ssl.some((p) => Math.abs(p.price - l.price) < tol)) {
      addPool("4H Swing Low", l.price, -1, "ERL", `H4:SWING:L:${l.time}`, l.time);
    }
  }

  bsl.sort((a, b) => a.distance - b.distance);
  ssl.sort((a, b) => a.distance - b.distance);

  // 5. Active Delivery Cycle
  const freshSweep = uniqueSweeps.find((s) => s.age <= 6);
  let activeCycle = "IRL_TO_ERL";
  let cycleNote = "Expanding towards External Range Liquidity targets";

  if (freshSweep) {
    activeCycle = "ERL_TO_IRL";
    cycleNote = `Fresh ${freshSweep.name} sweep ${freshSweep.age * 4}h ago; rotating into internal liquidity`;
  }

  // 6. Draw on Liquidity (DOL): Governed by macro trend, never closest pips!
  let drawOnLiquidity = null;
  let inferredDir = 0;
  if (highs.length >= 2 && lows.length >= 2) {
    if (highs[highs.length - 1].price > highs[highs.length - 2].price && lows[lows.length - 1].price > lows[lows.length - 2].price) inferredDir = 1;
    else if (highs[highs.length - 1].price < highs[highs.length - 2].price && lows[lows.length - 1].price < lows[lows.length - 2].price) inferredDir = -1;
  }
  const macroDir = structures.D1?.dir || structures.H4?.dir || (freshSweep ? freshSweep.reversalDir : inferredDir);
  const macroBias = macroDir > 0 ? "BULLISH" : macroDir < 0 ? "BEARISH" : "NEUTRAL";

  if (activeCycle === "ERL_TO_IRL" && freshSweep) {
    if (freshSweep.side === 1 && ssl[0]) {
      drawOnLiquidity = { ...ssl[0], targetSide: "SSL", direction: -1, causal: true, confirmationTime: freshSweep.time, catalyst: `Rotation following ${freshSweep.name} sweep` };
    } else if (freshSweep.side === -1 && bsl[0]) {
      drawOnLiquidity = { ...bsl[0], targetSide: "BSL", direction: 1, causal: true, confirmationTime: freshSweep.time, catalyst: `Rotation following ${freshSweep.name} sweep` };
    }
  } else {
    // In IRL to ERL expansion: follow the macro structural trend ahead of price!
    if (macroDir === 1 && bsl.length) {
      drawOnLiquidity = { ...bsl[0], targetSide: "BSL", direction: 1, causal: true, confirmationTime: bsl[0].time || h4.at(-1).time, catalyst: "Macro Bullish Expansion toward BSL" };
    } else if (macroDir === -1 && ssl.length) {
      drawOnLiquidity = { ...ssl[0], targetSide: "SSL", direction: -1, causal: true, confirmationTime: ssl[0].time || h4.at(-1).time, catalyst: "Macro Bearish Expansion toward SSL" };
    } else if (bsl[0] && (!ssl[0] || bsl[0].distance < ssl[0].distance)) {
      drawOnLiquidity = { ...bsl[0], targetSide: "BSL", direction: 1, causal: true, confirmationTime: bsl[0].time || h4.at(-1).time, catalyst: "Clean Buy-Side Liquidity draw above" };
    } else if (ssl[0]) {
      drawOnLiquidity = { ...ssl[0], targetSide: "SSL", direction: -1, causal: true, confirmationTime: ssl[0].time || h4.at(-1).time, catalyst: "Clean Sell-Side Liquidity draw below" };
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
    macroDir,
    macroBias,
  };
}
