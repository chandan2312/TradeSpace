import { findPivots } from "../patterns/core.js";
import { sessionOf, getTradingDayKey, getEetTime, SESSIONS } from "../time.js";

// Re-export sessionOf and SESSIONS for full backward compatibility
export { sessionOf, SESSIONS };

/**
 * Liquidity Intelligence Engine — Intraday Stop Hunts, Pools & QML Signatures.
 *
 * Core Principles:
 * 1. Levels holding resting stops: PDH/PDL, completed session highs/lows, equal clusters (EQH/EQL).
 * 2. Developing session extremes are tracked as DEVELOPING and strictly excluded from resting draws.
 * 3. Event classification:
 *    - untapped   → resting liquidity pool, acts as price magnet (draw)
 *    - swept      → wick pierce + close back inside within grace window = stop hunt (reversal fuel)
 *    - broken     → close beyond and maintained acceptance = structural breakout
 *    - pending    → fresh breach near the live candle boundary awaiting resolution
 *    - developing → active in-progress session extreme moving with current price
 * 4. detectQML: Bidirectional, symmetric scanning with intact pivot verification,
 *    structural swing neck identification, and Head invalidation protection.
 */

// Build the intraday level map + classify each level from intraday bars (M5/M15).
export function liquidityMap(bars, avg, opts = {}) {
  const n = bars?.length ?? 0;
  if (n < 20) {
    return {
      levels: [],
      sweeps: [],
      builds: [],
      draws: { above: [], below: [] },
      meta: { barCount: n, todayKey: null, prevDayKey: null }
    };
  }

  const effectiveAvg = avg && Number.isFinite(avg) && avg > 0 ? avg : 1.0;
  const lastBar = bars[n - 1];
  const lastT = lastBar.time;
  const todayKey = getTradingDayKey(lastT);
  const px = lastBar.close;

  const todayIdx = [];
  const prevIdx = [];
  for (let i = 0; i < n; i++) {
    const k = getTradingDayKey(bars[i].time);
    if (k === todayKey) todayIdx.push(i);
    else if (k < todayKey) prevIdx.push(i);
  }

  const levels = [];

  // 1. Prior Day High & Low (PDH / PDL)
  const prevDayKey = prevIdx.length ? getTradingDayKey(bars[prevIdx[prevIdx.length - 1]].time) : null;
  let pdCoverage = 0;
  if (prevDayKey != null) {
    const pd = prevIdx.filter((i) => getTradingDayKey(bars[i].time) === prevDayKey);
    pdCoverage = pd.length;
    if (pd.length >= 6) {
      const isPartial = pd.length < 24; // Less than 6 hours on M15
      const pdHigh = Math.max(...pd.map((i) => bars[i].high));
      const pdLow = Math.min(...pd.map((i) => bars[i].low));
      const formedAt = pd[pd.length - 1];
      levels.push(
        {
          id: `pdh_${prevDayKey}`,
          name: "PDH",
          price: pdHigh,
          side: 1,
          weightMul: isPartial ? 1.0 : 1.3,
          formedAt,
          isPartial
        },
        {
          id: `pdl_${prevDayKey}`,
          name: "PDL",
          price: pdLow,
          side: -1,
          weightMul: isPartial ? 1.0 : 1.3,
          formedAt,
          isPartial
        }
      );
    }
  }

  // Current time in Europe/Athens to evaluate session completion vs developing
  const { totalMinutes: currentTotalMins } = getEetTime(lastT);
  const currentHour = currentTotalMins / 60;

  // 2. Previous Day's Completed Sessions (Yesterday's Asia, London, NY)
  // Deduplicate against PDH/PDL so identical price points aren't duplicated
  if (prevDayKey != null) {
    const pd = prevIdx.filter((i) => getTradingDayKey(bars[i].time) === prevDayKey);
    const pdhObj = levels.find((l) => l.name === "PDH");
    const pdlObj = levels.find((l) => l.name === "PDL");
    for (const s of SESSIONS) {
      if (s.id === "dead_zone" || s.id === "off") continue;
      const sIdx = pd.filter((i) => {
        const h = getEetTime(bars[i].time).totalMinutes / 60;
        return s.from <= s.to ? (h >= s.from && h < s.to) : (h >= s.from || h < s.to);
      });
      if (sIdx.length >= 3) {
        const sHigh = Math.max(...sIdx.map((i) => bars[i].high));
        const sLow = Math.min(...sIdx.map((i) => bars[i].low));
        // If session high/low matches PDH/PDL within tolerance, PDH/PDL takes precedence
        if (!pdhObj || Math.abs(sHigh - pdhObj.price) > 0.15 * effectiveAvg) {
          levels.push({
            id: `prev_${s.id}_h_${prevDayKey}`,
            name: `Prev ${s.label} H`,
            price: sHigh,
            side: 1,
            weightMul: 1.0,
            formedAt: sIdx[sIdx.length - 1],
            isPriorDaySession: true
          });
        }
        if (!pdlObj || Math.abs(sLow - pdlObj.price) > 0.15 * effectiveAvg) {
          levels.push({
            id: `prev_${s.id}_l_${prevDayKey}`,
            name: `Prev ${s.label} L`,
            price: sLow,
            side: -1,
            weightMul: 1.0,
            formedAt: sIdx[sIdx.length - 1],
            isPriorDaySession: true
          });
        }
      }
    }
  }

  // 3. Today's Sessions: Completed vs Developing
  for (const s of SESSIONS) {
    if (s.id === "dead_zone" || s.id === "off") continue;
    const sIdx = todayIdx.filter((i) => {
      const h = getEetTime(bars[i].time).totalMinutes / 60;
      return s.from <= s.to ? (h >= s.from && h < s.to) : (h >= s.from || h < s.to);
    });
    if (sIdx.length < 3) continue;

    // Session is completed if the current bar's time is past session end
    const isCompleted = currentHour >= s.to;
    const isDeveloping = !isCompleted;
    const sHigh = Math.max(...sIdx.map((i) => bars[i].high));
    const sLow = Math.min(...sIdx.map((i) => bars[i].low));
    const formedAt = sIdx[sIdx.length - 1];

    levels.push(
      {
        id: `${s.id}_h_${todayKey}`,
        name: `${s.label} H`,
        price: sHigh,
        side: 1,
        weightMul: isDeveloping ? 0.6 : 1.0,
        formedAt,
        isDeveloping,
        isCompleted
      },
      {
        id: `${s.id}_l_${todayKey}`,
        name: `${s.label} L`,
        price: sLow,
        side: -1,
        weightMul: isDeveloping ? 0.6 : 1.0,
        formedAt,
        isDeveloping,
        isCompleted
      }
    );
  }

  // 4. Equal Highs / Lows (Liquidity Builds)
  const builds = equalClusters(bars, effectiveAvg);
  for (const b of builds) {
    levels.push({
      id: b.id,
      name: b.side === 1 ? "EQH" : "EQL",
      price: b.price,
      side: b.side,
      touches: b.touches,
      weightMul: 1.1 + Math.min(0.3, (b.touches - 2) * 0.1),
      formedAt: b.lastI,
      build: true,
      pivots: b.pivots
    });
  }

  // 5. Classify every level
  const sweeps = [];
  const draws = { above: [], below: [] };

  for (const lv of levels) {
    const st = classifyLevel(bars, lv, effectiveAvg);
    lv.state = st.state;
    lv.events = st.events;

    if (st.state === "swept") {
      lv.sweptAt = st.i;
      lv.age = n - 1 - st.i;
      sweeps.push({ ...lv, sweptAt: st.i, age: n - 1 - st.i });
    } else if (st.state === "broken") {
      lv.brokenAt = st.i;
      lv.age = n - 1 - st.i;
    } else if (st.state === "untapped" && !lv.isDeveloping) {
      // Resting liquidity: price is drawn toward it (magnet)
      // Strictly exclude developing in-progress session extremes
      const distanceAtr = Math.abs(lv.price - px) / effectiveAvg;
      const drawItem = { ...lv, distanceAtr };
      if (lv.price > px) draws.above.push(drawItem);
      else draws.below.push(drawItem);
    }
  }

  // Sort draws by proximity to current price
  draws.above.sort((a, b) => a.price - b.price); // Ascending: closest above
  draws.below.sort((a, b) => b.price - a.price); // Descending: closest below

  // Deduplicate coincident sweeps at the same price zone to prevent double-counting in engine.js
  const uniqueSweeps = [];
  for (const sw of sweeps) {
    const dup = uniqueSweeps.find(
      (u) => u.side === sw.side && Math.abs(u.price - sw.price) <= 0.15 * effectiveAvg && Math.abs(u.sweptAt - sw.sweptAt) <= 2
    );
    if (!dup) {
      uniqueSweeps.push(sw);
    } else if (sw.weightMul > dup.weightMul) {
      const idx = uniqueSweeps.indexOf(dup);
      uniqueSweeps[idx] = sw;
    }
  }

  return {
    levels,
    sweeps: uniqueSweeps,
    builds,
    draws,
    meta: {
      todayKey,
      prevDayKey,
      pdCoverage,
      currentHour,
      barCount: n
    }
  };
}

/**
 * Classifies the interaction state of price with a liquidity level.
 * Handles single-bar wicks, multi-bar reclaims (sweeps), pending breakouts, and confirmed acceptance.
 */
export function classifyLevel(bars, lv, avg) {
  const n = bars?.length ?? 0;
  const effectiveAvg = avg && Number.isFinite(avg) && avg > 0 ? avg : 1.0;
  const eps = Math.max(1e-5, 0.05 * effectiveAvg);
  const events = [];

  // In-progress session extremes are developing by definition
  if (lv.isDeveloping) {
    return { state: "developing", i: lv.formedAt, events };
  }

  let currentState = "untapped";
  let lastEventI = lv.formedAt;
  let brokenAt = null;
  let sweptAt = null;

  for (let i = lv.formedAt + 1; i < n; i++) {
    const isHigh = lv.side === 1;
    const pierced = isHigh ? bars[i].high > lv.price + eps : bars[i].low < lv.price - eps;
    if (!pierced) continue;

    // We have a pierce at bar i!
    // Check if price reclaims (closes back inside) within a 1-4 bar grace window
    let reclaimed = false;
    let reclaimI = -1;
    const windowEnd = Math.min(i + 4, n);

    for (let j = i; j < windowEnd; j++) {
      const closedInside = isHigh ? bars[j].close < lv.price : bars[j].close > lv.price;
      if (closedInside) {
        reclaimed = true;
        reclaimI = j;
        break;
      }
    }

    if (reclaimed) {
      // Valid Liquidity Sweep (Stop Hunt)
      currentState = "swept";
      sweptAt = reclaimI;
      lastEventI = reclaimI;
      events.push({
        type: "sweep",
        pierceI: i,
        reclaimI,
        time: bars[reclaimI]?.time,
        depth: isHigh ? bars[i].high - lv.price : lv.price - bars[i].low
      });
      // Skip ahead past the reclaim bar to avoid re-triggering on the same test
      i = reclaimI;
    } else {
      // Did not reclaim within window.
      // Is this pierce fresh near the end of the data (unresolved)?
      if (i >= n - 3) {
        // Pending: Candle breached within last 1-3 bars, outcome pending
        currentState = "pending";
        lastEventI = i;
        events.push({ type: "pending", pierceI: i, time: bars[i]?.time });
        break;
      } else {
        // Confirmed Breakout: Closed beyond and held beyond the grace window
        currentState = "broken";
        brokenAt = i;
        lastEventI = i;
        events.push({ type: "break", pierceI: i, time: bars[i]?.time });
        break; // Once broken & accepted, level is consumed
      }
    }
  }

  return {
    state: currentState,
    i: lastEventI,
    brokenAt,
    sweptAt,
    events
  };
}

/**
 * Equal Highs / Lows (EQH / EQL) Liquidity Clusters.
 * Requires:
 * 1. 2+ pivots within ATR tolerance.
 * 2. Minimum separation of 4 bars between touches to prevent micro-wiggles.
 * 3. Intermediate blow-through check: price between touches must NOT have closed beyond the level.
 * 4. Intermediate pullback check: price between touches must pull back at least 0.35 * ATR.
 * 5. Level must not have been violated by a close beyond level + tol after the last touch.
 */
export function equalClusters(bars, avg) {
  const n = bars?.length ?? 0;
  if (n < 20) return [];
  const { highs, lows } = findPivots(bars, 3, 3);
  const effectiveAvg = avg && Number.isFinite(avg) && avg > 0 ? avg : 1.0;
  const tol = 0.20 * effectiveAvg;
  const out = [];

  for (const [pivots, side] of [[highs, 1], [lows, -1]]) {
    if (pivots.length < 2) continue;
    // Keep last 40 pivots for deep historical coverage
    const recentPivots = pivots.slice(-40);
    const used = new Set();

    for (let a = 0; a < recentPivots.length - 1; a++) {
      if (used.has(a)) continue;
      const pa = recentPivots[a];
      const cluster = [pa];

      for (let b = a + 1; b < recentPivots.length; b++) {
        if (used.has(b)) continue;
        const pb = recentPivots[b];

        // 1. Price within tolerance of cluster anchor
        if (Math.abs(pb.price - pa.price) > tol) continue;

        // 2. Separation check: >= 4 bars apart
        if (pb.i - cluster[cluster.length - 1].i < 4) continue;

        // 3. Intermediate blow-through check: price between touches must not exceed level + tol
        let blownThrough = false;
        const prevI = cluster[cluster.length - 1].i;
        for (let m = prevI + 1; m < pb.i; m++) {
          if (side === 1 && bars[m].high > Math.max(pa.price, pb.price) + tol) {
            blownThrough = true;
            break;
          }
          if (side === -1 && bars[m].low < Math.min(pa.price, pb.price) - tol) {
            blownThrough = true;
            break;
          }
        }
        if (blownThrough) continue;

        // 4. Intermediate pullback check: must have pulled back at least 0.35 * ATR
        let maxPullback = 0;
        for (let m = prevI + 1; m < pb.i; m++) {
          const pbDist = side === 1 ? pa.price - bars[m].low : bars[m].high - pa.price;
          if (pbDist > maxPullback) maxPullback = pbDist;
        }
        if (maxPullback < 0.35 * effectiveAvg) continue;

        // Touch is valid
        cluster.push(pb);
        used.add(b);
      }

      if (cluster.length >= 2) {
        used.add(a);
        const price = side === 1
          ? Math.max(...cluster.map((p) => p.price))
          : Math.min(...cluster.map((p) => p.price));
        const lastI = cluster[cluster.length - 1].i;

        // 5. Price after last touch must not have closed beyond level + tol
        let alreadyViolated = false;
        for (let k = lastI + 1; k < n; k++) {
          if (side === 1 && bars[k].close > price + tol) {
            alreadyViolated = true;
            break;
          }
          if (side === -1 && bars[k].close < price - tol) {
            alreadyViolated = true;
            break;
          }
        }

        if (!alreadyViolated) {
          out.push({
            id: `eq_${side === 1 ? "h" : "l"}_${lastI}_${Math.round(price * 100)}`,
            side,
            price,
            touches: cluster.length,
            lastI,
            pivots: cluster.map((p) => ({ i: p.i, price: p.price, time: bars[p.i]?.time }))
          });
        }
      }
    }
  }

  return out;
}

/**
 * QML (Quasimodo Pattern) Detection Engine.
 * A swing extreme gets SWEPT (Head), then price aggressively reverses and breaks
 * the intermediate structural swing pivot on the other side (Neck) = Sweep + MSS.
 *
 * Guarantees:
 * 1. Symmetrical scanning of both bullish and bearish candidates with zero scan bias.
 * 2. Intact pivot verification (pivot was not broken prior to sweep).
 * 3. Identifies the structural swing low / high neck.
 * 4. Head invalidation check (if price traded beyond Head after break, pattern is invalidated).
 * 5. Max age cap (40 bars) to eliminate ancient stale signals.
 * 6. Returns full entry geometry: { dir, age, i, headPrice, neckPrice, leftShoulderPrice, qmlPrice, state, valid }.
 */
export function detectQML(bars, avg, lookback = 90) {
  const n = bars?.length ?? 0;
  if (n < 25) return null;
  const start = Math.max(0, n - lookback);
  const win = bars.slice(start);
  const winN = win.length;
  const { highs, lows } = findPivots(win, 3, 3);
  const effectiveAvg = avg && Number.isFinite(avg) && avg > 0 ? avg : 1.0;
  const eps = Math.max(1e-5, 0.05 * effectiveAvg);

  const candidates = [];

  // Symmetrical evaluation of both bearish (side=1) and bullish (side=-1) setups
  for (const side of [1, -1]) {
    const pivots = side === 1 ? highs : lows;
    const oppPivots = side === 1 ? lows : highs;
    if (pivots.length < 1) continue;

    for (let k = pivots.length - 1; k >= 0; k--) {
      const P = pivots[k];
      // Pivot confirmation window: need at least 3 bars after P.i for pivot to exist
      if (P.i + 3 >= winN) continue;

      // 1. Pivot Integrity Check:
      // Verify pivot was intact prior to sweep (no closes beyond P.price before the sweep)
      let preBroken = false;
      let sweepFound = false;
      let sweepI = -1;
      let sweepExtreme = P.price;

      for (let i = P.i + 1; i < winN; i++) {
        const wickedBeyond = side === 1 ? win[i].high > P.price + eps : win[i].low < P.price - eps;
        if (wickedBeyond) {
          // Check for sweep reclaim within 1-3 bars
          let reclaimed = false;
          let rBar = -1;
          for (let j = i; j < Math.min(i + 4, winN); j++) {
            const backIn = side === 1 ? win[j].close < P.price : win[j].close > P.price;
            if (backIn) {
              reclaimed = true;
              rBar = j;
              break;
            }
          }
          if (reclaimed) {
            sweepFound = true;
            sweepI = i;
            sweepExtreme = side === 1
              ? Math.max(...win.slice(i, rBar + 1).map((b) => b.high))
              : Math.min(...win.slice(i, rBar + 1).map((b) => b.low));
            break;
          } else {
            // Broke through without reclaiming within grace window
            preBroken = true;
            break;
          }
        }

        const closedBeyond = side === 1 ? win[i].close > P.price : win[i].close < P.price;
        if (closedBeyond) {
          preBroken = true;
          break;
        }
      }

      if (preBroken || !sweepFound || sweepI < 0) continue;

      // 2. Structural Neck Identification:
      // Find the intermediate swing pivot between P.i and sweepI
      const intermediateOppPivots = oppPivots.filter((op) => op.i > P.i && op.i < sweepI);
      let neckPrice = null;
      let neckI = -1;

      if (intermediateOppPivots.length > 0) {
        // Structural swing pivot neck
        const bestNeckPivot = side === 1
          ? intermediateOppPivots.reduce((min, p) => p.price < min.price ? p : min, intermediateOppPivots[0])
          : intermediateOppPivots.reduce((max, p) => p.price > max.price ? p : max, intermediateOppPivots[0]);
        neckPrice = bestNeckPivot.price;
        neckI = bestNeckPivot.i;
      } else {
        // Fallback to absolute extreme between P.i and sweepI if no 3/3 pivot formed
        let extreme = side === 1 ? Infinity : -Infinity;
        let extI = -1;
        for (let m = P.i + 1; m < sweepI; m++) {
          if (side === 1 && win[m].low < extreme) {
            extreme = win[m].low;
            extI = m;
          } else if (side === -1 && win[m].high > extreme) {
            extreme = win[m].high;
            extI = m;
          }
        }
        if (Number.isFinite(extreme) && extI >= 0) {
          neckPrice = extreme;
          neckI = extI;
        }
      }

      if (neckPrice == null || !Number.isFinite(neckPrice)) continue;

      // 3. Neck Break (MSS Confirmation):
      // Look for a close beyond the neck after the sweep
      let breakFound = false;
      let breakI = -1;

      for (let j = sweepI + 1; j < Math.min(sweepI + 25, winN); j++) {
        const brokeNeck = side === 1 ? win[j].close < neckPrice : win[j].close > neckPrice;
        if (brokeNeck) {
          breakFound = true;
          breakI = j;
          break;
        }
      }

      if (!breakFound || breakI < 0) continue;

      // 4. Invalidation Check:
      // After break, did price breach the Head (sweepExtreme)?
      let invalidated = false;
      for (let m = breakI + 1; m < winN; m++) {
        if (side === 1 && win[m].high > sweepExtreme) {
          invalidated = true;
          break;
        }
        if (side === -1 && win[m].low < sweepExtreme) {
          invalidated = true;
          break;
        }
      }
      if (invalidated) continue; // Exclude invalidated QMLs

      // 5. Retest / Mitigation Check:
      // After break, did price already retest the Left Shoulder (P.price)?
      // If retested, the QML setup is mitigated/completed.
      let mitigated = false;
      for (let m = breakI + 1; m < winN; m++) {
        if (side === 1 && win[m].high >= P.price) {
          mitigated = true;
          break;
        }
        if (side === -1 && win[m].low <= P.price) {
          mitigated = true;
          break;
        }
      }

      // 6. Staleness check:
      const age = winN - 1 - breakI;
      if (age > 24) continue; // Cap maximum age to avoid ancient stale signals

      candidates.push({
        dir: -side, // Bearish QML has dir = -1; Bullish QML has dir = 1
        side,
        age,
        i: start + breakI,
        breakI: start + breakI,
        sweepI: start + sweepI,
        neckI: start + neckI,
        leftShoulderPrice: P.price,
        headPrice: sweepExtreme,
        neckPrice,
        qmlPrice: P.price, // Left shoulder level = primary retest/entry target
        valid: !invalidated,
        mitigated,
        state: mitigated ? "mitigated" : "active"
      });
    }
  }

  if (candidates.length === 0) return null;

  // Filter for unmitigated active candidates first
  const activeOnly = candidates.filter((c) => c.state === "active" && !c.mitigated && c.age <= 20);
  if (activeOnly.length > 0) {
    activeOnly.sort((a, b) => a.age - b.age);
    return activeOnly[0];
  }

  // Fallback to freshest candidate with its correct state ("mitigated")
  candidates.sort((a, b) => a.age - b.age);
  return candidates[0];
}
