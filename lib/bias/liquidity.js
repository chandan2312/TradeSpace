import { findPivots } from "../patterns/core.js";

// Liquidity intelligence — the anti-lag half of the engine.
//
// Levels that hold resting stops: prior-day high/low, session highs/lows,
// equal highs/lows (builds). For each level we classify what price DID to it:
//   untapped  → resting liquidity, price is drawn toward it (magnet)
//   swept     → wick through + close back = stop hunt → REVERSAL fuel
//   broken    → close through and holding = genuine continuation
// A momentum engine reads a sweep as "strength in that direction" — exactly
// backwards. Here a sweep scores AGAINST its own direction.

const DAY = 86400;
// broker-time session windows (most MT5 brokers run UTC+2/+3)
export const SESSIONS = [
  { id: "asia", label: "Asia", from: 0, to: 7 },
  { id: "london", label: "London", from: 7, to: 13 },
  { id: "ny", label: "New York", from: 13, to: 21 },
];

export function sessionOf(timeSec) {
  const h = (timeSec % DAY) / 3600;
  return SESSIONS.find((s) => h >= s.from && h < s.to) || { id: "off", label: "Off-hours" };
}

// Build the level map + classify each level from intraday bars (M5/M15).
export function liquidityMap(bars, avg) {
  const n = bars.length;
  if (n < 50) return { levels: [], sweeps: [], builds: [], draws: { above: [], below: [] } };

  const lastT = bars[n - 1].time;
  const todayKey = Math.floor(lastT / DAY);
  const todayIdx = [];
  const prevIdx = [];
  for (let i = 0; i < n; i++) {
    const k = Math.floor(bars[i].time / DAY);
    if (k === todayKey) todayIdx.push(i);
    else if (k < todayKey) prevIdx.push(i); // most recent earlier day wins below
  }

  const levels = [];

  // prior day H/L (strongest intraday reference)
  const prevDayKey = prevIdx.length ? Math.floor(bars[prevIdx[prevIdx.length - 1]].time / DAY) : null;
  if (prevDayKey != null) {
    const pd = prevIdx.filter((i) => Math.floor(bars[i].time / DAY) === prevDayKey);
    levels.push(
      { name: "PDH", price: Math.max(...pd.map((i) => bars[i].high)), side: 1, weightMul: 1.3, formedAt: pd[pd.length - 1] },
      { name: "PDL", price: Math.min(...pd.map((i) => bars[i].low)), side: -1, weightMul: 1.3, formedAt: pd[pd.length - 1] }
    );
  }

  // today's completed/ongoing session H/Ls
  for (const s of SESSIONS) {
    const idx = todayIdx.filter((i) => {
      const h = (bars[i].time % DAY) / 3600;
      return h >= s.from && h < s.to;
    });
    if (idx.length < 3) continue;
    levels.push(
      { name: `${s.label} H`, price: Math.max(...idx.map((i) => bars[i].high)), side: 1, weightMul: 1, formedAt: idx[idx.length - 1] },
      { name: `${s.label} L`, price: Math.min(...idx.map((i) => bars[i].low)), side: -1, weightMul: 1, formedAt: idx[idx.length - 1] }
    );
  }

  // equal highs/lows = liquidity BUILDS (pools being engineered)
  const builds = equalClusters(bars, avg);
  for (const b of builds) {
    levels.push({ name: b.side === 1 ? "EQH" : "EQL", price: b.price, side: b.side, weightMul: 1.1, formedAt: b.lastI, build: true });
  }

  // classify every level from the bars after it formed
  const px = bars[n - 1].close;
  const sweeps = [];
  const draws = { above: [], below: [] };
  for (const lv of levels) {
    const st = classifyLevel(bars, lv, avg);
    lv.state = st.state;
    if (st.state === "swept") sweeps.push({ ...lv, sweptAt: st.i, age: n - 1 - st.i });
    if (st.state === "broken") lv.brokenAt = st.i;
    if (st.state === "untapped") {
      if (lv.price > px) draws.above.push(lv);
      else draws.below.push(lv);
    }
  }
  draws.above.sort((a, b) => a.price - b.price);
  draws.below.sort((a, b) => b.price - a.price);

  return { levels, sweeps, builds, draws };
}

// wick through + close back within a few bars = sweep; close through and
// holding = broken; never touched = untapped
function classifyLevel(bars, lv, avg) {
  const n = bars.length;
  const eps = 0.05 * avg;
  for (let i = lv.formedAt + 1; i < n; i++) {
    const beyond = lv.side === 1 ? bars[i].high > lv.price + eps : bars[i].low < lv.price - eps;
    if (!beyond) continue;
    // look ahead ≤3 bars for a close back inside
    for (let j = i; j < Math.min(i + 4, n); j++) {
      const backIn = lv.side === 1 ? bars[j].close < lv.price : bars[j].close > lv.price;
      if (backIn) return { state: "swept", i: j };
    }
    // still out after the grace window → real break (or too fresh to judge)
    const lastClose = bars[n - 1].close;
    const stillOut = lv.side === 1 ? lastClose > lv.price : lastClose < lv.price;
    return stillOut ? { state: "broken", i } : { state: "swept", i: Math.min(i + 3, n - 1) };
  }
  return { state: "untapped" };
}

// equal highs/lows: 2+ pivots within tolerance, still untapped by a close
function equalClusters(bars, avg) {
  const { highs, lows } = findPivots(bars, 3, 3);
  const tol = 0.25 * avg;
  const out = [];
  for (const [pivots, side] of [[highs.slice(-25), 1], [lows.slice(-25), -1]]) {
    const grouped = new Set();
    for (let a = 0; a < pivots.length - 1; a++) {
      if (grouped.has(a)) continue;
      const grp = [pivots[a]];
      for (let b = a + 1; b < pivots.length; b++) {
        if (!grouped.has(b) && Math.abs(pivots[b].price - pivots[a].price) <= tol) {
          grp.push(pivots[b]);
          grouped.add(b);
        }
      }
      if (grp.length < 2) continue;
      const price = side === 1 ? Math.max(...grp.map((g) => g.price)) : Math.min(...grp.map((g) => g.price));
      out.push({ side, price, touches: grp.length, lastI: grp[grp.length - 1].i });
    }
  }
  return out;
}

// QML (quasimodo): a swing extreme gets SWEPT, then price breaks the
// intermediate swing on the other side — sweep + MSS in one shape. The
// highest-conviction reversal signature in the user's playbook.
export function detectQML(bars, avg, lookback = 90) {
  const n = bars.length;
  const start = Math.max(0, n - lookback);
  const win = bars.slice(start);
  const { highs, lows } = findPivots(win, 3, 3);
  const eps = 0.05 * avg;
  let best = null;

  // bearish QML: sweep of a pivot high, then close below the neck (lowest low
  // between the pivot and the sweep bar)
  for (const side of [1, -1]) {
    const pivots = side === 1 ? highs : lows;
    for (let k = pivots.length - 1; k >= 0; k--) {
      const P = pivots[k];
      for (let i = P.i + 4; i < win.length; i++) {
        const sweptNow = side === 1 ? win[i].high > P.price + eps && win[i].close < P.price : win[i].low < P.price - eps && win[i].close > P.price;
        if (!sweptNow) continue;
        let neck = side === 1 ? Infinity : -Infinity;
        for (let m = P.i + 1; m < i; m++) {
          neck = side === 1 ? Math.min(neck, win[m].low) : Math.max(neck, win[m].high);
        }
        if (!Number.isFinite(neck)) continue;
        for (let j = i + 1; j < Math.min(i + 20, win.length); j++) {
          const broke = side === 1 ? win[j].close < neck : win[j].close > neck;
          if (broke) {
            const age = win.length - 1 - j;
            if (!best || age < best.age) best = { dir: -side, age, i: start + j };
            break;
          }
        }
        break; // only the first sweep of this pivot counts
      }
      if (best && best.age <= 20) break;
    }
  }
  return best;
}
