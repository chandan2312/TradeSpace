// Executor entry-mode decision + confirmation detectors. Pure functions.
//
// Philosophy (user's): weak context NEVER rejects the setup — it only
// escalates HOW carefully we enter. Strong context → direct fill. Medium →
// wait for a confirming candle. Weak → wait for a structural signal (displaced
// MSS in-dir, fresh in-dir FVG, or a QML). Only hard invalidation kills it.

import { analyzeStructure } from "../bias/structure.js";
import { liquidityMap, detectQML } from "../bias/liquidity.js";
import { fvgZones } from "../bias/zones.js";
import { classifyRetracement } from "../algo/retracement.js";
import { avgRange } from "../patterns/core.js";

// decideMode(score, cfg) → "direct" | "candle" | "structural"
export function decideMode(score, cfg = {}) {
  const directMin = cfg.directMin ?? 70;
  const confirmMin = cfg.confirmMin ?? 45;
  if (score >= directMin) return "direct";
  if (score >= confirmMin) return "candle";
  return "structural";
}

// candleConfirm — after price has tapped the zone, has the most recent CLOSED
// candle rejected in our direction? Rejection = long opposing wick + close in
// dir, OR an engulfing close in dir. bars = confirmTf bars (M15).
export function candleConfirm(bars, dir) {
  const n = bars?.length;
  if (!n || n < 3) return { pass: false, note: "no bars" };
  const dirN = dir === "buy" ? 1 : -1;
  const c = bars[n - 1];          // last closed candle
  const p = bars[n - 2];
  const range = c.high - c.low;
  if (range <= 0) return { pass: false, note: "flat candle" };
  const body = Math.abs(c.close - c.open);
  const closedInDir = dirN === 1 ? c.close > c.open : c.close < c.open;

  // rejection wick: the wick AGAINST our dir is long (price rejected that side)
  const wickAgainst = dirN === 1 ? (Math.min(c.open, c.close) - c.low) : (c.high - Math.max(c.open, c.close));
  const rejection = closedInDir && wickAgainst >= 0.5 * range;

  // engulfing: body closes through the prior candle's body in our dir
  const engulf = closedInDir
    && (dirN === 1 ? c.close > p.high && body > Math.abs(p.close - p.open)
                   : c.close < p.low && body > Math.abs(p.close - p.open));

  if (rejection) return { pass: true, note: `rejection candle (wick ${Math.round((wickAgainst / range) * 100)}%)` };
  if (engulf) return { pass: true, note: "engulfing candle" };
  return { pass: false, note: closedInDir ? "in-dir but weak" : "no in-dir close" };
}

// structuralConfirm — weak-context gate: require a real structural signal in
// our direction before entry. Any ONE of: displaced MSS in-dir on M15, a fresh
// in-dir FVG, or a QML aligned with dir.
export function structuralConfirm(frames, dir) {
  const M15 = frames?.M15;
  if (!M15?.length) return { pass: false, note: "no M15" };
  const dirN = dir === "buy" ? 1 : -1;
  const avg = avgRange(M15);

  const st = analyzeStructure(M15, avg);
  if (st.lastEvent?.type === "MSS" && st.lastEvent.dir === dirN && st.lastEvent.displaced && st.lastEvent.age <= 10) {
    return { pass: true, note: `displaced MSS in-dir (${st.lastEvent.age} bars)` };
  }
  const freshFvg = fvgZones(M15, avg).find((z) => z.dir === dirN && z.state === "open" && z.age <= 8);
  if (freshFvg) return { pass: true, note: `fresh in-dir FVG (${freshFvg.age} bars)` };

  const qml = detectQML(M15, avg);
  if (qml && qml.dir === dirN && qml.age <= 20) return { pass: true, note: `QML in-dir (${qml.age} bars)` };

  return { pass: false, note: "no structural signal yet" };
}

// hardInvalidation — reasons to KILL a pre-fill setup regardless of mode.
// Returns { dead: bool, note }.
export function hardInvalidation(frames, dir, setup, px) {
  const M15 = frames?.M15;
  const dirN = dir === "buy" ? 1 : -1;

  // price closed through the SL side before we ever filled → setup gone
  if (px != null && setup?.sl != null && (dirN === 1 ? px < setup.sl : px > setup.sl)) {
    return { dead: true, note: `price through SL side to ${px}` };
  }
  if (!M15?.length) return { dead: false, note: "" };
  const avg = avgRange(M15);

  // opposing displaced MSS on the setup TF → structure flipped against us
  const st = analyzeStructure(M15, avg);
  if (st.lastEvent?.type === "MSS" && st.lastEvent.dir === -dirN && st.lastEvent.displaced && st.lastEvent.age <= 12) {
    return { dead: true, note: `opposing displaced MSS (${st.lastEvent.age} bars)` };
  }

  // reversal-type retrace = broke the impulse origin against us
  try {
    const rt = classifyRetracement(M15, dir);
    if (rt?.type === "reversal") return { dead: true, note: `reversal retrace (${rt.note})` };
  } catch { /* ignore */ }

  return { dead: false, note: "" };
}
