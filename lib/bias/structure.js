import { findPivots } from "../patterns/core.js";

// Market structure per timeframe: swing sequence (HH/HL vs LH/LL), and the
// event stream of structure breaks — BOS (continuation) vs MSS/CHoCH (shift).
// An MSS only matters if it happened WITH displacement; a limp poke through a
// swing is noise, a strong body through it is intent. This distinction is the
// core of "smelling the reversal" instead of reciting yesterday's move.

export function analyzeStructure(bars, avg, { left = 3, right = 3 } = {}) {
  const n = bars.length;
  const empty = { dir: 0, seq: "n/a", strength: 0, lastEvent: null, events: [], ranging: true };
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
    // a pivot exists only once its right-window has printed
    while (hIdx < highs.length && highs[hIdx].i + right <= i) lastH = highs[hIdx++];
    while (lIdx < lows.length && lows[lIdx].i + right <= i) lastL = lows[lIdx++];
    const c = bars[i].close;

    if (lastH && c > lastH.price) {
      events.push({
        type: dir < 0 ? "MSS" : "BOS",
        dir: 1,
        i,
        level: lastH.price,
        displaced: isDisplaced(bars, i, 1, avg),
      });
      dir = 1;
      lastH = null; // consumed — wait for the next swing high to form
    } else if (lastL && c < lastL.price) {
      events.push({
        type: dir > 0 ? "MSS" : "BOS",
        dir: -1,
        i,
        level: lastL.price,
        displaced: isDisplaced(bars, i, -1, avg),
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
  if (last) last.age = n - 1 - last.i;

  // strength: do the recent events agree with the sequence?
  const recent = events.slice(-4);
  const agree = recent.length
    ? recent.filter((e) => e.dir === (seqDir || dir)).length / recent.length
    : 0;

  // ranging: sequence mixed AND the last few events flip-flop
  const flips = recent.filter((e, i) => i > 0 && e.dir !== recent[i - 1].dir).length;
  const ranging = seq === "mixed" && flips >= 2;

  return {
    dir: seqDir || dir,
    seq,
    strength: Math.max(agree, seqDir !== 0 ? 0.5 : 0.25),
    lastEvent: last,
    events,
    ranging,
  };
}

// displacement = the break candle (or its predecessor) has real body in the
// break direction — intent, not drift
export function isDisplaced(bars, i, dir, avg) {
  for (const b of [bars[i], bars[i - 1]].filter(Boolean)) {
    const body = dir === 1 ? b.close - b.open : b.open - b.close;
    if (body >= 1.1 * avg) return true;
  }
  return false;
}
