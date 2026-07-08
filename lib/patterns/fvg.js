import { FAINT } from "./core.js";

// Fair Value Gaps + inversions (ICT).
// FVG: 3-candle imbalance — candle 1 high < candle 3 low (bullish) or
// candle 1 low > candle 3 high (bearish); the gap is the untraded zone.
// Lifecycle per gap, walked forward bar by bar:
//   - open      → drawn from birth to right edge
//   - filled    → a wick trades fully through it without a close-through:
//                 consumed, no longer drawn
//   - inverted  → a candle CLOSES through the far side: the zone flips role
//                 (bullish gap becomes resistance and vice versa) — the iFVG.
//                 Drawn from the inversion bar until a close back through the
//                 other side reclaims it.
export function detectFVG(bars, ctx) {
  const minGap = 0.35 * ctx.avgRange; // ignore sub-noise gaps
  const zones = [];

  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2];
    const c = bars[i];
    if (c.low - a.high >= minGap) {
      zones.push({ dir: 1, top: c.low, bottom: a.high, born: i - 1 });
    } else if (a.low - c.high >= minGap) {
      zones.push({ dir: -1, top: a.low, bottom: c.high, born: i - 1 });
    }
  }

  const out = [];
  for (const z of zones) {
    const bull = z.dir === 1;
    let state = "open";
    let invertedAt = null;
    let deadAt = null;

    for (let j = z.born + 2; j < bars.length; j++) {
      const b = bars[j];
      if (state === "open") {
        // close through the far side inverts; full wick-through only fills
        if (bull ? b.close < z.bottom : b.close > z.top) {
          state = "inverted";
          invertedAt = j;
        } else if (bull ? b.low <= z.bottom : b.high >= z.top) {
          state = "filled";
          deadAt = j;
          break;
        }
      } else if (state === "inverted") {
        // reclaimed: close back through the opposite side kills the iFVG
        if (bull ? b.close > z.top : b.close < z.bottom) {
          deadAt = j;
          break;
        }
      }
    }

    if (state === "open") {
      out.push({
        kind: "zone",
        i1: z.born,
        i2: null,
        top: z.top,
        bottom: z.bottom,
        color: bull ? FAINT.green : FAINT.red,
        fill: bull ? FAINT.greenFill : FAINT.redFill,
        label: "FVG",
      });
    } else if (state === "inverted" && deadAt === null) {
      out.push({
        kind: "zone",
        i1: invertedAt,
        i2: null,
        top: z.top,
        bottom: z.bottom,
        color: FAINT.orange,
        fill: FAINT.orangeFill,
        label: "iFVG",
      });
    }
  }

  // newest first, cap the clutter: 8 open gaps + 5 live inversions
  const open = out.filter((d) => d.label === "FVG").slice(-8);
  const inv = out.filter((d) => d.label === "iFVG").slice(-5);
  return [...open, ...inv];
}
