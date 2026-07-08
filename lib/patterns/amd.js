import { FAINT } from "./core.js";

// AMD / Power of 3 — smart session model.
//
//   A — accumulation: the 00:00–06:00 (broker time) range must be a genuine
//       coil — low drift, compressed vs. the prior day's range. A trending
//       "accumulation" is not accumulation; the session is skipped.
//   M — manipulation: a CONTAINED judas sweep of the coil. Price wicks beyond
//       one side (taking the resting stops), but:
//         · depth stays bounded (too deep = real breakout, pattern void)
//         · price closes back inside within a time limit
//         · the re-entry shows displacement (a strong-bodied candle driving
//           away from the sweep side) — the institutional tell
//       Bonus if the sweep also ran the previous day's high/low.
//   D — distribution: a close beyond the OPPOSITE side of the coil. While
//       pending, a faint dashed target line marks that trigger level.
//
// Every session gets a quality score (compression 30%, displacement 25%,
// sweep-depth shape 20%, re-entry speed 15%, prior-day sweep 10%). Weak
// sessions (< 0.5) draw nothing. Strong fresh formations (≥ 0.6, manipulation
// confirmed within the last few bars, distribution not yet triggered) emit an
// "auto-alert" suggestion: a real alert at the distribution trigger, created
// by the Dashboard (deduped per symbol/day/side via a tag in the note).
const ACC_END_HOUR = 6;
const DAY = 86400;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function detectAMD(bars, ctx) {
  if (!ctx.tfSec || ctx.tfSec > 3600) return []; // intraday resolution only

  const days = new Map();
  bars.forEach((b, i) => {
    const key = Math.floor(b.time / DAY);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(i);
  });

  const keys = [...days.keys()].sort((a, b) => a - b);
  const out = [];
  for (const key of keys.slice(-2)) {
    const earlier = keys.filter((k) => k < key);
    const prev = earlier.length ? dayStats(bars, days.get(earlier[earlier.length - 1])) : null;
    const isCurrent = key === keys[keys.length - 1];
    out.push(...analyzeSession(bars, days.get(key), prev, ctx, isCurrent, key));
  }
  return out;
}

function dayStats(bars, idxs) {
  let hi = -Infinity;
  let lo = Infinity;
  for (const i of idxs) {
    hi = Math.max(hi, bars[i].high);
    lo = Math.min(lo, bars[i].low);
  }
  return { hi, lo, range: hi - lo };
}

function analyzeSession(bars, idxs, prev, ctx, isCurrent, dayKey) {
  const R = ctx.avgRange;
  const accIdxs = idxs.filter((i) => bars[i].time % DAY < ACC_END_HOUR * 3600);
  if (accIdxs.length < 6) return [];

  const acc = dayStats(bars, accIdxs);
  if (acc.range <= 0) return [];
  const accStart = accIdxs[0];
  const accEnd = accIdxs[accIdxs.length - 1];

  // --- A: must be a coil, not a trend leg
  const drift = Math.abs(bars[accEnd].close - bars[accStart].open);
  if (drift > 0.55 * acc.range) return [];
  const baseline = prev?.range || 8 * R;
  const sCompress = clamp(1 - acc.range / (0.6 * baseline), 0, 1);

  const drawings = [
    {
      kind: "zone",
      i1: accStart,
      i2: accEnd,
      top: acc.hi,
      bottom: acc.lo,
      color: FAINT.blue,
      fill: FAINT.blueFill,
      label: "A",
    },
  ];

  // --- M: contained judas sweep with timely re-entry
  const minSweep = Math.max(0.12 * acc.range, 0.4 * R);
  const maxDepth = 1.3 * acc.range;
  const maxReentryBars = Math.ceil((5 * 3600) / ctx.tfSec);
  const post = idxs.filter((i) => i > accEnd);

  let sweep = null; // { side, startI, extI, extP }
  let reentryI = null;
  for (const i of post) {
    const b = bars[i];
    if (!sweep) {
      if (b.high > acc.hi + minSweep) sweep = { side: 1, startI: i, extI: i, extP: b.high };
      else if (b.low < acc.lo - minSweep) sweep = { side: -1, startI: i, extI: i, extP: b.low };
    } else if (reentryI === null) {
      if (sweep.side === 1 && b.high > sweep.extP) { sweep.extI = i; sweep.extP = b.high; }
      if (sweep.side === -1 && b.low < sweep.extP) { sweep.extI = i; sweep.extP = b.low; }
      const depth = sweep.side === 1 ? sweep.extP - acc.hi : acc.lo - sweep.extP;
      if (depth > maxDepth) return drawings;             // real breakout, not manipulation
      if (i - sweep.startI > maxReentryBars) return drawings; // sweep never failed in time
      if (b.close <= acc.hi && b.close >= acc.lo) reentryI = i;
    } else {
      break;
    }
  }
  if (!sweep || reentryI === null) return drawings;

  // --- score the formation
  const depth = sweep.side === 1 ? sweep.extP - acc.hi : acc.lo - sweep.extP;
  const sDepth = clamp(1 - Math.abs(depth / acc.range - 0.5) * 2, 0, 1);
  const sSpeed = clamp(1 - (reentryI - sweep.startI) / maxReentryBars, 0, 1);

  let maxBody = 0; // displacement away from the sweep side, at/after re-entry
  for (let i = reentryI; i <= Math.min(reentryI + 6, bars.length - 1); i++) {
    const body = sweep.side === 1 ? bars[i].open - bars[i].close : bars[i].close - bars[i].open;
    maxBody = Math.max(maxBody, body);
  }
  const sDisplace = clamp(maxBody / (1.5 * R), 0, 1);

  const pdSweep = prev ? (sweep.side === 1 ? sweep.extP > prev.hi : sweep.extP < prev.lo) : false;
  const score =
    0.3 * sCompress + 0.25 * sDisplace + 0.2 * sDepth + 0.15 * sSpeed + 0.1 * (pdSweep ? 1 : 0);
  if (score < 0.5) return drawings;

  const grade = score >= 0.75 ? "★★★" : score >= 0.6 ? "★★" : "★";
  drawings.push({
    kind: "marker",
    i: sweep.extI,
    p: sweep.extP,
    text: `M ${grade}`,
    color: FAINT.orange,
    side: sweep.side === 1 ? "above" : "below",
  });

  // --- D: close beyond the opposite side of the coil
  const target = sweep.side === 1 ? acc.lo : acc.hi;
  let dI = null;
  for (const i of post) {
    if (i <= reentryI) continue;
    const b = bars[i];
    if (sweep.side === 1 ? b.close < acc.lo - 0.1 * acc.range : b.close > acc.hi + 0.1 * acc.range) {
      dI = i;
      break;
    }
  }

  if (dI !== null) {
    drawings.push({
      kind: "marker",
      i: dI,
      p: sweep.side === 1 ? bars[dI].low : bars[dI].high,
      text: "D",
      color: sweep.side === 1 ? FAINT.red : FAINT.green,
      side: sweep.side === 1 ? "below" : "above",
    });
  } else if (isCurrent) {
    // pending distribution: mark the trigger level (up to the current bar only)
    drawings.push({
      kind: "segment",
      i1: reentryI,
      p1: target,
      i2: bars.length - 1,
      p2: target,
      color: FAINT.orange,
      dash: [2, 4],
      label: `D trigger ${grade}`,
    });

    // fresh, strong formation → suggest a real alert at the trigger
    const fresh = bars.length - 1 - reentryI <= 12;
    if (fresh && score >= 0.6) {
      const dirWord = sweep.side === 1 ? "↓" : "↑";
      const sweptWord = sweep.side === 1 ? "swept Asia high" : "swept Asia low";
      drawings.push({
        kind: "auto-alert",
        price: target,
        condition: sweep.side === 1 ? "below" : "above",
        tagPart: `${dayKey}:${sweep.side === 1 ? "H" : "L"}`,
        noteBase: `AMD auto ${grade}: ${sweptWord}${pdSweep ? " + PD" : ""}, distribution ${dirWord} on trigger`,
      });
    }
  }

  return drawings;
}
