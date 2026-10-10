import { findPivots, avgRange } from "../patterns/core.js";
import { computeDealingRange, analyzeAllDealingRanges } from "./ranges.js";
import { displacementAt } from "./institutional.js";

export { computeDealingRange, analyzeAllDealingRanges, displacementAt };

// Market structure per timeframe: swing sequence (HH/HL vs LH/LL), and the
// event stream of structure breaks — BOS (continuation) vs MSS/CHoCH (shift).
// An MSS only matters if it happened WITH displacement; a limp poke through a
// swing is noise, a strong body through it is intent.
export function analyzeStructure(bars, avg = null, { left = 3, right = 3, tf = "H4" } = {}) {
  bars = bars || [];
  const n = bars.length;
  const a = avg || avgRange(bars);
  const empty = { dir: 0, seq: "n/a", strength: 0, lastEvent: null, lastDisplacedEvent: null, events: [], ranging: true, range: null };
  if (n < left + right + 10) return empty;

  const { highs, lows } = findPivots(bars, left, right);
  if (highs.length < 2 || lows.length < 2) return empty;

  // ---- event stream: walk bars, break of the last confirmed swing = event
  let dir = 0;
  let lastH = null;
  let lastL = null;
  let hIdx = 0;
  let lIdx = 0;
  const events = [];

  for (let i = 0; i < n; i++) {
    while (hIdx < highs.length && highs[hIdx].i + right <= i) lastH = highs[hIdx++];
    while (lIdx < lows.length && lows[lIdx].i + right <= i) lastL = lows[lIdx++];
    const c = bars[i].close;

    if (lastH && c > lastH.price) {
      const disp = displacementAt(bars, i, 1, a);
      events.push({
        id: `${tf}:BREAK:${lastH.time}:${bars[i].time}`,
        type: dir < 0 ? "MSS" : "BOS",
        dir: 1,
        i,
        time: bars[i].time,
        confirmationTime: bars[i].time,
        level: lastH.price,
        pivotId: `P:H:${lastH.time}`,
        pivotConfirmedAt: lastH.i + right,
        displaced: disp.valid,
        displacement: disp,
        age: n - 1 - i,
      });
      dir = 1;
      lastH = null;
    } else if (lastL && c < lastL.price) {
      const disp = displacementAt(bars, i, -1, a);
      events.push({
        id: `${tf}:BREAK:${lastL.time}:${bars[i].time}`,
        type: dir > 0 ? "MSS" : "BOS",
        dir: -1,
        i,
        time: bars[i].time,
        confirmationTime: bars[i].time,
        level: lastL.price,
        pivotId: `P:L:${lastL.time}`,
        pivotConfirmedAt: lastL.i + right,
        displaced: disp.valid,
        displacement: disp,
        age: n - 1 - i,
      });
      dir = -1;
      lastL = null;
    }
  }

  // ---- swing sequence label from the last two highs + lows
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const hh = h2.price > h1.price;
  const hl = l2.price > l1.price;
  let seqDir = 0;
  let seq = "mixed";
  if (hh && hl) { seqDir = 1; seq = "HH+HL"; }
  else if (!hh && !hl) { seqDir = -1; seq = "LH+LL"; }

  const last = events[events.length - 1] || null;
  const lastDisplaced = events.filter((e) => e.displaced).at(-1) || null;

  // strength: do the recent events agree with the sequence?
  const recent = events.slice(-4);
  const agree = recent.length
    ? recent.filter((e) => e.dir === (seqDir || dir)).length / recent.length
    : 0;

  const flips = recent.filter((e, i) => i > 0 && e.dir !== recent[i - 1].dir).length;
  const ranging = seq === "mixed" && flips >= 2;

  return {
    dir: seqDir || dir,
    seq,
    strength: Math.max(agree, seqDir !== 0 ? 0.5 : 0.25),
    lastEvent: last,
    lastDisplacedEvent: lastDisplaced,
    events,
    ranging,
    range: computeDealingRange(bars, tf, a),
    fractals: { highs, lows },
  };
}

export function isDisplaced(bars, i, dir, avg) {
  return displacementAt(bars, i, dir, avg).valid;
}
