import { findPivots, FAINT } from "./core.js";

// Trendline liquidity pools — smart edition.
//
// A trendline only holds liquidity if it is OBVIOUS: the more traders draw it,
// the more stops rest behind it. So a pool must be clean (tight touches, no
// closes through it), alive (recent, price still on the respecting side) and
// UNTAPPED (no wick has pierced the projected line after the last touch —
// once hunted, the pool is gone and we hide it).
//
// Direction rules (no "other side" lines):
//   · ascending line through swing LOWS  → sell-stops below  (support)
//   · descending line through swing HIGHS → buy-stops above  (resistance)
//
// Pipeline per side:
//   1. candidate lines through every pivot pair (slope-sign constrained)
//   2. least-squares REFIT through the touch set for a clean line
//   3. hard filters: ≥3 touches, min lifespan, respected between touches,
//      not hunted after the last touch, price still on the respecting side
//      and near enough for the pool to be actionable
//   4. quality score → threshold, dedupe, keep the best 2 per side
//
// Drawn only from first to last touch — no projection into the future.
export function detectTrendlineLiquidity(bars, ctx) {
  const { highs, lows } = findPivots(bars, 3, 3);
  return [
    ...findPools(bars, lows, +1, ctx),
    ...findPools(bars, highs, -1, ctx),
  ];
}

function findPools(bars, pivotsAll, dir, ctx) {
  const R = ctx.avgRange;
  const tol = 0.25 * R;        // max distance for a "touch"
  const pierceTol = 0.15 * R;  // wick beyond the line by more than this = pierced
  const minSlope = 0.03 * R;   // per bar — flat lines belong to the DT/DB detector
  const maxSlope = 1.5 * R;    // per bar — near-vertical lines are noise
  const minSpan = 25;          // bars between first and last touch
  const maxAge = 120;          // bars since last touch
  const maxDist = 6 * R;       // price too far from the pool = stale, hide
  const n = bars.length;

  const pivots = pivotsAll.slice(-40);
  const seen = new Set();
  const pools = [];

  for (let a = 0; a < pivots.length - 1; a++) {
    for (let b = a + 1; b < pivots.length; b++) {
      const A = pivots[a];
      const B = pivots[b];
      if (B.i - A.i < 8) continue;
      const rawSlope = (B.price - A.price) / (B.i - A.i);
      // ascending-only through lows, descending-only through highs
      if (dir * rawSlope < minSlope || Math.abs(rawSlope) > maxSlope) continue;

      // touches on the raw anchor line, then refit and re-collect
      let line = { m: rawSlope, c: A.price - rawSlope * A.i };
      let touches = collectTouches(pivots, line, tol, pierceTol, dir);
      if (touches.length < 3) continue;
      line = fitLine(touches);
      if (dir * line.m < minSlope || Math.abs(line.m) > maxSlope) continue;
      touches = collectTouches(pivots, line, tol, pierceTol, dir);
      if (touches.length < 3) continue;

      const first = touches[0];
      const last = touches[touches.length - 1];
      const span = last.i - first.i;
      if (span < minSpan) continue;
      if (n - 1 - last.i > maxAge) continue;

      const key = touches.map((t) => t.i).join(",");
      if (seen.has(key)) continue;
      seen.add(key);

      const L = (i) => line.m * i + line.c;

      // respected while alive: no close through the line between the touches
      if (closedThrough(bars, first.i, last.i, L, dir, tol)) continue;
      // UNTAPPED only: any wick through the projected line after the last
      // touch means the stops were taken — the pool no longer exists
      if (hunted(bars, last.i, n, L, dir, pierceTol)) continue;
      // pending & actionable: price still on the respecting side, close enough
      const lineNow = L(n - 1);
      const px = bars[n - 1].close;
      if (dir * (px - lineNow) < 0) continue;
      if (Math.abs(px - lineNow) > maxDist) continue;

      const score = qualityScore(bars, touches, L, span, tol, R, dir);
      if (score < 0.55) continue;

      pools.push({ touches, first, last, L, score });
    }
  }

  // strongest first; drop overlapping lines (shared touches)
  pools.sort((x, y) => y.score - x.score);
  const accepted = [];
  for (const p of pools) {
    if (accepted.some((q) => sharedTouches(q.touches, p.touches) >= 2)) continue;
    accepted.push(p);
    if (accepted.length >= 2) break;
  }

  return accepted.map((p) => ({
    kind: "segment",
    i1: p.first.i,
    p1: p.L(p.first.i),
    i2: p.last.i,
    p2: p.L(p.last.i),
    extendRight: false,
    color: dir === 1 ? FAINT.green : FAINT.red,
    width: p.score >= 0.75 ? 1.5 : 1,
    label: `TL liq ×${p.touches.length} ${stars(p.score)}`,
    dots: p.touches.map((t) => ({ i: t.i, p: t.price })),
  }));
}

// ---------------------------------------------------------------- helpers

// touch = pivot near the line that does NOT pierce it beyond pierceTol
function collectTouches(pivots, line, tol, pierceTol, dir) {
  const out = [];
  for (const p of pivots) {
    const lv = line.m * p.i + line.c;
    if (Math.abs(p.price - lv) > tol) continue;
    if (dir * (lv - p.price) > pierceTol) continue; // pierced through, not a touch
    out.push(p);
  }
  return out;
}

// least-squares fit through touch points for a cleaner line than any anchor pair
function fitLine(points) {
  const k = points.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    sx += p.i; sy += p.price; sxx += p.i * p.i; sxy += p.i * p.price;
  }
  const denom = k * sxx - sx * sx;
  const m = denom ? (k * sxy - sx * sy) / denom : 0;
  return { m, c: (sy - m * sx) / k };
}

function closedThrough(bars, i1, i2, L, dir, tol) {
  for (let i = i1; i <= i2; i++) {
    if (dir * (L(i) - bars[i].close) > tol) return true;
  }
  return false;
}

function hunted(bars, lastTouchI, n, L, dir, pierceTol) {
  for (let i = lastTouchI + 1; i < n; i++) {
    const extreme = dir === 1 ? bars[i].low : bars[i].high;
    if (dir * (L(i) - extreme) > pierceTol) return true;
  }
  return false;
}

// Quality: how obvious is this line, and how hard is it defended?
//  · touches      — more touches, more trapped traders (3 → 0, 6+ → 1)
//  · precision    — mean touch distance vs tolerance (tight = textbook)
//  · reaction     — share of touches followed by a strong bounce off the line
//  · spread       — touches spaced evenly, not clustered in one leg
//  · span         — the longer the line has lived, the more stops behind it
function qualityScore(bars, touches, L, span, tol, R, dir) {
  const nT = touches.length;

  const sTouch = Math.min((nT - 3) / 3, 1);

  let dist = 0;
  for (const t of touches) dist += Math.abs(t.price - L(t.i));
  const sPrecision = 1 - Math.min(dist / nT / tol, 1);

  let strong = 0;
  for (const t of touches) {
    let mfe = 0;
    for (let i = t.i + 1; i <= Math.min(t.i + 12, bars.length - 1); i++) {
      const away = dir === 1 ? bars[i].high - L(i) : L(i) - bars[i].low;
      mfe = Math.max(mfe, away);
    }
    if (mfe >= R) strong++;
  }
  const sReaction = strong / nT;

  const gaps = [];
  for (let i = 1; i < nT; i++) gaps.push(touches[i].i - touches[i - 1].i);
  const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - meanGap) ** 2, 0) / gaps.length);
  const sSpread = 1 - Math.min(meanGap ? sd / meanGap : 1, 1);

  const sSpan = Math.min(span / 60, 1);

  return 0.3 * sTouch + 0.2 * sReaction + 0.2 * sPrecision + 0.15 * sSpread + 0.15 * sSpan;
}

function sharedTouches(a, b) {
  const set = new Set(a.map((t) => t.i));
  return b.filter((t) => set.has(t.i)).length;
}

function stars(score) {
  return score >= 0.75 ? "★★★" : score >= 0.65 ? "★★" : "★";
}
