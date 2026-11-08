import { findPivots, avgRange } from "../patterns/core.js";
import { getTradingDayKey, DAY_SEC } from "../time.js";

// HTF Liquidity Intelligence Engine (4H & D1)
// Focuses strictly on macro institutional liquidity:
//   1. External Range Liquidity (ERL) vs Internal Range Liquidity (IRL)
//   2. Active Delivery Cycle: IRL -> ERL vs ERL -> IRL with rejection validation
//   3. HTF Liquidity Sweeps (PDH, PDL, PWH, PWL, 4H EQH, 4H EQL, 4H Swings)
//   4. Macro Equal Highs / Lows (Clustered EQH / EQL with touch counts and intermediate validation)
//   5. Definitive Institutional Draw on Liquidity (DOL) governed by macro trend, level tier, and unconsumed state

export function analyzeHTFLiquidity(frames, options = {}) {
  const h4 = frames?.H4;
  const d1 = frames?.D1;

  if (!h4 || h4.length < 3) {
    return {
      activeCycle: "UNKNOWN",
      cycleNote: "Insufficient 4H candle history",
      drawOnLiquidity: null,
      sweeps: [],
      pools: { bsl: [], ssl: [], consumed: [] },
      eqh: [],
      eql: [],
      keyLevels: {},
      macroDir: 0,
      macroBias: "NEUTRAL",
      currentPrice: h4 && h4.length ? h4[h4.length - 1].close : null,
    };
  }

  const n = h4.length;
  const avgH4 = avgRange(h4);
  const currentPrice = h4[n - 1].close;
  const structures = options.structures || {};
  const ranges = options.ranges || {};

  // ---------------------------------------------------------------------------
  // 1. Calculate PDH / PDL and PWH / PWL from Daily bars (D1)
  // ---------------------------------------------------------------------------
  let pdh = null;
  let pdl = null;
  let pwh = null;
  let pwl = null;
  let prevD1 = null;
  let prevWeekLastBar = null;
  const keyLevels = {};

  if (d1 && d1.length >= 2) {
    const lastD1 = d1[d1.length - 1];
    prevD1 = d1[d1.length - 2];
    pdh = prevD1.high;
    pdl = prevD1.low;
    const pdConfirmation = prevD1.closeTime ?? (prevD1.time + DAY_SEC);
    keyLevels.PDH = { price: pdh, name: "PDH", side: 1, type: "ERL", causal: true, confirmationTime: pdConfirmation, id: `D1:PDH:${prevD1.time}` };
    keyLevels.PDL = { price: pdl, name: "PDL", side: -1, type: "ERL", causal: true, confirmationTime: pdConfirmation, id: `D1:PDL:${prevD1.time}` };

    // Institutional Trading Week Calculation for PWH / PWL (Aligned with Europe/Athens market open)
    const week = (t) => Math.floor((getTradingDayKey(t) + 3) / 7);
    const curW = week(lastD1.time);
    const prevWeekBars = d1.filter((b) => week(b.time) === curW - 1);
    if (prevWeekBars.length > 0) {
      prevWeekLastBar = prevWeekBars[prevWeekBars.length - 1];
      pwh = Math.max(...prevWeekBars.map((b) => b.high));
      pwl = Math.min(...prevWeekBars.map((b) => b.low));
      const pwConfirmation = prevWeekLastBar.closeTime ?? ((curW * 7 - 3) * DAY_SEC);
      keyLevels.PWH = { price: pwh, name: "PWH", side: 1, type: "ERL", causal: true, confirmationTime: pwConfirmation, id: `D1:PWH:${curW - 1}` };
      keyLevels.PWL = { price: pwl, name: "PWL", side: -1, type: "ERL", causal: true, confirmationTime: pwConfirmation, id: `D1:PWL:${curW - 1}` };
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Detect 4H Swing Pivots with Absolute Index & Real Time
  // ---------------------------------------------------------------------------
  const lookbackH4 = Math.min(n, 80);
  const startH4 = n - lookbackH4;
  const winH4 = h4.slice(startH4);
  const { highs, lows } = findPivots(winH4, 3, 3);
  const tol = Math.max(0.20 * (Number.isFinite(avgH4) && avgH4 > 0 ? avgH4 : 1), 0.0001);

  // Map pivots to absolute indices in h4 and attach real timestamps & confirmation times
  const enrichedHighs = highs.map((p) => {
    const absIdx = startH4 + p.i;
    const bar = h4[absIdx];
    const confirmIdx = Math.min(n - 1, absIdx + 3);
    const confirmBar = h4[confirmIdx];
    return {
      relIdx: p.i,
      absIdx,
      price: p.price,
      time: bar?.time,
      confirmationTime: confirmBar?.closeTime ?? (confirmBar?.time ? confirmBar.time + 14400 : bar?.time),
    };
  });

  const enrichedLows = lows.map((p) => {
    const absIdx = startH4 + p.i;
    const bar = h4[absIdx];
    const confirmIdx = Math.min(n - 1, absIdx + 3);
    const confirmBar = h4[confirmIdx];
    return {
      relIdx: p.i,
      absIdx,
      price: p.price,
      time: bar?.time,
      confirmationTime: confirmBar?.closeTime ?? (confirmBar?.time ? confirmBar.time + 14400 : bar?.time),
    };
  });

  // ---------------------------------------------------------------------------
  // 3. Detect 4H Equal Highs (EQH) & Equal Lows (EQL) with Clustering & Intermediate Validation
  // ---------------------------------------------------------------------------
  const rawEqhClusters = [];
  const usedHighIdxs = new Set();

  for (let i = 0; i < enrichedHighs.length; i++) {
    if (usedHighIdxs.has(i)) continue;
    const cluster = [enrichedHighs[i]];

    for (let j = i + 1; j < enrichedHighs.length; j++) {
      if (usedHighIdxs.has(j)) continue;
      // Highs must be separated by at least 3 bars and within tol
      if (enrichedHighs[j].absIdx - cluster[cluster.length - 1].absIdx >= 3 &&
          Math.abs(enrichedHighs[i].price - enrichedHighs[j].price) <= tol) {
        
        // Intermediate check: price between pivots must NOT have spiked significantly above the equal level
        const prevIdx = cluster[cluster.length - 1].absIdx;
        const curIdx = enrichedHighs[j].absIdx;
        const maxLevel = Math.max(cluster[0].price, enrichedHighs[j].price);
        const intermediateBlown = h4.slice(prevIdx + 1, curIdx).some((b) => b.high > maxLevel + tol);

        if (!intermediateBlown) {
          cluster.push(enrichedHighs[j]);
          usedHighIdxs.add(j);
        }
      }
    }

    if (cluster.length >= 2) {
      usedHighIdxs.add(i);
      const eqPrice = Math.max(...cluster.map((p) => p.price));
      const lastPivot = cluster[cluster.length - 1];
      const touches = cluster.map((p) => ({ time: p.time, price: p.price, absIdx: p.absIdx }));
      
      // Check subsequent bars after the cluster's final confirmation for breaks or sweeps
      const postBars = h4.slice(lastPivot.absIdx + 1);
      const blown = postBars.some((b) => b.close > eqPrice + tol);
      const swept = !blown && postBars.some((b) => b.high > eqPrice && b.close <= eqPrice);

      rawEqhClusters.push({
        name: "4H EQH",
        price: eqPrice,
        side: 1,
        type: "MAGNET_BSL",
        time: lastPivot.time,
        confirmationTime: lastPivot.confirmationTime,
        touches,
        touchCount: cluster.length,
        state: blown ? "BROKEN" : swept ? "SWEPT" : "UNTOUCHED",
        id: `H4:EQH:${cluster.map((p) => p.time || p.absIdx).join(":")}`,
      });
    }
  }

  const rawEqlClusters = [];
  const usedLowIdxs = new Set();

  for (let i = 0; i < enrichedLows.length; i++) {
    if (usedLowIdxs.has(i)) continue;
    const cluster = [enrichedLows[i]];

    for (let j = i + 1; j < enrichedLows.length; j++) {
      if (usedLowIdxs.has(j)) continue;
      if (enrichedLows[j].absIdx - cluster[cluster.length - 1].absIdx >= 3 &&
          Math.abs(enrichedLows[i].price - enrichedLows[j].price) <= tol) {
        
        const prevIdx = cluster[cluster.length - 1].absIdx;
        const curIdx = enrichedLows[j].absIdx;
        const minLevel = Math.min(cluster[0].price, enrichedLows[j].price);
        const intermediateBlown = h4.slice(prevIdx + 1, curIdx).some((b) => b.low < minLevel - tol);

        if (!intermediateBlown) {
          cluster.push(enrichedLows[j]);
          usedLowIdxs.add(j);
        }
      }
    }

    if (cluster.length >= 2) {
      usedLowIdxs.add(i);
      const eqPrice = Math.min(...cluster.map((p) => p.price));
      const lastPivot = cluster[cluster.length - 1];
      const touches = cluster.map((p) => ({ time: p.time, price: p.price, absIdx: p.absIdx }));

      const postBars = h4.slice(lastPivot.absIdx + 1);
      const blown = postBars.some((b) => b.close < eqPrice - tol);
      const swept = !blown && postBars.some((b) => b.low < eqPrice && b.close >= eqPrice);

      rawEqlClusters.push({
        name: "4H EQL",
        price: eqPrice,
        side: -1,
        type: "MAGNET_SSL",
        time: lastPivot.time,
        confirmationTime: lastPivot.confirmationTime,
        touches,
        touchCount: cluster.length,
        state: blown ? "BROKEN" : swept ? "SWEPT" : "UNTOUCHED",
        id: `H4:EQL:${cluster.map((p) => p.time || p.absIdx).join(":")}`,
      });
    }
  }

  // Active EQH / EQL lists (non-broken)
  const eqh = rawEqhClusters.filter((e) => e.state !== "BROKEN");
  const eql = rawEqlClusters.filter((e) => e.state !== "BROKEN");

  // ---------------------------------------------------------------------------
  // 4. Detect HTF Liquidity Sweeps with Causal Time Gating
  // ---------------------------------------------------------------------------
  const sweeps = [];
  const trackedLevels = [
    ...(pdh ? [{ name: "PDH", price: pdh, side: 1, confirmationTime: keyLevels.PDH.confirmationTime, id: keyLevels.PDH.id }] : []),
    ...(pdl ? [{ name: "PDL", price: pdl, side: -1, confirmationTime: keyLevels.PDL.confirmationTime, id: keyLevels.PDL.id }] : []),
    ...(pwh ? [{ name: "PWH", price: pwh, side: 1, confirmationTime: keyLevels.PWH?.confirmationTime, id: keyLevels.PWH?.id }] : []),
    ...(pwl ? [{ name: "PWL", price: pwl, side: -1, confirmationTime: keyLevels.PWL?.confirmationTime, id: keyLevels.PWL?.id }] : []),
    ...eqh.map((e) => ({ name: "4H EQH", price: e.price, side: 1, confirmationTime: e.confirmationTime, id: e.id })),
    ...eql.map((e) => ({ name: "4H EQL", price: e.price, side: -1, confirmationTime: e.confirmationTime, id: e.id })),
    // Also track confirmed 4H Swings for sweeps as per institutional specification
    ...enrichedHighs.slice(-4).map((h) => ({ name: "4H Swing High", price: h.price, side: 1, confirmationTime: h.confirmationTime, id: `H4:SWING:H:${h.time}` })),
    ...enrichedLows.slice(-4).map((l) => ({ name: "4H Swing Low", price: l.price, side: -1, confirmationTime: l.confirmationTime, id: `H4:SWING:L:${l.time}` })),
  ];

  for (const lv of trackedLevels) {
    // Scan up to the last 24 bars
    for (let i = Math.max(0, n - 24); i < n; i++) {
      const b = h4[i];
      // CRITICAL CAUSAL GATE: A bar cannot sweep a level before the level existed!
      if (lv.confirmationTime && b.time < lv.confirmationTime) {
        continue;
      }

      if (lv.side === 1) {
        // Bullish level swept: wick pierced above level, but candle body closed back below
        if (b.high > lv.price && b.close < lv.price) {
          const depth = b.high - lv.price;
          sweeps.push({
            name: lv.name,
            levelPrice: lv.price,
            sweptPrice: b.high,
            depth,
            depthAtr: avgH4 > 0 ? Math.round((depth / avgH4) * 100) / 100 : 0,
            side: 1,
            age: n - 1 - i,
            time: b.time,
            closeTime: b.closeTime ?? (b.time + 14400),
            reversalDir: -1,
            levelId: lv.id,
            causal: true,
          });
        }
      } else {
        // Bearish level swept: wick pierced below level, but candle body closed back above
        if (b.low < lv.price && b.close > lv.price) {
          const depth = lv.price - b.low;
          sweeps.push({
            name: lv.name,
            levelPrice: lv.price,
            sweptPrice: b.low,
            depth,
            depthAtr: avgH4 > 0 ? Math.round((depth / avgH4) * 100) / 100 : 0,
            side: -1,
            age: n - 1 - i,
            time: b.time,
            closeTime: b.closeTime ?? (b.time + 14400),
            reversalDir: 1,
            levelId: lv.id,
            causal: true,
          });
        }
      }
    }
  }

  // Deduplicate sweeps by levelId/name: keep the freshest sweep for each landmark
  const uniqueSweeps = [];
  const seenSweep = new Set();
  sweeps.sort((a, b) => a.age - b.age);
  for (const s of sweeps) {
    const sweepKey = s.levelId || `${s.name}:${s.levelPrice}`;
    if (!seenSweep.has(sweepKey)) {
      seenSweep.add(sweepKey);
      uniqueSweeps.push(s);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Untapped HTF Liquidity Pools & Consumption Awareness
  // ---------------------------------------------------------------------------
  const bsl = [];
  const ssl = [];
  const consumed = [];

  const sweptLevelKeys = new Set(uniqueSweeps.map((s) => s.levelId || `${s.name}:${s.levelPrice}`));

  const addPool = (name, price, side, type, id = null, time = null, confirmationTime = null, tier = 3) => {
    const poolId = id || (side === 1 ? `BSL:${name}:${price}` : `SSL:${name}:${price}`);
    const isSwept = sweptLevelKeys.has(poolId) || sweptLevelKeys.has(`${name}:${price}`);

    // Check if price already breached or consumed this level after confirmation
    let isConsumed = isSwept;
    if (!isConsumed && confirmationTime) {
      const postBars = h4.filter((b) => b.time >= confirmationTime);
      if (side === 1 && postBars.some((b) => b.high >= price)) isConsumed = true;
      if (side === -1 && postBars.some((b) => b.low <= price)) isConsumed = true;
    }

    if (side === 1 && price > currentPrice) {
      const pool = {
        id: poolId,
        name,
        price,
        side: 1,
        targetSide: "BSL",
        distance: price - currentPrice,
        distanceAtr: avgH4 > 0 ? Math.round(((price - currentPrice) / avgH4) * 10) / 10 : 0,
        type,
        tier,
        causal: true,
        state: isConsumed ? "CONSUMED" : "UNCONSUMED",
        time,
        confirmationTime,
      };
      if (isConsumed) consumed.push(pool);
      else bsl.push(pool);
    } else if (side === -1 && price < currentPrice) {
      const pool = {
        id: poolId,
        name,
        price,
        side: -1,
        targetSide: "SSL",
        distance: currentPrice - price,
        distanceAtr: avgH4 > 0 ? Math.round(((currentPrice - price) / avgH4) * 10) / 10 : 0,
        type,
        tier,
        causal: true,
        state: isConsumed ? "CONSUMED" : "UNCONSUMED",
        time,
        confirmationTime,
      };
      if (isConsumed) consumed.push(pool);
      else ssl.push(pool);
    }
  };

  // Tier 1: Weekly Key Levels (Highest Institutional Significance)
  if (pwh) addPool("PWH", pwh, 1, "ERL", keyLevels.PWH?.id, prevWeekLastBar?.time, keyLevels.PWH?.confirmationTime, 1);
  if (pwl) addPool("PWL", pwl, -1, "ERL", keyLevels.PWL?.id, prevWeekLastBar?.time, keyLevels.PWL?.confirmationTime, 1);

  // Tier 2: Daily & Clustered EQH/EQL Levels
  if (pdh) addPool("PDH", pdh, 1, "ERL", keyLevels.PDH.id, prevD1?.time, keyLevels.PDH.confirmationTime, 2);
  if (pdl) addPool("PDL", pdl, -1, "ERL", keyLevels.PDL.id, prevD1?.time, keyLevels.PDL.confirmationTime, 2);

  for (const e of eqh) {
    if (e.state === "UNTOUCHED") {
      addPool("4H EQH", e.price, 1, "MAGNET_BSL", e.id, e.time, e.confirmationTime, 2);
    }
  }
  for (const e of eql) {
    if (e.state === "UNTOUCHED") {
      addPool("4H EQL", e.price, -1, "MAGNET_SSL", e.id, e.time, e.confirmationTime, 2);
    }
  }

  // Tier 3: 4H Structural Swings
  for (const h of enrichedHighs.slice(-4)) {
    if (h.price > currentPrice && !bsl.some((p) => Math.abs(p.price - h.price) < tol)) {
      addPool("4H Swing High", h.price, 1, "ERL", `H4:SWING:H:${h.time}`, h.time, h.confirmationTime, 3);
    }
  }
  for (const l of enrichedLows.slice(-4)) {
    if (l.price < currentPrice && !ssl.some((p) => Math.abs(p.price - l.price) < tol)) {
      addPool("4H Swing Low", l.price, -1, "ERL", `H4:SWING:L:${l.time}`, l.time, l.confirmationTime, 3);
    }
  }

  // Rank pools: sort primarily by institutional significance tier, then proximity
  bsl.sort((a, b) => a.tier !== b.tier ? a.tier - b.tier : a.distance - b.distance);
  ssl.sort((a, b) => a.tier !== b.tier ? a.tier - b.tier : a.distance - b.distance);

  // ---------------------------------------------------------------------------
  // 6. Active Delivery Cycle (ERL <-> IRL)
  // ---------------------------------------------------------------------------
  const freshSweep = uniqueSweeps.find((s) => s.age <= 6);
  let activeCycle = "IRL_TO_ERL";
  let cycleNote = "Expanding towards External Range Liquidity targets";

  if (freshSweep) {
    activeCycle = "ERL_TO_IRL";
    cycleNote = `Fresh ${freshSweep.name} sweep ${freshSweep.age * 4}h ago; rotating into internal range liquidity`;
  }

  // ---------------------------------------------------------------------------
  // 7. Definitive Institutional Draw on Liquidity (DOL) Selection
  // ---------------------------------------------------------------------------
  let inferredDir = 0;
  if (enrichedHighs.length >= 2 && enrichedLows.length >= 2) {
    if (enrichedHighs.at(-1).price > enrichedHighs.at(-2).price && enrichedLows.at(-1).price > enrichedLows.at(-2).price) inferredDir = 1;
    else if (enrichedHighs.at(-1).price < enrichedHighs.at(-2).price && enrichedLows.at(-1).price < enrichedLows.at(-2).price) inferredDir = -1;
  }

  const macroDir = structures.D1?.dir || structures.H4?.dir || (freshSweep ? freshSweep.reversalDir : inferredDir);
  const macroBias = macroDir > 0 ? "BULLISH" : macroDir < 0 ? "BEARISH" : "NEUTRAL";

  let drawOnLiquidity = null;

  if (activeCycle === "ERL_TO_IRL" && freshSweep) {
    // Rotation following liquidity raid: seeking opposite side pool or dealing range internal liquidity
    if (freshSweep.side === 1) {
      if (ssl.length > 0) {
        drawOnLiquidity = {
          ...ssl[0],
          targetSide: "SSL",
          direction: -1,
          causal: true,
          confirmationTime: freshSweep.time,
          catalyst: `Rotation following ${freshSweep.name} sweep`,
        };
      }
    } else if (freshSweep.side === -1) {
      if (bsl.length > 0) {
        drawOnLiquidity = {
          ...bsl[0],
          targetSide: "BSL",
          direction: 1,
          causal: true,
          confirmationTime: freshSweep.time,
          catalyst: `Rotation following ${freshSweep.name} sweep`,
        };
      }
    }
  } else {
    // In IRL to ERL expansion: follow the macro structural trend
    if (macroDir === 1) {
      if (bsl.length > 0) {
        drawOnLiquidity = {
          ...bsl[0],
          targetSide: "BSL",
          direction: 1,
          causal: true,
          confirmationTime: bsl[0].time || h4.at(-1).time,
          catalyst: "Macro Bullish Expansion toward BSL",
        };
      } else {
        // Bullish macro with zero BSL above (All-time highs / blue sky): Never flip to a bearish DOL!
        drawOnLiquidity = null;
      }
    } else if (macroDir === -1) {
      if (ssl.length > 0) {
        drawOnLiquidity = {
          ...ssl[0],
          targetSide: "SSL",
          direction: -1,
          causal: true,
          confirmationTime: ssl[0].time || h4.at(-1).time,
          catalyst: "Macro Bearish Expansion toward SSL",
        };
      } else {
        // Bearish macro with zero SSL below: Never flip to a bullish DOL!
        drawOnLiquidity = null;
      }
    } else {
      // Neutral consolidation: draw towards closest unconsumed pool
      if (bsl[0] && (!ssl[0] || bsl[0].distance < ssl[0].distance)) {
        drawOnLiquidity = {
          ...bsl[0],
          targetSide: "BSL",
          direction: 1,
          causal: true,
          confirmationTime: bsl[0].time || h4.at(-1).time,
          catalyst: "Clean Buy-Side Liquidity draw above",
        };
      } else if (ssl[0]) {
        drawOnLiquidity = {
          ...ssl[0],
          targetSide: "SSL",
          direction: -1,
          causal: true,
          confirmationTime: ssl[0].time || h4.at(-1).time,
          catalyst: "Clean Sell-Side Liquidity draw below",
        };
      }
    }
  }

  return {
    activeCycle,
    cycleNote,
    drawOnLiquidity,
    sweeps: uniqueSweeps,
    pools: { bsl, ssl, consumed },
    eqh,
    eql,
    keyLevels,
    currentPrice,
    macroDir,
    macroBias,
  };
}
